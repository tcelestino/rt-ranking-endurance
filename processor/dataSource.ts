import * as fs from 'fs';
import * as path from 'path';

// Fonte de leitura dos dados; relPath é relativo a data/ (ex.: 2026/female-maio.json)
export interface DataSource {
  readText(relPath: string): string | null;
  listYears(): number[];
}

const YEAR_DIR = /^\d{4}$/;

export const fsDataSource: DataSource = {
  readText(relPath) {
    const filePath = path.resolve('data', relPath);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  },
  listYears() {
    const dir = path.resolve('data');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && YEAR_DIR.test(entry.name))
      .map((entry) => Number(entry.name))
      .sort((a, b) => a - b);
  },
};

export function memoryDataSource(files: Record<string, string>): DataSource {
  return {
    readText: (relPath) => files[relPath] ?? null,
    listYears: () => {
      const years = new Set<number>();
      for (const key of Object.keys(files)) {
        if (/^\d{4}\//.test(key)) years.add(Number(key.slice(0, 4)));
      }
      return [...years].sort((a, b) => a - b);
    },
  };
}
