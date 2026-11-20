import assert from 'node:assert/strict';
import test from 'node:test';
import { kvImageCache } from '../worker/src/kvImageCache';
import type { CacheEntry } from '../processor/cacheManager';

// KV fake em memória; list paginado de 2 em 2 para exercitar o cursor
function fakeKv() {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string, type?: 'json') {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix = '', cursor }: { prefix?: string; cursor?: string }) {
      // cursor = última chave da página anterior (estável mesmo com delete)
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix) && (!cursor || k > cursor))
        .sort();
      const page = keys.slice(0, 2);
      const complete = keys.length <= 2;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: complete,
        cursor: complete ? undefined : page[page.length - 1],
      };
    },
  };
  return { kv, store };
}

const entry: CacheEntry = { km: 10.5, pace: 345, date: '2026-11-20', filename: 'a.png' };

test('set e get devolvem a entrada gravada', async () => {
  const { kv, store } = fakeKv();
  const cache = kvImageCache(kv);
  const hash = 'a'.repeat(64);
  await cache.set(hash, entry);
  assert.deepEqual(await cache.get(hash), entry);
  assert.ok(store.has(`img:${hash}`));
});

test('get de hash inexistente devolve null', async () => {
  const { kv } = fakeKv();
  assert.equal(await kvImageCache(kv).get('b'.repeat(64)), null);
});

test('clear apaga todas as entradas paginadas', async () => {
  const { kv, store } = fakeKv();
  const cache = kvImageCache(kv);
  for (const c of 'abcde') await cache.set(c.repeat(64), entry);
  store.set('outro:x', '1');
  await cache.clear();
  assert.equal([...store.keys()].filter((k) => k.startsWith('img:')).length, 0);
  assert.ok(store.has('outro:x'));
});
