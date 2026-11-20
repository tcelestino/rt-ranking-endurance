import type { DataSource } from '../../processor/dataSource';
import { HttpError } from './errors';
import { RefConflictError, type GitHubRepo } from './github';

export type WorkingCopyRepo = Pick<
  GitHubRepo,
  | 'getRefSha'
  | 'listBranches'
  | 'createBranch'
  | 'commitFiles'
  | 'listChangedFiles'
  | 'findOpenPullRequest'
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

  // A lista de branches update-* é a fonte de "aberta": usa a primeira.
  private async openBranch(): Promise<string | null> {
    const branches = await this.deps.repo.listBranches(BRANCH_PREFIX);
    return branches[0] ?? null;
  }

  private async ensureBranch(): Promise<string> {
    const existing = await this.openBranch();
    if (existing) return existing;
    const { dd, mm, yyyy } = brasiliaDate(this.deps.now());
    const name = `${BRANCH_PREFIX}${dd}-${mm}-${yyyy}`;
    const sha = await this.deps.repo.getRefSha(BASE);
    if (!sha) throw new HttpError(500, `Branch ${BASE} não encontrada`);
    await this.deps.repo.createBranch(name, sha);
    return name;
  }

  async load(): Promise<DataSource> {
    return this.deps.loadSnapshot((await this.openBranch()) ?? BASE);
  }

  // Chaves de `files` são relativas a data/.
  async save(files: Record<string, string>, message: string): Promise<void> {
    if (Object.keys(files).length === 0) return;
    const branch = await this.ensureBranch();
    const repoFiles: Record<string, string> = {};
    for (const [rel, content] of Object.entries(files)) repoFiles[`data/${rel}`] = content;

    // commitFiles relê o head a cada chamada; uma repetição cobre a corrida com outro commit.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.deps.repo.commitFiles(branch, repoFiles, message);
        return;
      } catch (err) {
        if (!(err instanceof RefConflictError)) throw err;
        if (attempt >= 2) {
          throw new HttpError(409, `Conflito ao salvar em ${branch}: a branch mudou durante a gravação`);
        }
      }
    }
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
