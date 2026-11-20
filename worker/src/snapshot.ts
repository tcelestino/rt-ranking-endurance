import { memoryDataSource, type DataSource } from '../../processor/dataSource';
import type { GitHubRepo } from './github';

export interface BlobCache {
  get(sha: string): Promise<string | null>;
  put(sha: string, text: string): Promise<void>;
}

const CONCURRENCY = 6;

// Baixa só os blobs ausentes do cache (imutáveis por SHA). Falha em um blob rejeita tudo.
export async function loadSnapshot(repo: GitHubRepo, ref: string, blobCache: BlobCache): Promise<DataSource> {
  const entries = await repo.listDataTree(ref);
  const files: Record<string, string> = {};
  let next = 0;

  async function worker(): Promise<void> {
    while (next < entries.length) {
      const entry = entries[next++];
      let text = await blobCache.get(entry.sha);
      if (text === null) {
        text = await repo.getBlobText(entry.sha);
        await blobCache.put(entry.sha, text);
      }
      files[entry.path.slice('data/'.length)] = text;
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return memoryDataSource(files);
}

// Subconjunto de Cache (Workers) usado aqui; Cache satisfaz esta forma
export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
}

const blobUrl = (sha: string) => `https://blob.cache/${sha}`;

export function cacheApiBlobCache(cache: CacheLike): BlobCache {
  return {
    async get(sha) {
      const res = await cache.match(blobUrl(sha));
      return res ? res.text() : null;
    },
    async put(sha, text) {
      await cache.put(
        blobUrl(sha),
        new Response(text, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }),
      );
    },
  };
}
