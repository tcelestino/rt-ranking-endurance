export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

// PATCH da ref recusado (não fast-forward): alguém moveu a branch no meio.
export class RefConflictError extends GitHubError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = 'RefConflictError';
  }
}

export interface PullRequestRef {
  number: number;
  url: string;
}

interface Options {
  repo: string; // "owner/repo"
  token: string;
  fetch?: typeof fetch;
}

const API = 'https://api.github.com';

export class GitHubRepo {
  private repo: string;
  private token: string;
  private fetchFn: typeof fetch;

  constructor(opts: Options) {
    this.repo = opts.repo;
    this.token = opts.token;
    // Wrapper evita "Illegal invocation" do fetch global chamado como método.
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  // Único ponto de acesso à API. Nunca inclui token nem headers nas mensagens de erro.
  private async request(
    method: string,
    path: string,
    body?: unknown,
    okStatuses: number[] = [],
  ): Promise<{ status: number; data: any }> {
    let res: Response;
    try {
      res = await this.fetchFn(`${API}/repos/${this.repo}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'rt-ranking-backoffice',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      // Descarta o erro original: pode conter detalhes da requisição.
      throw new GitHubError(502, `GitHub inacessível: ${method} ${path}`);
    }
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok && !okStatuses.includes(res.status)) {
      const detail = data?.message ? `: ${data.message}` : '';
      throw new GitHubError(res.status, `GitHub ${method} ${path} falhou (${res.status})${detail}`);
    }
    return { status: res.status, data };
  }

  // Árvore recursiva de ref (branch, tag ou sha), filtrada em data/**/*.json (sem .image-cache.json).
  async listDataTree(ref: string): Promise<{ path: string; sha: string }[]> {
    const { data } = await this.request('GET', `/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    if (data.truncated) {
      throw new GitHubError(500, `Árvore de ${ref} truncada pela API do GitHub; snapshot incompleto`);
    }
    return (data.tree as { path: string; type: string; sha: string }[])
      .filter(
        (e) =>
          e.type === 'blob' &&
          e.path.startsWith('data/') &&
          e.path.endsWith('.json') &&
          e.path !== 'data/.image-cache.json',
      )
      .map((e) => ({ path: e.path, sha: e.sha }));
  }

  // Conteúdo do blob decodificado como UTF-8 (sem Buffer: roda em Workers).
  async getBlobText(sha: string): Promise<string> {
    const { data } = await this.request('GET', `/git/blobs/${sha}`);
    if (data.encoding !== 'base64') {
      throw new GitHubError(500, `Blob ${sha} com encoding inesperado: ${data.encoding}`);
    }
    const binary = atob((data.content as string).replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async getRefSha(branch: string): Promise<string | null> {
    const { status, data } = await this.request('GET', `/git/ref/heads/${branch}`, undefined, [404]);
    return status === 404 ? null : data.object.sha;
  }

  async listBranches(prefix: string): Promise<string[]> {
    const { data } = await this.request('GET', `/git/matching-refs/heads/${prefix}`);
    return (data as { ref: string }[]).map((r) => r.ref.replace('refs/heads/', ''));
  }

  async createBranch(name: string, fromSha: string): Promise<void> {
    await this.request('POST', '/git/refs', { ref: `refs/heads/${name}`, sha: fromSha });
  }

  // Cria blobs, árvore e commit; a ref só se move no último passo (sem estado parcial).
  async commitFiles(branch: string, files: Record<string, string | null>, message: string): Promise<string> {
    if (Object.keys(files).length === 0) {
      throw new Error('commitFiles: nenhum arquivo para commitar');
    }
    const headSha = await this.getRefSha(branch);
    if (!headSha) throw new GitHubError(404, `Branch ${branch} não encontrada`);
    const { data: headCommit } = await this.request('GET', `/git/commits/${headSha}`);

    const tree: { path: string; mode: string; type: string; sha: string | null }[] = [];
    for (const [path, content] of Object.entries(files)) {
      if (content === null) {
        tree.push({ path, mode: '100644', type: 'blob', sha: null });
        continue;
      }
      const { data: blob } = await this.request('POST', '/git/blobs', {
        content,
        encoding: 'utf-8',
      });
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const { data: newTree } = await this.request('POST', '/git/trees', {
      base_tree: headCommit.tree.sha,
      tree,
    });
    const { data: commit } = await this.request('POST', '/git/commits', {
      message,
      tree: newTree.sha,
      parents: [headSha],
    });

    try {
      await this.request('PATCH', `/git/refs/heads/${branch}`, {
        sha: commit.sha,
        force: false,
      });
    } catch (err) {
      if (err instanceof GitHubError && err.status === 422) {
        throw new RefConflictError(err.status, err.message);
      }
      throw err;
    }
    return commit.sha;
  }

  async listChangedFiles(base: string, head: string): Promise<string[]> {
    const { data } = await this.request('GET', `/compare/${base}...${head}`);
    return (data.files as { filename: string }[]).map((f) => f.filename);
  }

  async findOpenPullRequest(head: string): Promise<PullRequestRef | null> {
    const owner = this.repo.split('/')[0];
    const { data } = await this.request('GET', `/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`);
    const pr = (data as { number: number; html_url: string }[])[0];
    return pr ? { number: pr.number, url: pr.html_url } : null;
  }

  async openPullRequest(head: string, title: string, body: string): Promise<PullRequestRef> {
    const { data } = await this.request('POST', '/pulls', {
      head,
      base: 'main',
      title,
      body,
    });
    return { number: data.number, url: data.html_url };
  }

  async mergePullRequest(number: number, title: string, body: string): Promise<void> {
    await this.request('PUT', `/pulls/${number}/merge`, {
      merge_method: 'squash',
      commit_title: title,
      commit_message: body,
    });
  }

  async deleteBranch(name: string): Promise<void> {
    await this.request('DELETE', `/git/refs/heads/${name}`);
  }
}
