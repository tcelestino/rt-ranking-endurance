import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface CacheEntry {
  km: number;
  date: string; // "YYYY-MM-DD"
  filename: string;
}

type CacheFile = Record<string, CacheEntry>;

export const CACHE_PATH = path.resolve('data', '.image-cache.json');

export function computeHash(imagePath: string): string {
  const buffer = fs.readFileSync(imagePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function loadCache(): CacheFile {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as CacheFile;
  } catch {
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
