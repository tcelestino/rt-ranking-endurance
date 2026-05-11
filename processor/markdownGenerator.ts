import * as fs from 'fs';
import * as path from 'path';
import { loadParticipants, normalize } from './participantsParser';
import { getDataFilePath, getMonthName, getFullYear, loadMonthDataSync, ParticipantRecord } from './jsonUpdater';
import { getCurrentMonth } from './utils';

interface RunnerResult {
  name: string;
  km: number;
  position: number;
}

const MONTH_DISPLAY: Record<string, string> = {
  janeiro: 'JANEIRO',
  fevereiro: 'FEVEREIRO',
  marco: 'MARÇO',
  abril: 'ABRIL',
  maio: 'MAIO',
  junho: 'JUNHO',
  julho: 'JULHO',
  agosto: 'AGOSTO',
  setembro: 'SETEMBRO',
  outubro: 'OUTUBRO',
  novembro: 'NOVEMBRO',
  dezembro: 'DEZEMBRO',
};

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function rankRunners(data: { name: string; km: number }[]): RunnerResult[] {
  return [...data].sort((a, b) => b.km - a.km).map((r, i) => ({ ...r, position: i + 1 }));
}

function formatKm(km: number): string {
  return km === 0 ? '0km' : `${km.toFixed(2)}km`;
}

function getMedal(position: number): string {
  return MEDALS[position] ?? '';
}

function calcMonthlyRanking(gender: 'female' | 'male', month: number): RunnerResult[] {
  const participants = loadParticipants();
  const names = gender === 'female' ? participants.female : participants.male;
  const data = loadMonthDataSync(gender, month);

  const kmMap = new Map<string, number>();
  for (const record of data) {
    const totalKm = record.km.reduce((acc, val) => acc + val, 0);
    kmMap.set(normalize(record.name), totalKm);
  }

  const results = names.map((name) => ({
    name,
    km: kmMap.get(normalize(name)) ?? 0,
  }));

  return rankRunners(results);
}

function calcAnnualRanking(): RunnerResult[] {
  const dataDir = path.resolve('data');
  if (!fs.existsSync(dataDir)) return [];

  const participants = loadParticipants();
  const allNames = [...participants.female, ...participants.male];

  const totals = new Map<string, number>();
  for (const name of allNames) totals.set(normalize(name), 0);

  const yearDirs = fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => entry.name);

  for (const yearDir of yearDirs) {
    const yearPath = path.join(dataDir, yearDir);
    const files = fs
      .readdirSync(yearPath)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.') && !['runners.json', 'manifest.json'].includes(f));

    for (const file of files) {
      const raw = fs.readFileSync(path.join(yearPath, file), 'utf-8');
      const records: ParticipantRecord[] = JSON.parse(raw);
      for (const record of records) {
        const key = normalize(record.name);
        const kmSum = record.km.reduce((a, b) => a + b, 0);
        totals.set(key, (totals.get(key) ?? 0) + kmSum);
      }
    }
  }

  const results = allNames.map((name) => ({
    name,
    km: totals.get(normalize(name)) ?? 0,
  }));

  return rankRunners(results);
}

function renderRankingSection(runners: RunnerResult[], filterZero = true): string {
  return runners
    .filter((r) => !filterZero || r.km > 0)
    .map((r) => `${r.position}. ${getMedal(r.position)}${r.name} - ${formatKm(r.km)}`)
    .join('\n');
}

function buildMonthMarkdown(month: number, year: number): string {
  const slug = getMonthName(month);
  const female = calcMonthlyRanking('female', month);
  const male = calcMonthlyRanking('male', month);

  return [
    `*RANKING ENDURANCE - ${MONTH_DISPLAY[slug]} ${year}*`,
    '',
    `*feminino* 🏃‍♀️`,
    renderRankingSection(female),
    '',
    `*masculino* 🏃‍♂️`,
    renderRankingSection(male),
    '',
  ].join('\n');
}

function buildAnnualMarkdown(year: number): string {
  const annual = calcAnnualRanking();
  return ['', `*RANKING ANUAL - ${year}* 🏆 🏅`, renderRankingSection(annual, false), ''].join('\n');
}

function main() {
  try {
    const currentMonth = getCurrentMonth();
    const year = getFullYear();
    const slug = getMonthName(currentMonth);

    const femaleFilePath = getDataFilePath('female', currentMonth);
    const maleFilePath = getDataFilePath('male', currentMonth);

    if (!fs.existsSync(femaleFilePath) || !fs.existsSync(maleFilePath)) {
      throw new Error(`Dados do mês ${slug} não encontrados (${femaleFilePath} ou ${maleFilePath}).`);
    }

    const monthMarkdown = buildMonthMarkdown(currentMonth, year);
    const annualMarkdown = buildAnnualMarkdown(year);
    const markdown = monthMarkdown + annualMarkdown;

    const outputDir = path.resolve('output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.resolve(outputDir, 'ranking.md');
    fs.writeFileSync(outputPath, markdown, 'utf-8');

    console.log(`output/ranking.md gerado com sucesso (${MONTH_DISPLAY[slug]} ${year})`);
  } catch (error) {
    console.error(`Erro: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
