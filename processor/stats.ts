import { loadParticipants, normalize } from './participantsParser';
import { getMonthName, loadMonthDataSync } from './jsonUpdater';
import { calcMonthlyRanking, listRankingPeriods, MONTH_DISPLAY } from './ranking';
import { capitalizeFirstLetter, getCurrentMonth } from './utils';

type Gender = 'female' | 'male';

const GENDERS: Gender[] = ['female', 'male'];
const TOP_CUMULATIVE = 5;
const DISTANCE_BUCKETS = [
  { label: 'até 5 km', max: 5 },
  { label: '5–10 km', max: 10 },
  { label: '10–15 km', max: 15 },
  { label: '15–21 km', max: 21 },
  { label: '21 km ou mais', max: Infinity },
];

interface Runner {
  key: string;
  name: string;
  gender: Gender;
}

// atividades (km > 0) de cada corredor em um mês, indexadas pelo nome normalizado
type MonthActivities = Map<string, number[]>;

interface MonthData {
  month: number;
  activities: MonthActivities;
  // false quando o mês guarda só o total mensal de cada corredor (um valor por pessoa), sem as corridas
  detailed: boolean;
}

export interface MonthStats {
  month: number;
  monthName: string;
  closed: boolean;
  female: number;
  male: number;
  total: number;
  activeRunners: number;
  activities: number | null;
}

export interface RunnerStats {
  name: string;
  gender: Gender;
  km: number;
  activities: number;
  activeMonths: number;
  wins: number;
}

export interface MonthWinner {
  name: string;
  km: number;
}

export interface MonthWinners {
  month: number;
  monthName: string;
  female: MonthWinner | null;
  male: MonthWinner | null;
}

export interface Stats {
  year: number;
  years: number[];
  yearTotals: { year: number; km: number }[];
  months: MonthStats[];
  runners: RunnerStats[];
  winners: MonthWinners[];
  cumulativeTop5: { name: string; gender: Gender; values: number[] }[];
  distances: { label: string; count: number }[];
  longestRun: { name: string; km: number; month: number; monthName: string } | null;
}

const sum = (values: number[]) => values.reduce((acc, v) => acc + v, 0);

function displayMonthName(month: number): string {
  return capitalizeFirstLetter(MONTH_DISPLAY[getMonthName(month)]);
}

function loadRunners(): Runner[] {
  const participants = loadParticipants();
  return GENDERS.flatMap((gender) => participants[gender].map((name) => ({ key: normalize(name), name, gender })));
}

function loadMonth(month: number, year: number, runners: Runner[]): MonthData {
  const known = new Set(runners.map((r) => r.key));
  const activities: MonthActivities = new Map();
  for (const gender of GENDERS) {
    for (const record of loadMonthDataSync(gender, month, year)) {
      const key = normalize(record.name);
      if (!known.has(key)) continue;
      activities.set(key, [...(activities.get(key) ?? []), ...record.km.filter((km) => km > 0)]);
    }
  }
  const detailed = [...activities.values()].some((kms) => kms.length > 1);
  return { month, activities, detailed };
}

function isClosed(month: number, year: number): boolean {
  const currentYear = new Date().getFullYear();
  return year < currentYear || (year === currentYear && month < getCurrentMonth());
}

function runnerKm(data: MonthData, runner: Runner): number[] {
  return data.activities.get(runner.key) ?? [];
}

function buildMonthStats(data: MonthData, year: number, runners: Runner[]): MonthStats {
  const genderTotal = (gender: Gender) =>
    sum(runners.filter((r) => r.gender === gender).map((r) => sum(runnerKm(data, r))));
  const female = genderTotal('female');
  const male = genderTotal('male');
  const perRunner = runners.map((r) => runnerKm(data, r));

  return {
    month: data.month,
    monthName: displayMonthName(data.month),
    closed: isClosed(data.month, year),
    female,
    male,
    total: female + male,
    activeRunners: perRunner.filter((kms) => kms.length > 0).length,
    activities: data.detailed ? sum(perRunner.map((kms) => kms.length)) : null,
  };
}

function findWinner(gender: Gender, month: number, year: number): MonthWinner | null {
  const [first] = calcMonthlyRanking(gender, month, year);
  return first && first.km > 0 ? { name: first.name, km: first.km } : null;
}

function buildWinners(months: MonthData[], year: number): MonthWinners[] {
  return months
    .filter((data) => isClosed(data.month, year))
    .map((data) => ({
      month: data.month,
      monthName: displayMonthName(data.month),
      female: findWinner('female', data.month, year),
      male: findWinner('male', data.month, year),
    }));
}

function buildRunnerStats(months: MonthData[], runners: Runner[], winners: MonthWinners[]): RunnerStats[] {
  const winnerNames = winners.flatMap((w) => [w.female?.name, w.male?.name]).filter(Boolean);

  return runners
    .map((runner) => {
      const perMonth = months.map((data) => runnerKm(data, runner));
      const detailedMonths = months.filter((data) => data.detailed).map((data) => runnerKm(data, runner));
      return {
        name: runner.name,
        gender: runner.gender,
        km: sum(perMonth.map(sum)),
        activities: sum(detailedMonths.map((kms) => kms.length)),
        activeMonths: perMonth.filter((kms) => kms.length > 0).length,
        wins: winnerNames.filter((name) => name === runner.name).length,
      };
    })
    .sort((a, b) => b.km - a.km);
}

function buildCumulativeTop(months: MonthData[], runners: Runner[], ranked: RunnerStats[]) {
  return ranked
    .filter((r) => r.km > 0)
    .slice(0, TOP_CUMULATIVE)
    .map((stats) => {
      const runner = runners.find((r) => r.name === stats.name)!;
      let total = 0;
      const values = months.map((data) => (total += sum(runnerKm(data, runner))));
      return { name: stats.name, gender: stats.gender, values };
    });
}

function buildDistances(months: MonthData[]): { label: string; count: number }[] {
  const counts = DISTANCE_BUCKETS.map(() => 0);
  for (const data of months.filter((m) => m.detailed)) {
    for (const kms of data.activities.values()) {
      for (const km of kms) counts[DISTANCE_BUCKETS.findIndex((b) => km < b.max)]++;
    }
  }
  return DISTANCE_BUCKETS.map((b, i) => ({ label: b.label, count: counts[i] }));
}

function findLongestRun(months: MonthData[], runners: Runner[]): Stats['longestRun'] {
  let longest: Stats['longestRun'] = null;
  for (const data of months.filter((m) => m.detailed)) {
    for (const runner of runners) {
      for (const km of runnerKm(data, runner)) {
        if (!longest || km > longest.km) {
          longest = { name: runner.name, km, month: data.month, monthName: displayMonthName(data.month) };
        }
      }
    }
  }
  return longest;
}

function calcYearTotal(year: number, months: number[], runners: Runner[]): number {
  return sum(months.map((month) => sum([...loadMonth(month, year, runners).activities.values()].map(sum))));
}

export function buildStats(year: number): Stats {
  const periods = listRankingPeriods();
  const period = periods.find((p) => p.year === year);
  if (!period) throw new Error(`Não há dados para ${year}`);

  const runners = loadRunners();
  const months = period.months.map((month) => loadMonth(month, year, runners));
  const winners = buildWinners(months, year);
  const ranked = buildRunnerStats(months, runners, winners);

  return {
    year,
    years: periods.map((p) => p.year),
    yearTotals: periods.map((p) => ({ year: p.year, km: calcYearTotal(p.year, p.months, runners) })),
    months: months.map((data) => buildMonthStats(data, year, runners)),
    runners: ranked,
    winners,
    cumulativeTop5: buildCumulativeTop(months, runners, ranked),
    distances: buildDistances(months),
    longestRun: findLongestRun(months, runners),
  };
}
