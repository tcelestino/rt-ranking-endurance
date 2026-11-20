import type { CacheEntry, ImageCache } from '../../processor/cacheManager';

const PREFIX = 'img:';

// Subconjunto de KVNamespace usado aqui; KVNamespace satisfaz esta forma
export interface KvStore {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix?: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export function kvImageCache(kv: KvStore): ImageCache {
  return {
    async get(hash) {
      return (await kv.get(PREFIX + hash, 'json')) as CacheEntry | null;
    },
    async set(hash, entry) {
      await kv.put(PREFIX + hash, JSON.stringify(entry));
    },
    async clear() {
      let cursor: string | undefined;
      do {
        const page = await kv.list({ prefix: PREFIX, cursor });
        await Promise.all(page.keys.map((k) => kv.delete(k.name)));
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    },
  };
}
