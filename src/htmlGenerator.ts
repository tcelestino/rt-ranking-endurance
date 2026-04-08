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

// Aceita tanto "marco" quanto "março" para robustez com arquivos históricos
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
      (f) => f.endsWith(".json") && !f.startsWith(".") && f !== "runners.json",
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

function buildHtml(
  months: MonthData[],
  annual: RunnerResult[],
  currentMonth: number,
  year: number,
  monthMarkdowns: Record<number, string>,
  annualMarkdown: string,
): string {
  const activeMonth =
    months.find((m) => m.month === currentMonth)?.month ??
    months[months.length - 1]?.month ??
    currentMonth;

  const renderRows = (runners: RunnerResult[]) =>
    runners
      .map((r) => {
        const m = medal(r.position);
        const medalHtml = m ? `<span class="medal">${m}</span>` : "";
        const km =
          r.km === 0
            ? `<span class="zero">0km</span>`
            : `<span class="km">${r.km.toFixed(2)}km</span>`;
        return `          <li class="runner${r.km === 0 ? " no-km" : ""}"><span class="pos">${r.position}.</span>${medalHtml}<span class="name">${r.name}</span>${km}</li>`;
      })
      .join("\n");

  const tabButtons = months
    .map((m) => {
      const label =
        m.monthName.charAt(0) + m.monthName.slice(1).toLowerCase();
      const active = m.month === activeMonth ? " active" : "";
      return `        <button class="tab${active}" data-month="${m.month}" onclick="switchTab(${m.month})">${label}</button>`;
    })
    .join("\n");

  const monthContents = months
    .map((m) => {
      const active = m.month === activeMonth ? " active" : "";
      return `      <div id="content-${m.month}" class="month-content${active}">
        <div class="section">
          <div class="section-header">🏃‍♀️ Feminino</div>
          <ul class="runner-list">
${renderRows(m.female)}
          </ul>
        </div>
        <div class="section">
          <div class="section-header">🏃‍♂️ Masculino</div>
          <ul class="runner-list">
${renderRows(m.male)}
          </ul>
        </div>
      </div>`;
    })
    .join("\n");

  const activeMonthData = months.find((m) => m.month === activeMonth);
  const initialMonthName = activeMonthData
    ? activeMonthData.monthName.charAt(0) +
      activeMonthData.monthName.slice(1).toLowerCase()
    : "";

  const monthNamesJs = months
    .map(
      (m) =>
        `${m.month}: "${m.monthName.charAt(0) + m.monthName.slice(1).toLowerCase()}"`,
    )
    .join(", ");

  const markdownsJs = Object.entries(monthMarkdowns)
    .map(([k, v]) => {
      const escaped = v.replace(/`/g, "\\`").replace(/\$/g, "\\$");
      return `${k}: \`${escaped}\``;
    })
    .join(",\n    ");

  const annualEscaped = annualMarkdown
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ranking RT Corrida ${year}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e8e8e8; min-height: 100vh; padding: 1.5rem 1rem 5rem; }
  .container { max-width: 480px; margin: 0 auto; }
  h1 { font-size: 1.1rem; font-weight: 700; text-align: center; text-transform: uppercase; letter-spacing: 0.05em; color: #fff; margin-bottom: 1.5rem; }
  .tabs { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; overflow-x: auto; padding-bottom: 0.25rem; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { background: #222; border: none; border-radius: 999px; color: #888; cursor: pointer; font-size: 0.8rem; font-weight: 600; padding: 0.45rem 1rem; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
  .tab.active { background: #6ee7b7; color: #0f0f0f; }
  .month-content { display: none; }
  .month-content.active { display: block; }
  .section { margin-bottom: 2rem; background: #1a1a1a; border-radius: 12px; overflow: hidden; }
  .section-header { padding: 0.75rem 1rem; background: #222; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #aaa; display: flex; align-items: center; gap: 0.4rem; }
  .runner-list { list-style: none; padding: 0.25rem 0; }
  .runner { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 1rem; border-bottom: 1px solid #222; }
  .runner:last-child { border-bottom: none; }
  .runner.no-km { opacity: 0.45; }
  .pos { min-width: 1.4rem; font-size: 0.8rem; color: #666; font-variant-numeric: tabular-nums; }
  .medal { font-size: 1rem; min-width: 1.4rem; }
  .name { flex: 1; font-size: 0.95rem; color: #e8e8e8; }
  .km { font-size: 0.85rem; color: #6ee7b7; font-variant-numeric: tabular-nums; font-weight: 600; }
  .zero { font-size: 0.85rem; color: #555; }
  .copy-btn { position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%); background: #25D366; color: #fff; border: none; border-radius: 999px; padding: 0.8rem 2rem; font-size: 0.95rem; font-weight: 600; cursor: pointer; box-shadow: 0 4px 16px rgba(37,211,102,0.3); white-space: nowrap; }
  .copy-btn:active { background: #1da851; }
  .toast { position: fixed; bottom: 5rem; left: 50%; transform: translateX(-50%); background: #333; color: #fff; padding: 0.5rem 1.2rem; border-radius: 999px; font-size: 0.85rem; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="container">
  <h1 id="title">Ranking Endurance<br>${initialMonthName} ${year}</h1>

  <div class="tabs">
${tabButtons}
  </div>

${monthContents}

  <div class="section">
    <div class="section-header">🏆 Ranking Anual ${year}</div>
    <ul class="runner-list">
${renderRows(annual)}
    </ul>
  </div>
</div>

<button class="copy-btn" onclick="copyToWhatsApp()">Copiar para WhatsApp</button>
<div class="toast" id="toast">Copiado!</div>

<script>
const monthNames = { ${monthNamesJs} };
const markdowns = {
    ${markdownsJs}
};
const annualMarkdown = \`${annualEscaped}\`;
const year = ${year};
let activeMonth = ${activeMonth};

function switchTab(month) {
  document.querySelectorAll('.month-content').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.tab').forEach(function(el) { el.classList.remove('active'); });
  document.getElementById('content-' + month).classList.add('active');
  document.querySelector('[data-month="' + month + '"]').classList.add('active');
  document.getElementById('title').innerHTML = 'Ranking Endurance<br>' + monthNames[month] + ' ' + year;
  activeMonth = month;
}

function copyToWhatsApp() {
  const text = markdowns[activeMonth] + annualMarkdown;
  navigator.clipboard.writeText(text).then(function() {
    showToast();
  }).catch(function() {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast();
  });
}

function showToast() {
  const toast = document.getElementById('toast');
  toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 2000);
}
</script>
</body>
</html>
`;
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

  const monthMarkdowns: Record<number, string> = {};
  for (const m of months) {
    monthMarkdowns[m.month] = buildMonthMarkdown(
      m.female,
      m.male,
      m.month,
      year,
    );
  }

  const html = buildHtml(
    months,
    annual,
    currentMonth,
    year,
    monthMarkdowns,
    annualMarkdown,
  );

  // results.md continua sendo gerado para o mês vigente
  const activeMonth =
    months.find((m) => m.month === currentMonth)?.month ??
    months[months.length - 1].month;
  const markdown =
    (monthMarkdowns[activeMonth] ?? "") + annualMarkdown;

  const mdPath = path.resolve("output/results.md");
  const htmlPath = path.resolve("output/results.html");

  fs.writeFileSync(mdPath, markdown, "utf-8");
  fs.writeFileSync(htmlPath, html, "utf-8");

  console.log(`results.md gerado`);
  console.log(`results.html gerado (${months.length} mês/meses com abas)`);
}

main();
