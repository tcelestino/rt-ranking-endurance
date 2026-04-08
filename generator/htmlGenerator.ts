import * as fs from "fs";
import * as path from "path";
import { loadParticipants } from "./participantsParser";

interface RunnerResult {
  name: string;
  km: number;
  position: number;
}

interface MonthData {
  month: number;
  slug: string;
  monthName: string;
  female: RunnerResult[];
  male: RunnerResult[];
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
    .filter((f) => /^female-.+\.json$/.test(f));

  const result: { month: number; slug: string }[] = [];
  const seen = new Set<number>();

  for (const file of files) {
    const slug = file.replace(/^female-/, "").replace(/\.json$/, "");
    const month = SLUG_TO_MONTH[slug];
    if (month !== undefined && !seen.has(month)) {
      seen.add(month);
      result.push({ month, slug });
    }
  }

  result.sort((a, b) => a.month - b.month);
  return result;
}

function loadMonthDataFromFile(
  gender: "female" | "male",
  slug: string,
): { name: string; km: number[] }[] {
  const filePath = path.resolve("data", `${gender}-${slug}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function assignPositions(
  runners: { name: string; km: number }[],
): RunnerResult[] {
  return runners.map((r, i) => ({ ...r, position: i + 1 }));
}

function calcMonthlyRanking(
  gender: "female" | "male",
  slug: string,
): RunnerResult[] {
  const participants = loadParticipants();
  const names = gender === "female" ? participants.female : participants.male;
  const data = loadMonthDataFromFile(gender, slug);

  const results = names.map((name) => {
    const record = data.find(
      (d) => d.name.toLowerCase() === name.toLowerCase(),
    );
    const km = record ? record.km.reduce((a, b) => a + b, 0) : 0;
    return { name, km };
  });

  results.sort((a, b) => b.km - a.km);
  return assignPositions(results);
}

function calcAnnualRanking(): RunnerResult[] {
  const dataDir = path.resolve("data");
  if (!fs.existsSync(dataDir)) return [];

  const files = fs
    .readdirSync(dataDir)
    .filter(
      (f) =>
        f.endsWith(".json") &&
        !f.startsWith(".") &&
        f !== "runners.json" &&
        f !== "manifest.json",
    );

  const totals = new Map<string, number>();

  for (const file of files) {
    const raw = fs.readFileSync(path.join(dataDir, file), "utf-8");
    const records: { name: string; km: number[] }[] = JSON.parse(raw);
    for (const record of records) {
      const key = record.name.toLowerCase();
      const existing = totals.get(key) ?? 0;
      totals.set(key, existing + record.km.reduce((a, b) => a + b, 0));
    }
  }

  const participants = loadParticipants();
  const allNames = [...participants.female, ...participants.male];

  for (const name of allNames) {
    const key = name.toLowerCase();
    if (!totals.has(key)) totals.set(key, 0);
  }

  const nameMap = new Map<string, string>();
  for (const name of allNames) nameMap.set(name.toLowerCase(), name);

  const results = Array.from(totals.entries()).map(([key, km]) => ({
    name: nameMap.get(key) ?? key,
    km,
  }));

  results.sort((a, b) => b.km - a.km);
  return assignPositions(results);
}

function medal(position: number): string {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return "";
}

function formatKm(km: number): string {
  return km === 0 ? "0km" : `${km.toFixed(2)}km`;
}

function buildMonthMarkdown(
  female: RunnerResult[],
  male: RunnerResult[],
  month: number,
  year: number,
): string {
  const monthName = MONTH_NAMES_PT[month];
  const section = (runners: RunnerResult[]) =>
    runners
      .map(
        (r) =>
          `${r.position}. ${medal(r.position)}${r.name} - ${formatKm(r.km)}`,
      )
      .join("\n");

  return [
    `*RANKING ENDURANCE - ${monthName} ${year}*`,
    "",
    `*feminino* 🏃‍♀️`,
    section(female),
    "",
    `*masculino* 🏃‍♂️`,
    section(male),
  ].join("\n");
}

function buildAnnualMarkdown(annual: RunnerResult[], year: number): string {
  const section = (runners: RunnerResult[]) =>
    runners
      .map(
        (r) =>
          `${r.position}. ${medal(r.position)}${r.name} - ${formatKm(r.km)}`,
      )
      .join("\n");

  return [
    "",
    `*RANKING ANUAL - ${year}* 🏆 🏅`,
    section(annual),
    "",
  ].join("\n");
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

  const annual = calcAnnualRanking();
  const annualMarkdown = buildAnnualMarkdown(annual, year);

  const months: MonthData[] = availableMonths.map(({ month, slug }) => {
    const monthName = MONTH_NAMES_PT[month];
    const female = calcMonthlyRanking("female", slug);
    const male = calcMonthlyRanking("male", slug);
    return { month, slug, monthName, female, male };
  });

  writeManifest(months, currentMonth, year);

  const monthMarkdowns: Record<number, string> = {};
  for (const m of months) {
    monthMarkdowns[m.month] = buildMonthMarkdown(
      m.female,
      m.male,
      m.month,
      year,
    );
  }

  const activeMonth =
    months.find((m) => m.month === currentMonth)?.month ??
    months[months.length - 1].month;
  const markdown = (monthMarkdowns[activeMonth] ?? "") + annualMarkdown;

  const mdPath = path.resolve("output/results.md");
  fs.writeFileSync(mdPath, markdown, "utf-8");

  console.log(`results.md gerado`);
  console.log(`data/manifest.json gerado (${months.length} mês/meses)`);
}

main();
