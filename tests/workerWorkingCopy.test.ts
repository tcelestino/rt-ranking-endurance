import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDataSource, type DataSource } from '../processor/dataSource';
import { HttpError } from '../worker/src/errors';
import { GitHubError, RefConflictError } from '../worker/src/github';
import { WorkingCopy, type WorkingCopyRepo } from '../worker/src/workingCopy';

interface FakeOpts {
  branches?: string[];
  conflicts?: number; // falhas de RefConflictError no commit
  createConflicts?: number; // falhas 422 no createBranch (branch criada por outra aba)
  changed?: string[];
  openPr?: boolean;
  latestPr?: Record<string, { state: 'open' | 'closed'; merged: boolean; headSha: string }>;
  branchShas?: Record<string, string>; // sha atual de cada branch (tem precedência sobre shas)
  mergeError?: GitHubError;
  deleteError?: GitHubError;
  shas?: string[]; // sha devolvido por getRefSha a cada chamada (o último se repete)
}

function fakeRepo(opts: FakeOpts = {}) {
  const calls: string[] = [];
  const branches = [...(opts.branches ?? [])];
  let conflicts = opts.conflicts ?? 0;
  let createConflicts = opts.createConflicts ?? 0;
  const shas = [...(opts.shas ?? ['sha-main'])];
  const repo: WorkingCopyRepo = {
    async getRefSha(branch) {
      if (opts.branchShas?.[branch]) {
        calls.push(`getRefSha:${branch}:${opts.branchShas[branch]}`);
        return opts.branchShas[branch];
      }
      const sha = shas.length > 1 ? shas.shift()! : shas[0];
      calls.push(`getRefSha:${branch}:${sha}`);
      return sha;
    },
    async listBranches(prefix) {
      calls.push(`listBranches:${prefix}`);
      return [...branches];
    },
    async createBranch(name, sha) {
      calls.push(`createBranch:${name}:${sha}`);
      if (createConflicts > 0) {
        createConflicts--;
        branches.push(name);
        throw new RefConflictError(422, 'já existe');
      }
      branches.push(name);
    },
    async commitFiles(branch, files, message, baseSha) {
      calls.push(`commitFiles:${branch}:${JSON.stringify(files)}:${message}:${baseSha}`);
      if (conflicts > 0) {
        conflicts--;
        throw new RefConflictError(422, 'conflito');
      }
      return 'sha-commit';
    },
    async listChangedFiles(base, head) {
      calls.push(`listChangedFiles:${base}:${head}`);
      return opts.changed ?? [];
    },
    async findOpenPullRequest(head) {
      calls.push(`findOpenPullRequest:${head}`);
      return opts.openPr ? { number: 7, url: 'https://pr/7' } : null;
    },
    async findLatestPullRequest(head) {
      calls.push(`findLatestPullRequest:${head}`);
      const pr = opts.latestPr?.[head];
      return pr ? { number: 5, url: 'https://pr/5', ...pr } : null;
    },
    async openPullRequest(head, title, body) {
      calls.push(`openPullRequest:${head}:${title}:${body}`);
      return { number: 9, url: 'https://pr/9' };
    },
    async mergePullRequest(number, title, body, sha) {
      calls.push(`mergePullRequest:${number}:${title}:${body}:${sha}`);
      if (opts.mergeError) throw opts.mergeError;
    },
    async deleteBranch(name) {
      calls.push(`deleteBranch:${name}`);
      if (opts.deleteError) throw opts.deleteError;
      const i = branches.indexOf(name);
      if (i >= 0) branches.splice(i, 1);
    },
  };
  return { repo, calls };
}

// Snapshot identificado pelo ref: runners.json contém o próprio ref.
function build(repo: WorkingCopyRepo, now = new Date('2026-05-20T15:00:00Z')) {
  const refs: string[] = [];
  const wc = new WorkingCopy({
    repo,
    loadSnapshot: async (ref) => {
      refs.push(ref);
      return memoryDataSource({ 'runners.json': ref });
    },
    now: () => now,
  });
  return { wc, refs };
}

const copy = (source: DataSource) => ({ 'runners.json': `novo:${source.readText('runners.json')}` });

test('load usa main quando não há branch update-*', async () => {
  const { repo } = fakeRepo();
  const { wc, refs } = build(repo);
  await wc.load();
  assert.deepEqual(refs, ['main']);
});

test('load usa a branch update-* aberta', async () => {
  const { repo } = fakeRepo({ branches: ['update-19-05-2026'] });
  const { wc, refs } = build(repo);
  await wc.load();
  assert.deepEqual(refs, ['update-19-05-2026']);
});

test('save passa ao build o snapshot do baseSha e commita sobre esse baseSha', async () => {
  const { repo, calls } = fakeRepo();
  const { wc, refs } = build(repo);
  await wc.save(copy, 'msg');
  assert.deepEqual(refs, ['sha-main']);
  assert.ok(calls.includes('createBranch:update-20-05-2026:sha-main'));
  assert.ok(calls.includes('commitFiles:update-20-05-2026:{"data/runners.json":"novo:sha-main"}:msg:sha-main'));
  assert.ok(
    calls.indexOf('createBranch:update-20-05-2026:sha-main') < calls.findIndex((c) => c.startsWith('commitFiles')),
  );
});

test('save cria a branch uma única vez em duas chamadas', async () => {
  const { repo, calls } = fakeRepo();
  const { wc } = build(repo);
  await wc.save(copy, 'msg');
  await wc.save(copy, 'msg');
  assert.equal(calls.filter((c) => c.startsWith('createBranch')).length, 1);
  assert.ok(calls.includes('getRefSha:update-20-05-2026:sha-main'));
});

test('save com build vazio não cria branch nem commita', async () => {
  const { repo, calls } = fakeRepo();
  const { wc } = build(repo);
  await wc.save(() => ({}), 'msg');
  assert.ok(!calls.some((c) => c.startsWith('createBranch') || c.startsWith('commitFiles')));
});

test('save em conflito refaz o fluxo com o snapshot do novo head (não é replay)', async () => {
  const { repo, calls } = fakeRepo({ branches: ['update-19-05-2026'], conflicts: 1, shas: ['sha-1', 'sha-2'] });
  const { wc, refs } = build(repo);
  let builds = 0;
  await wc.save((source) => {
    builds++;
    return copy(source);
  }, 'msg');
  assert.equal(builds, 2);
  assert.deepEqual(refs, ['sha-1', 'sha-2']);
  const commits = calls.filter((c) => c.startsWith('commitFiles'));
  assert.equal(commits.length, 2);
  assert.ok(commits[0].includes('novo:sha-1') && commits[0].endsWith(':sha-1'));
  assert.ok(commits[1].includes('novo:sha-2') && commits[1].endsWith(':sha-2'));
});

test('save lança 409 após duas falhas de conflito', async () => {
  const { repo } = fakeRepo({ conflicts: 2 });
  const { wc } = build(repo);
  await assert.rejects(
    () => wc.save(copy, 'msg'),
    (err) => err instanceof HttpError && err.status === 409,
  );
});

test('save segue na branch existente quando createBranch falha com 422', async () => {
  const { repo, calls } = fakeRepo({ createConflicts: 1 });
  const { wc } = build(repo);
  await wc.save(copy, 'msg');
  const commits = calls.filter((c) => c.startsWith('commitFiles'));
  assert.equal(commits.length, 1);
  assert.ok(commits[0].startsWith('commitFiles:update-20-05-2026:'));
  assert.equal(calls.filter((c) => c.startsWith('createBranch')).length, 1);
});

test('save propaga erros que não são de conflito', async () => {
  const { repo } = fakeRepo();
  repo.commitFiles = async () => {
    throw new GitHubError(500, 'boom');
  };
  const { wc } = build(repo);
  await assert.rejects(
    () => wc.save(copy, 'msg'),
    (err) => err instanceof GitHubError && err.status === 500,
  );
});

test('nome da branch usa a data de Brasília', async () => {
  const { repo, calls } = fakeRepo();
  const { wc } = build(repo, new Date('2026-12-01T02:00:00Z'));
  await wc.save(copy, 'msg');
  assert.ok(calls.includes('createBranch:update-30-11-2026:sha-main'));
});

test('escolha entre várias update-* é determinística: PR aberto, senão a primeira por nome', async () => {
  const lista = ['update-21-05-2026', 'update-19-05-2026', 'update-20-05-2026'];
  const semPr = build(fakeRepo({ branches: lista }).repo);
  await semPr.wc.load();
  assert.deepEqual(semPr.refs, ['update-19-05-2026']);

  const comPr = build(
    fakeRepo({ branches: lista, latestPr: { 'update-21-05-2026': { state: 'open', merged: false, headSha: 'x' } } })
      .repo,
  );
  await comPr.wc.load();
  assert.deepEqual(comPr.refs, ['update-21-05-2026']);
});

test('pendingChanges é vazio sem branch e lista a diferença com branch', async () => {
  const sem = fakeRepo();
  assert.deepEqual(await build(sem.repo).wc.pendingChanges(), []);
  const com = fakeRepo({ branches: ['update-19-05-2026'], changed: ['data/runners.json'] });
  assert.deepEqual(await build(com.repo).wc.pendingChanges(), ['data/runners.json']);
  assert.ok(com.calls.includes('listChangedFiles:main:update-19-05-2026'));
});

test('publish(false) abre PR e não faz merge', async () => {
  const { repo, calls } = fakeRepo({ branches: ['update-19-05-2026'], changed: ['data/a.json'] });
  const result = await build(repo).wc.publish(false);
  assert.deepEqual(result, { prUrl: 'https://pr/9', merged: false });
  assert.ok(calls.includes('openPullRequest:update-19-05-2026:Atualização: 20/05/2026:update: dados 20/05/2026'));
  assert.ok(!calls.some((c) => c.startsWith('mergePullRequest')));
});

test('publish(true) reutiliza PR aberto, faz squash e apaga a branch', async () => {
  const { repo, calls } = fakeRepo({ branches: ['update-19-05-2026'], changed: ['data/a.json'], openPr: true });
  const result = await build(repo).wc.publish(true);
  assert.deepEqual(result, { prUrl: 'https://pr/7', merged: true });
  assert.ok(!calls.some((c) => c.startsWith('openPullRequest')));
  const merge = calls.indexOf('mergePullRequest:7:Atualização: 20/05/2026:update: dados 20/05/2026:sha-main');
  assert.ok(merge >= 0);
  assert.equal(calls[merge + 1], 'deleteBranch:update-19-05-2026');
});

test('publish sem pendências lança 409', async () => {
  const semBranch = fakeRepo();
  await assert.rejects(
    () => build(semBranch.repo).wc.publish(true),
    (err) => err instanceof HttpError && err.status === 409,
  );
  const semMudanca = fakeRepo({ branches: ['update-19-05-2026'], changed: [] });
  await assert.rejects(
    () => build(semMudanca.repo).wc.publish(false),
    (err) => err instanceof HttpError && err.status === 409,
  );
});

test('commitMessage acrescenta o usuário (email ou id)', () => {
  const { wc } = build(fakeRepo().repo);
  assert.equal(
    wc.commitMessage('update: dados 20/05/2026', { id: 'u1', email: 'a@b.c' }),
    'update: dados 20/05/2026\n\nBackoffice-User: a@b.c',
  );
  assert.equal(wc.commitMessage('x', { id: 'u1', email: null }), 'x\n\nBackoffice-User: u1');
});

const B = 'update-19-05-2026';
const mergedPr = { state: 'closed' as const, merged: true, headSha: 'sha-antigo' };
const deletes = (calls: string[]) => calls.filter((c) => c.startsWith('deleteBranch'));

test('branch recriada no mesmo dia após merge não é obsoleta e nunca é apagada', async () => {
  const { repo, calls } = fakeRepo({
    branches: [B],
    latestPr: { [B]: mergedPr },
    branchShas: { [B]: 'sha-novo' },
    changed: ['data/a.json'],
  });
  const { wc, refs } = build(repo);
  await wc.load();
  assert.deepEqual(refs, [B]);
  assert.deepEqual(await wc.pendingChanges(), ['data/a.json']);
  await wc.save(copy, 'msg');
  await wc.publish(false);
  assert.deepEqual(deletes(calls), []);
  assert.ok(calls.some((c) => c.startsWith(`commitFiles:${B}:`)));
});

test('branch com head igual ao do PR mergeado é ignorada nas leituras sem apagar', async () => {
  const { repo, calls } = fakeRepo({
    branches: [B],
    latestPr: { [B]: mergedPr },
    branchShas: { [B]: 'sha-antigo' },
    changed: ['data/a.json'],
  });
  const { wc, refs } = build(repo);
  await wc.load();
  assert.deepEqual(refs, ['main']);
  assert.deepEqual(await wc.pendingChanges(), []);
  await assert.rejects(
    () => wc.publish(true),
    (err) => err instanceof HttpError && err.status === 409,
  );
  assert.deepEqual(deletes(calls), []);
});

test('save com só uma branch obsoleta apaga e recria o mesmo nome', async () => {
  const { repo, calls } = fakeRepo({
    branches: ['update-20-05-2026'],
    latestPr: { 'update-20-05-2026': mergedPr },
    branchShas: { 'update-20-05-2026': 'sha-antigo' },
    shas: ['sha-main'],
  });
  const { wc } = build(repo);
  await wc.save(copy, 'msg');
  const del = calls.indexOf('deleteBranch:update-20-05-2026');
  const create = calls.indexOf('createBranch:update-20-05-2026:sha-main');
  assert.ok(del >= 0 && create > del);
  assert.ok(calls.some((c) => c.startsWith('commitFiles:update-20-05-2026:')));
});

test('PR fechado sem merge com head igual é obsoleto, mas só é apagado dentro de save', async () => {
  const closed = { state: 'closed' as const, merged: false, headSha: 'sha-antigo' };
  const { repo, calls } = fakeRepo({
    branches: ['update-20-05-2026'],
    latestPr: { 'update-20-05-2026': closed },
    branchShas: { 'update-20-05-2026': 'sha-antigo' },
    shas: ['sha-main'],
  });
  const { wc, refs } = build(repo);
  await wc.load();
  await wc.pendingChanges();
  assert.deepEqual(refs, ['main']);
  assert.deepEqual(deletes(calls), []);
  await wc.save(copy, 'msg');
  assert.deepEqual(deletes(calls), ['deleteBranch:update-20-05-2026']);
});

test('publish(true) devolve merged mesmo se o delete da branch falhar com 404/422', async () => {
  for (const status of [404, 422]) {
    const { repo } = fakeRepo({
      branches: [B],
      changed: ['data/a.json'],
      openPr: true,
      deleteError: new GitHubError(status, 'já apagada'),
    });
    assert.deepEqual(await build(repo).wc.publish(true), { prUrl: 'https://pr/7', merged: true });
  }
});

test('publish(true) passa o sha do head ao merge', async () => {
  const { repo, calls } = fakeRepo({ branches: [B], changed: ['data/a.json'], branchShas: { [B]: 'sha-head' } });
  await build(repo).wc.publish(true);
  assert.ok(calls.some((c) => c.startsWith('mergePullRequest:9:') && c.endsWith(':sha-head')));
});

test('merge recusado (405) vira 409 com a URL do PR', async () => {
  const { repo, calls } = fakeRepo({
    branches: [B],
    changed: ['data/a.json'],
    openPr: true,
    mergeError: new GitHubError(405, 'checks pendentes'),
  });
  await assert.rejects(
    () => build(repo).wc.publish(true),
    (err) =>
      err instanceof HttpError &&
      err.status === 409 &&
      err.message.includes('https://pr/7') &&
      /recusou o merge/.test(err.message),
  );
  assert.deepEqual(deletes(calls), []);
});

test('merge com head alterado (409) vira mensagem distinta', async () => {
  const { repo } = fakeRepo({
    branches: [B],
    changed: ['data/a.json'],
    openPr: true,
    mergeError: new GitHubError(409, 'Head branch was modified'),
  });
  await assert.rejects(
    () => build(repo).wc.publish(true),
    (err) => err instanceof HttpError && err.status === 409 && /novos commits/.test(err.message),
  );
});

test('só branches update-DD-MM-YYYY são consideradas', async () => {
  const { repo } = fakeRepo({ branches: ['update-manifest-11-2026', 'update-20-11-2026'] });
  const { wc, refs } = build(repo);
  await wc.load();
  assert.deepEqual(refs, ['update-20-11-2026']);
  const so = build(fakeRepo({ branches: ['update-manifest-11-2026'] }).repo);
  await so.wc.load();
  assert.deepEqual(so.refs, ['main']);
});
