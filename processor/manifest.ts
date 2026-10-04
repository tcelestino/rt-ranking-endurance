import * as fs from 'fs';
import * as path from 'path';
import { getCurrentMonth } from './utils';

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

const ACTUAL_YEAR = new Date().getFullYear();

const DATA_DIR = path.resolve('data');
const YEAR_DIR = path.join(DATA_DIR, `${ACTUAL_YEAR}`);

function ensureCurrentMonthFiles(currentMonth: number): string[] {
  const slug = MONTH_TO_SLUG[currentMonth];
  if (!slug) return [];

  const runnersPath = path.resolve(DATA_DIR, 'runners.json');
  if (!fs.existsSync(runnersPath)) return [];

  if (!fs.existsSync(YEAR_DIR)) fs.mkdirSync(YEAR_DIR);

  const runners: { female: string[]; male: string[] } = JSON.parse(fs.readFileSync(runnersPath, 'utf-8'));
  const createdFiles: string[] = [];

  for (const gender of ['female', 'male'] as const) {
    const filePath = path.resolve(YEAR_DIR, `${gender}-${slug}.json`);
    if (!fs.existsSync(filePath)) {
      const entries = runners[gender].map((name) => ({ name, km: [0] }));
      if (entries.length === 0) {
        throw new Error(`Nenhum corredor encontrado para gênero "${gender}" em runners.json`);
      }
      fs.writeFileSync(filePath, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
      createdFiles.push(`data/${ACTUAL_YEAR}/${gender}-${slug}.json`);
    }
  }

  return createdFiles;
}

function getAvailableMonths(): { month: number; slug: string }[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  if (!fs.existsSync(YEAR_DIR)) return [];

  const files = fs.readdirSync(YEAR_DIR).filter((f) => /^(female|male)-.+\.json$/.test(f));

  const result: { month: number; slug: string }[] = [];
  const seen = new Set<number>();

  for (const file of files) {
    const slug = file.replace(/^(female|male)-/, '').replace(/\.json$/, '');
    const month = SLUG_TO_MONTH[slug];
    if (month !== undefined && !seen.has(month)) {
      seen.add(month);
      result.push({ month, slug });
    }
  }

  result.sort((a, b) => a.month - b.month);
  return result;
}

function writeManifest(months: MonthData[], currentMonth: number, year: number): void {
  const manifest = {
    year,
    currentMonth,
    months: months.map(({ month, slug, monthName }) => ({
      month,
      slug,
      monthName: monthName.charAt(0) + monthName.slice(1).toLowerCase(),
    })),
  };
  const manifestPath = path.resolve('data', 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

export function isManifestCurrent(): boolean {
  const currentMonth = getCurrentMonth();
  const slug = MONTH_TO_SLUG[currentMonth];
  const manifestPath = path.resolve(DATA_DIR, 'manifest.json');
  if (!slug || !fs.existsSync(manifestPath)) return false;

  const monthFilesExist = (['female', 'male'] as const).every((gender) =>
    fs.existsSync(path.resolve(YEAR_DIR, `${gender}-${slug}.json`)),
  );
  if (!monthFilesExist) return false;

  const manifest: { year: number; currentMonth: number; months: { month: number }[] } = JSON.parse(
    fs.readFileSync(manifestPath, 'utf-8'),
  );
  return (
    manifest.year === ACTUAL_YEAR &&
    manifest.currentMonth === currentMonth &&
    manifest.months.some((m) => m.month === currentMonth)
  );
}

export function generateManifest(): { createdFiles: string[]; months: number } {
  const currentMonth = getCurrentMonth();
  const createdFiles = ensureCurrentMonthFiles(currentMonth);
  const availableMonths = getAvailableMonths();

  if (availableMonths.length === 0) {
    throw new Error('Nenhum arquivo de dados encontrado em data/');
  }

  const months: MonthData[] = availableMonths.map(({ month, slug }) => {
    const monthName = MONTH_NAMES_PT[month];
    return { month, slug, monthName };
  });

  writeManifest(months, currentMonth, ACTUAL_YEAR);

  return { createdFiles, months: months.length };
}

function main() {
  try {
    const { createdFiles, months } = generateManifest();
    for (const file of createdFiles) console.log(`Criado: ${file}`);
    console.log(`data/manifest.json gerado (${months} mês/meses)`);
  } catch (error) {
    console.error(`Erro: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (require.main === module) main();
