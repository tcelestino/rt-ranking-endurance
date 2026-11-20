import { DataSource, fsDataSource } from './dataSource';
import { loadParticipants, normalize } from './participantsParser';
import { getMonthName, loadMonthDataSync, monthRelPath } from './jsonUpdater';
import { addPaceTotals, averagePace, formatPace, PaceTotals, paceTotals } from './pace';

export interface RunnerResult {
  name: string;
  km: number;
  // pace médio ponderado pela distância (s/km); null sem atividades com pace
  pace: number | null;
  position: number;
}

export const MONTH_DISPLAY: Record<string, string> = {
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

function rankRunners(data: Omit<RunnerResult, 'position'>[]): RunnerResult[] {
  return [...data].sort((a, b) => b.km - a.km).map((r, i) => ({ ...r, position: i + 1 }));
}

function formatKm(km: number): string {
  return km === 0 ? '0km' : `${km.toFixed(2)}km`;
}

function getMedal(position: number): string {
  return MEDALS[position] ?? '';
}

export interface RankingPeriod {
  year: number;
  months: number[];
}

const GENDERS = ['female', 'male'] as const;

export function listRankingPeriods(source: DataSource = fsDataSource): RankingPeriod[] {
  return source
    .listYears()
    .map((year) => {
      const months = Array.from({ length: 12 }, (_, i) => i + 1).filter((month) =>
        GENDERS.some((gender) => source.readText(monthRelPath(gender, month, year)) !== null),
      );
      return { year, months };
    })
    .filter((period) => period.months.length > 0)
    .sort((a, b) => a.year - b.year);
}

export function calcMonthlyRanking(
  gender: 'female' | 'male',
  month: number,
  year?: number,
  source: DataSource = fsDataSource,
): RunnerResult[] {
  const participants = loadParticipants(source);
  const names = gender === 'female' ? participants.female : participants.male;
  const data = loadMonthDataSync(gender, month, year, source);

  const kmMap = new Map<string, number>();
  const paceMap = new Map<string, PaceTotals>();
  for (const record of data) {
    const totalKm = record.km.reduce((acc, val) => acc + val, 0);
    kmMap.set(normalize(record.name), totalKm);
    paceMap.set(normalize(record.name), paceTotals(record.km, record.pace));
  }

  const results = names.map((name) => {
    const pace = paceMap.get(normalize(name));
    return {
      name,
      km: kmMap.get(normalize(name)) ?? 0,
      pace: pace ? averagePace(pace) : null,
    };
  });

  return rankRunners(results);
}

export function calcAnnualRanking(year: number, source: DataSource = fsDataSource): RunnerResult[] {
  const participants = loadParticipants(source);
  const allNames = [...participants.female, ...participants.male];

  const totals = new Map<string, number>();
  const paces = new Map<string, PaceTotals>();
  for (const name of allNames) totals.set(normalize(name), 0);

  for (let month = 1; month <= 12; month++) {
    for (const gender of GENDERS) {
      for (const record of loadMonthDataSync(gender, month, year, source)) {
        const key = normalize(record.name);
        const kmSum = record.km.reduce((a, b) => a + b, 0);
        totals.set(key, (totals.get(key) ?? 0) + kmSum);
        paces.set(key, addPaceTotals(paces.get(key) ?? { km: 0, seconds: 0 }, paceTotals(record.km, record.pace)));
      }
    }
  }

  const results = allNames.map((name) => {
    const pace = paces.get(normalize(name));
    return {
      name,
      km: totals.get(normalize(name)) ?? 0,
      pace: pace ? averagePace(pace) : null,
    };
  });

  return rankRunners(results);
}

export function calcTotalKm(runners: RunnerResult[]): number {
  return runners.reduce((acc, r) => acc + r.km, 0);
}

function renderRankingSection(runners: RunnerResult[], filterZero = true): string {
  const lines = runners
    .filter((r) => !filterZero || r.km > 0)
    .map((r) => {
      const pace = r.pace === null ? '' : ` (${formatPace(r.pace)})`;
      return `${r.position}. ${getMedal(r.position)}${r.name} - ${formatKm(r.km)}${pace}`;
    });

  lines.push(`Total: ${formatKm(calcTotalKm(runners))}`);

  return lines.join('\n');
}

function buildMonthMarkdown(month: number, year: number, source: DataSource): string {
  const slug = getMonthName(month);
  const female = calcMonthlyRanking('female', month, year, source);
  const male = calcMonthlyRanking('male', month, year, source);

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

function buildAnnualMarkdown(year: number, source: DataSource): string {
  const annual = calcAnnualRanking(year, source);
  return ['', `*RANKING ANUAL - ${year}* 🏆 🏅`, renderRankingSection(annual, false), ''].join('\n');
}

export function buildRankingMarkdown(month: number, year: number, source: DataSource = fsDataSource): string {
  return buildMonthMarkdown(month, year, source) + buildAnnualMarkdown(year, source);
}
