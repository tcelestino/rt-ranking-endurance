import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Logger } from 'pino';
import { logger } from './logger';

interface CacheEntry {
  km: number;
  date: string; // "YYYY-MM-DD"
  filename: string;
}

type CacheFile = Record<string, CacheEntry>;

export const CACHE_PATH = path.resolve('data', '.image-cache.json');

export function computeHash(imagePath: string): string {
  return computeHashFromBuffer(fs.readFileSync(imagePath));
}

export function computeHashFromBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const log = logger.child({ module: 'cacheManager' });

export function loadCache(cachePath: string = CACHE_PATH, cacheLog: Logger = log): CacheFile {
  if (!fs.existsSync(cachePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as CacheFile;
  } catch (err) {
    cacheLog.warn({ err, path: cachePath }, 'cache de imagens ilegível; ignorando e usando cache vazio');
    return {};
  }
}

export function getCached(hash: string): CacheEntry | null {
  const cache = loadCache();
  return cache[hash] ?? null;
}

export function storeCache(hash: string, entry: CacheEntry): void {
  const cache = loadCache();
  cache[hash] = entry;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n');
}

export function removeCache(): void {
  fs.rmSync(CACHE_PATH, { force: true });
}
