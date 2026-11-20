import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDataSource } from '../processor/dataSource';
import { HttpError } from '../worker/src/errors';
import { RefConflictError } from '../worker/src/github';
import { WorkingCopy, type WorkingCopyRepo } from '../worker/src/workingCopy';

function fakeRepo(opts: { branches?: string[]; conflicts?: number; changed?: string[]; openPr?: boolean } = {}) {
  const calls: string[] = [];
  const branches = [...(opts.branches ?? [])];
  let conflicts = opts.conflicts ?? 0;
  const repo: WorkingCopyRepo = {
    async getRefSha(branch) {
      calls.push(`getRefSha:${branch}`);
      return 'sha-main';
    },
    async listBranches(prefix) {
      calls.push(`listBranches:${prefix}`);
      return [...branches];
    },
    async createBranch(name, sha) {
      calls.push(`createBranch:${name}:${sha}`);
      branches.push(name);
    },
    async commitFiles(branch, files, message) {
      calls.push(`commitFiles:${branch}:${Object.keys(files).join(',')}:${message}`);
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
    async openPullRequest(head, title, body) {
      calls.push(`openPullRequest:${head}:${title}:${body}`);
      return { number: 9, url: 'https://pr/9' };
    },
    async mergePullRequest(number, title, body) {
      calls.push(`mergePullRequest:${number}:${title}:${body}`);
    },
    async deleteBranch(name) {
      calls.push(`deleteBranch:${name}`);
    },
  };
  return { repo, calls };
}

function build(repo: WorkingCopyRepo, now = new Date('2026-05-20T15:00:00Z')) {
  const refs: string[] = [];
  const wc = new WorkingCopy({
    repo,
    loadSnapshot: async (ref) => {
      refs.push(ref);
      return memoryDataSource({});
    },
    now: () => now,
  });
  return { wc, refs };
}

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

test('save cria a branch uma única vez em duas chamadas', async () => {
  const { repo, calls } = fakeRepo();
  const { wc } = build(repo);
  await wc.save({ 'runners.json': '{}' }, 'msg');
  await wc.save({ 'runners.json': '{"a":1}' }, 'msg');
  assert.equal(calls.filter((c) => c.startsWith('createBranch')).length, 1);
  assert.ok(calls.includes('createBranch:update-20-05-2026:sha-main'));
  assert.ok(calls.includes('commitFiles:update-20-05-2026:data/runners.json:msg'));
});

test('save com files vazio não chama o GitHub', async () => {
  const { repo, calls } = fakeRepo();
  const { wc } = build(repo);
  await wc.save({}, 'msg');
  assert.deepEqual(calls, []);
});

test('save repete uma vez em RefConflictError', async () => {
  const { repo, calls } = fakeRepo({ conflicts: 1 });
  const { wc } = build(repo);
  await wc.save({ 'a.json': '1' }, 'msg');
  assert.equal(calls.filter((c) => c.startsWith('commitFiles')).length, 2);
});

test('save lança 409 após duas falhas de conflito', async () => {
  const { repo } = fakeRepo({ conflicts: 2 });
  const { wc } = build(repo);
  await assert.rejects(
    () => wc.save({ 'a.json': '1' }, 'msg'),
    (err) => err instanceof HttpError && err.status === 409,
  );
});

test('nome da branch usa a data de Brasília', async () => {
  const { repo, calls } = fakeRepo();
  const { wc } = build(repo, new Date('2026-12-01T02:00:00Z'));
  await wc.save({ 'a.json': '1' }, 'msg');
  assert.ok(calls.includes('createBranch:update-30-11-2026:sha-main'));
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
  const merge = calls.indexOf('mergePullRequest:7:Atualização: 20/05/2026:update: dados 20/05/2026');
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
