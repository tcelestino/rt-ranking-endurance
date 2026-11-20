import type { DataSource } from '../../processor/dataSource';
import { HttpError } from './errors';
import { GitHubError, RefConflictError, type GitHubRepo } from './github';

export type WorkingCopyRepo = Pick<
  GitHubRepo,
  | 'getRefSha'
  | 'listBranches'
  | 'createBranch'
  | 'commitFiles'
  | 'listChangedFiles'
  | 'findOpenPullRequest'
  | 'findLatestPullRequest'
  | 'openPullRequest'
  | 'mergePullRequest'
  | 'deleteBranch'
>;

interface Deps {
  repo: WorkingCopyRepo;
  loadSnapshot: (ref: string) => Promise<DataSource>;
  now: () => Date;
}

const BASE = 'main';
const BRANCH_PREFIX = 'update-';

// Partes da data no fuso de Brasília.
function brasiliaDate(now: Date): { dd: string; mm: string; yyyy: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { dd: get('day'), mm: get('month'), yyyy: get('year') };
}

export class WorkingCopy {
  constructor(private deps: Deps) {}

  // Branch update-* ativa. Obsoleta = PR mais recente fechado/mergeado e head da branch igual ao do PR
  // (sem commits novos desde então); essas são ignoradas, nunca apagadas aqui.
  // Entre várias, prefere a com PR aberto; senão a primeira em ordem de nome.
  private async resolveBranch(): Promise<{ branch: string | null; obsolete: string[] }> {
    const { repo } = this.deps;
    const names = (await repo.listBranches(BRANCH_PREFIX)).sort();
    const obsolete: string[] = [];
    let fallback: string | null = null;
    let open: string | null = null;
    for (const name of names) {
      const latest = await repo.findLatestPullRequest(name);
      if (latest?.state === 'closed' && (await repo.getRefSha(name)) === latest.headSha) {
        obsolete.push(name);
        continue;
      }
      if (latest?.state === 'open') open ??= name;
      fallback ??= name;
    }
    return { branch: open ?? fallback, obsolete };
  }

  private async openBranch(): Promise<string | null> {
    return (await this.resolveBranch()).branch;
  }

  private async deleteStale(name: string): Promise<void> {
    try {
      await this.deps.repo.deleteBranch(name);
    } catch (err) {
      if (err instanceof GitHubError && (err.status === 404 || err.status === 422)) return;
      throw err;
    }
  }

  private newBranchName(): string {
    const { dd, mm, yyyy } = brasiliaDate(this.deps.now());
    return `${BRANCH_PREFIX}${dd}-${mm}-${yyyy}`;
  }

  async load(): Promise<DataSource> {
    return this.deps.loadSnapshot((await this.openBranch()) ?? BASE);
  }

  // `build` recebe o snapshot do head atual e devolve os arquivos (chaves relativas a data/).
  // Se a branch andar entre a leitura e a gravação, o fluxo inteiro é refeito uma vez.
  async save(build: (source: DataSource) => Record<string, string>, message: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.saveOnce(build, message);
        return;
      } catch (err) {
        const retryable = err instanceof RefConflictError || (err instanceof GitHubError && err.status === 404);
        if (!retryable) throw err;
        if (attempt >= 2) {
          throw new HttpError(
            409,
            'Conflito ao salvar: a branch de atualização mudou durante a gravação. Tente novamente.',
          );
        }
      }
    }
  }

  private async saveOnce(build: (source: DataSource) => Record<string, string>, message: string): Promise<void> {
    const { repo } = this.deps;
    const { branch: existing, obsolete } = await this.resolveBranch();
    const baseSha = await repo.getRefSha(existing ?? BASE);
    if (!baseSha) {
      // Branch sumiu entre a listagem e a leitura (404 tratado como conflito); main ausente é erro real.
      if (existing) throw new GitHubError(404, `Branch ${existing} não encontrada`);
      throw new HttpError(500, `Branch ${BASE} não encontrada`);
    }

    const source = await this.deps.loadSnapshot(baseSha);
    const files = build(source);
    if (Object.keys(files).length === 0) return;

    const repoFiles: Record<string, string> = {};
    for (const [rel, content] of Object.entries(files)) repoFiles[`data/${rel}`] = content;

    const branch = existing ?? this.newBranchName();
    if (!existing) {
      // Única escrita sobre branch obsoleta: libera o nome para evitar 422 no createBranch.
      if (obsolete.includes(branch)) await this.deleteStale(branch);
      await repo.createBranch(branch, baseSha);
    }
    await repo.commitFiles(branch, repoFiles, message, baseSha);
  }

  async pendingChanges(): Promise<string[]> {
    const branch = await this.openBranch();
    if (!branch) return [];
    return this.deps.repo.listChangedFiles(BASE, branch);
  }

  async publish(autoMerge: boolean): Promise<{ prUrl: string; merged: boolean }> {
    const branch = await this.openBranch();
    const changes = branch ? await this.deps.repo.listChangedFiles(BASE, branch) : [];
    if (!branch || changes.length === 0) {
      throw new HttpError(409, 'Nenhuma alteração em data/ para publicar');
    }
    const { dd, mm, yyyy } = brasiliaDate(this.deps.now());
    const title = `Atualização: ${dd}/${mm}/${yyyy}`;
    const body = `update: dados ${dd}/${mm}/${yyyy}`;

    const pr =
      (await this.deps.repo.findOpenPullRequest(branch)) ?? (await this.deps.repo.openPullRequest(branch, title, body));
    if (!autoMerge) return { prUrl: pr.url, merged: false };

    await this.deps.repo.mergePullRequest(pr.number, title, body);
    await this.deps.repo.deleteBranch(branch);
    return { prUrl: pr.url, merged: true };
  }

  // Trilha de auditoria: quem fez a alteração pelo backoffice.
  commitMessage(base: string, user: { id: string; email: string | null }): string {
    return `${base}\n\nBackoffice-User: ${user.email ?? user.id}`;
  }
}
