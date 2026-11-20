import { DataSource, fsDataSource } from './dataSource';
import { monthRelPath } from './jsonUpdater';
import { getCurrentMonth, getCurrentYear } from './utils';

interface MonthData {
  month: number;
  slug: string;
  monthName: string;
}

const MONTH_NAMES_PT: Record<number, string> = {
  1: 'JANEIRO',
  2: 'FEVEREIRO',
  3: 'MARÇO',
  4: 'ABRIL',
  5: 'MAIO',
  6: 'JUNHO',
  7: 'JULHO',
  8: 'AGOSTO',
  9: 'SETEMBRO',
  10: 'OUTUBRO',
  11: 'NOVEMBRO',
  12: 'DEZEMBRO',
};

const SLUG_TO_MONTH: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

const MONTH_TO_SLUG: Record<number, string> = Object.fromEntries(
  Object.entries(SLUG_TO_MONTH).map(([slug, month]) => [month, slug]),
);

const GENDERS = ['female', 'male'] as const;

function getAvailableMonths(source: DataSource, year: number, extraPaths: Set<string>): MonthData[] {
  const result: MonthData[] = [];
  for (const [slug, month] of Object.entries(SLUG_TO_MONTH)) {
    const exists = GENDERS.some((gender) => {
      const rel = monthRelPath(gender, month, year);
      return extraPaths.has(rel) || source.readText(rel) !== null;
    });
    if (exists) result.push({ month, slug, monthName: MONTH_NAMES_PT[month] });
  }
  return result.sort((a, b) => a.month - b.month);
}

function buildManifest(months: MonthData[], currentMonth: number, year: number): string {
  const manifest = {
    year,
    currentMonth,
    months: months.map(({ month, slug, monthName }) => ({
      month,
      slug,
      monthName: monthName.charAt(0) + monthName.slice(1).toLowerCase(),
    })),
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

// Planeja a criação do mês: devolve os arquivos a gravar (chaves relativas a data/) sem tocar em disco
export function planNewMonth(
  source: DataSource,
  month: number,
  year: number,
): { files: Record<string, string>; createdFiles: string[] } {
  const files: Record<string, string> = {};
  const createdFiles: string[] = [];

  const runnersRaw = MONTH_TO_SLUG[month] ? source.readText('runners.json') : null;
  if (runnersRaw !== null) {
    const runners: { female: string[]; male: string[] } = JSON.parse(runnersRaw);
    for (const gender of GENDERS) {
      const rel = monthRelPath(gender, month, year);
      if (source.readText(rel) !== null) continue;
      const entries = runners[gender].map((name) => ({ name, km: [0] }));
      if (entries.length === 0) {
        throw new Error(`Nenhum corredor encontrado para gênero "${gender}" em runners.json`);
      }
      files[rel] = JSON.stringify(entries, null, 2) + '\n';
      createdFiles.push(rel.slice(rel.indexOf('/') + 1));
    }
  }

  const months = getAvailableMonths(source, year, new Set(Object.keys(files)));
  if (months.length === 0) {
    throw new Error('Nenhum arquivo de dados encontrado em data/');
  }
  files['manifest.json'] = buildManifest(months, month, year);

  return { files, createdFiles };
}

export function isManifestCurrent(
  source: DataSource = fsDataSource,
  month: number = getCurrentMonth(),
  year: number = getCurrentYear(),
): boolean {
  const manifestRaw = source.readText('manifest.json');
  if (!MONTH_TO_SLUG[month] || manifestRaw === null) return false;

  const monthFilesExist = GENDERS.every((gender) => source.readText(monthRelPath(gender, month, year)) !== null);
  if (!monthFilesExist) return false;

  const manifest: { year: number; currentMonth: number; months: { month: number }[] } = JSON.parse(manifestRaw);
  return manifest.year === year && manifest.currentMonth === month && manifest.months.some((m) => m.month === month);
}
