import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubRepo } from '../worker/src/github';
import { cacheApiBlobCache, loadSnapshot } from '../worker/src/snapshot';

const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64');

function repoWith(responder: (path: string) => { status?: number; json: unknown }) {
  const urls: string[] = [];
  const fetchFake = (async (input: any) => {
    urls.push(String(input));
    const { status = 200, json } = responder(new URL(String(input)).pathname);
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return { repo: new GitHubRepo({ repo: 'o/r', token: 't', fetch: fetchFake }), urls };
}

const TREE = {
  truncated: false,
  tree: [
    { path: 'data/runners.json', type: 'blob', sha: 'sha-runners' },
    { path: 'data/2026/female-maio.json', type: 'blob', sha: 'sha-fem' },
    { path: 'data/2026/male-maio.json', type: 'blob', sha: 'sha-male' },
    { path: 'data/.image-cache.json', type: 'blob', sha: 'sha-cache' },
    { path: 'data/2026', type: 'tree', sha: 'sha-dir' },
    { path: 'data/readme.md', type: 'blob', sha: 'sha-md' },
    { path: 'static/index.html', type: 'blob', sha: 'sha-html' },
  ],
};

function memoryBlobCache(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(sha: string) {
      return store.get(sha) ?? null;
    },
    async put(sha: string, text: string) {
      store.set(sha, text);
    },
  };
}

function blobResponder(contents: Record<string, string>) {
  return (path: string) => {
    if (path.includes('/git/trees/')) return { json: TREE };
    const sha = path.split('/git/blobs/')[1];
    if (sha in contents) return { json: { encoding: 'base64', content: b64(contents[sha]) } };
    return { status: 404, json: { message: 'Not Found' } };
  };
}

test('listDataTree filtra data/**/*.json sem .image-cache.json', async () => {
  const { repo, urls } = repoWith(blobResponder({}));
  const files = await repo.listDataTree('main');
  assert.deepEqual(files.map((f) => f.path).sort(), [
    'data/2026/female-maio.json',
    'data/2026/male-maio.json',
    'data/runners.json',
  ]);
  assert.match(urls[0], /\/git\/trees\/main\?recursive=1$/);
});

test('listDataTree falha rápido quando a árvore vem truncada', async () => {
  const { repo } = repoWith(() => ({ json: { truncated: true, tree: [] } }));
  await assert.rejects(() => repo.listDataTree('main'), /truncada/);
});

test('getBlobText decodifica UTF-8 (acentos)', async () => {
  const { repo } = repoWith(blobResponder({ x: '[{"name":"José"}]' }));
  assert.equal(await repo.getBlobText('x'), '[{"name":"José"}]');
});

test('loadSnapshot baixa só blobs ausentes do cache e remove o prefixo data/', async () => {
  const { repo, urls } = repoWith(
    blobResponder({ 'sha-runners': '{"female":["José"],"male":[]}', 'sha-fem': '[1]' }),
  );
  const cache = memoryBlobCache({ 'sha-male': '[2]' });
  const ds = await loadSnapshot(repo, 'main', cache);
  const blobUrls = urls.filter((u) => u.includes('/git/blobs/'));
  assert.equal(blobUrls.length, 2);
  assert.ok(!urls.some((u) => u.includes('sha-cache')));
  assert.equal(ds.readText('2026/female-maio.json'), '[1]');
  assert.equal(ds.readText('2026/male-maio.json'), '[2]');
  assert.equal(ds.readText('runners.json'), '{"female":["José"],"male":[]}');
  assert.equal(ds.readText('.image-cache.json'), null);
  assert.equal(cache.store.get('sha-fem'), '[1]');
});

test('falha em um blob rejeita o loadSnapshot inteiro', async () => {
  const { repo } = repoWith(blobResponder({ 'sha-runners': '{}', 'sha-fem': '[1]' }));
  await assert.rejects(() => loadSnapshot(repo, 'main', memoryBlobCache()), /404/);
});

test('cacheApiBlobCache guarda e recupera por URL blob.cache/<sha>', async () => {
  const store = new Map<string, string>();
  const fake = {
    async match(url: string) {
      const v = store.get(url);
      return v === undefined ? undefined : new Response(v);
    },
    async put(url: string, res: Response) {
      store.set(url, await res.text());
    },
  };
  const cache = cacheApiBlobCache(fake);
  assert.equal(await cache.get('abc'), null);
  await cache.put('abc', 'José');
  assert.ok(store.has('https://blob.cache/abc'));
  assert.equal(await cache.get('abc'), 'José');
});
