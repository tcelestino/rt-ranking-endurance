import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMonthStats, type MonthData, type Runner } from '../processor/stats';

const RUNNERS: Runner[] = [
  { key: 'ana', name: 'Ana', gender: 'female' },
  { key: 'bia', name: 'Bia', gender: 'female' },
  { key: 'caio', name: 'Caio', gender: 'male' },
];

const monthData = (kms: Record<string, number[]>, detailed: boolean): MonthData => ({
  month: 4,
  activities: new Map(Object.entries(kms)),
  paced: new Map(),
  detailed,
});

describe('buildMonthStats', () => {
  it('conta corridas por gênero e no total', () => {
    const stats = buildMonthStats(monthData({ ana: [5, 10], bia: [3], caio: [8, 9, 4] }, true), 2026, RUNNERS);
    assert.deepEqual([stats.femaleActivities, stats.maleActivities, stats.activities], [3, 3, 6]);
  });

  it('devolve null por gênero quando o mês guarda só o total mensal', () => {
    const stats = buildMonthStats(monthData({ ana: [20], caio: [30] }, false), 2026, RUNNERS);
    assert.deepEqual([stats.femaleActivities, stats.maleActivities, stats.activities], [null, null, null]);
  });
});
