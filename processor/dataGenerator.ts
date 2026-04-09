import * as fs from "fs";
import * as path from "path";

interface MonthData {
  month: number;
  slug: string;
  monthName: string;
}

const MONTH_NAMES_PT: Record<number, string> = {
  1: "JANEIRO",
  2: "FEVEREIRO",
  3: "MARÇO",
  4: "ABRIL",
  5: "MAIO",
  6: "JUNHO",
  7: "JULHO",
  8: "AGOSTO",
  9: "SETEMBRO",
  10: "OUTUBRO",
  11: "NOVEMBRO",
  12: "DEZEMBRO",
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

function getCurrentMonth(): number {
  const env = process.env.CURRENT_MONTH;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 12) return parsed;
  }
  return new Date().getMonth() + 1;
}

function getAvailableMonths(): { month: number; slug: string }[] {
  const dataDir = path.resolve("data");
  if (!fs.existsSync(dataDir)) return [];

  const files = fs
    .readdirSync(dataDir)
    .filter((f) => /^(female|male)-.+\.json$/.test(f));

  const result: { month: number; slug: string }[] = [];
  const seen = new Set<number>();

  for (const file of files) {
    const slug = file.replace(/^(female|male)-/, "").replace(/\.json$/, "");
    const month = SLUG_TO_MONTH[slug];
    if (month !== undefined && !seen.has(month)) {
      seen.add(month);
      result.push({ month, slug });
    }
  }

  result.sort((a, b) => a.month - b.month);
  return result;
}

function writeManifest(
  months: { month: number; slug: string; monthName: string }[],
  currentMonth: number,
  year: number,
): void {
  const manifest = {
    year,
    currentMonth,
    months: months.map(({ month, slug, monthName }) => ({
      month,
      slug,
      monthName: monthName.charAt(0) + monthName.slice(1).toLowerCase(),
    })),
  };
  const manifestPath = path.resolve("data", "manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );
}

function main() {
  const currentMonth = getCurrentMonth();
  const year = new Date().getFullYear();
  const availableMonths = getAvailableMonths();

  if (availableMonths.length === 0) {
    console.error("Nenhum arquivo de dados encontrado em data/");
    process.exit(1);
  }

  const months: MonthData[] = availableMonths.map(({ month, slug }) => {
    const monthName = MONTH_NAMES_PT[month];
    return { month, slug, monthName };
  });

  writeManifest(months, currentMonth, year);

  console.log(`data/manifest.json gerado (${months.length} mês/meses)`);
}

main();
