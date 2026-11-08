import { averagePace } from './pace';

export type Gender = 'female' | 'male';

// uma linha por atividade com pace registrado
export interface PaceRow {
  name: string;
  gender: Gender;
  month: number;
  km: number;
  pace: number;
}

export interface RunnerPace {
  name: string;
  gender: Gender;
  avgPace: number;
  bestPace: number;
  bestPaceKm: number;
  bestPaceMonth: number;
  activities: number;
  km: number;
}

export interface GenderPace {
  female: number | null;
  male: number | null;
}

export interface PaceStats {
  runners: RunnerPace[];
  fastestRuns: PaceRow[];
  byMonth: ({ month: number } & GenderPace)[];
  // todas as atividades com pace, para o gráfico de dispersão
  runs: PaceRow[];
  groupPace: number | null;
}

export const FASTEST_RUNS_LIMIT = 10;

// média ponderada pela distância; null quando não há linhas
function weightedPace(rows: PaceRow[]): number | null {
  return averagePace({
    km: rows.reduce((acc, r) => acc + r.km, 0),
    seconds: rows.reduce((acc, r) => acc + r.km * r.pace, 0),
  });
}

function genderPace(rows: PaceRow[]): GenderPace {
  return {
    female: weightedPace(rows.filter((r) => r.gender === 'female')),
    male: weightedPace(rows.filter((r) => r.gender === 'male')),
  };
}

function groupBy<T>(items: T[], key: (item: T) => string | number): Map<string | number, T[]> {
  const groups = new Map<string | number, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

const byPaceThenName = (a: { pace: number; name: string }, b: { pace: number; name: string }) =>
  a.pace - b.pace || a.name.localeCompare(b.name);

function buildRunners(rows: PaceRow[]): RunnerPace[] {
  return [...groupBy(rows, (r) => r.name).values()]
    .map((own) => {
      const best = [...own].sort(byPaceThenName)[0];
      return {
        name: best.name,
        gender: best.gender,
        avgPace: weightedPace(own)!,
        bestPace: best.pace,
        bestPaceKm: best.km,
        bestPaceMonth: best.month,
        activities: own.length,
        km: own.reduce((acc, r) => acc + r.km, 0),
      };
    })
    .sort((a, b) => a.avgPace - b.avgPace || a.name.localeCompare(b.name));
}

export function buildPaceStats(rows: PaceRow[]): PaceStats {
  const months = [...groupBy(rows, (r) => r.month).entries()].sort(([a], [b]) => Number(a) - Number(b));

  return {
    runners: buildRunners(rows),
    fastestRuns: [...rows].sort(byPaceThenName).slice(0, FASTEST_RUNS_LIMIT),
    byMonth: months.map(([month, own]) => ({ month: Number(month), ...genderPace(own) })),
    runs: rows,
    groupPace: weightedPace(rows),
  };
}
