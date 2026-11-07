import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPaceStats, FASTEST_RUNS_LIMIT, type DistanceBucket, type PaceRow } from '../processor/paceStats';

const BUCKETS: DistanceBucket[] = [
  { label: 'até 5 km', max: 5 },
  { label: '5–10 km', max: 10 },
  { label: '10 km ou mais', max: Infinity },
];

const row = (name: string, gender: PaceRow['gender'], month: number, km: number, pace: number): PaceRow => ({
  name,
  gender,
  month,
  km,
  pace,
});

const ROWS: PaceRow[] = [
  row('Ana', 'female', 11, 10, 300),
  row('Ana', 'female', 11, 5, 360),
  row('Bia', 'female', 11, 4, 280),
  row('Caio', 'male', 10, 8, 330),
  row('Caio', 'male', 11, 2, 270),
];

describe('buildPaceStats', () => {
  it('runners ordena pelo pace médio ponderado', () => {
    const { runners } = buildPaceStats(ROWS, BUCKETS);
    const avg = Object.fromEntries(runners.map((r) => [r.name, r.avgPace]));
    assert.deepEqual(avg, { Ana: 320, Bia: 280, Caio: 318 });
    assert.deepEqual(
      runners.map((r) => r.name),
      ['Bia', 'Caio', 'Ana'],
    );
  });

  it('runners traz a melhor atividade de cada corredor', () => {
    const { runners } = buildPaceStats(ROWS, BUCKETS);
    const ana = runners.find((r) => r.name === 'Ana')!;
    const caio = runners.find((r) => r.name === 'Caio')!;
    assert.deepEqual([ana.bestPace, ana.bestPaceKm, ana.bestPaceMonth], [300, 10, 11]);
    assert.deepEqual([caio.bestPace, caio.bestPaceKm, caio.bestPaceMonth], [270, 2, 11]);
    assert.deepEqual([ana.activities, ana.km], [2, 15]);
  });

  it('corredor com uma atividade tem avgPace igual a bestPace', () => {
    const bia = buildPaceStats(ROWS, BUCKETS).runners.find((r) => r.name === 'Bia')!;
    assert.deepEqual([bia.avgPace, bia.bestPace], [280, 280]);
  });

  it('fastestRuns lista as mais rápidas e respeita o limite', () => {
    assert.equal(buildPaceStats(ROWS, BUCKETS).fastestRuns[0].name, 'Caio');
    const many = Array.from({ length: 12 }, (_, i) => row(`R${i}`, 'male', 11, 5, 300 + i));
    const { fastestRuns } = buildPaceStats(many, BUCKETS);
    assert.equal(fastestRuns.length, FASTEST_RUNS_LIMIT);
    assert.equal(fastestRuns[0].pace, 300);
  });

  it('byMonth separa por gênero e deixa null quando o gênero não correu', () => {
    const { byMonth } = buildPaceStats(ROWS, BUCKETS);
    assert.deepEqual(byMonth, [
      { month: 10, female: null, male: 330 },
      { month: 11, female: 312, male: 270 },
    ]);
  });

  it('byDistance usa a regra km < max e devolve uma entrada por faixa', () => {
    const { byDistance } = buildPaceStats([row('Ana', 'female', 11, 5, 400)], BUCKETS);
    assert.deepEqual(byDistance, [
      { label: 'até 5 km', female: null, male: null },
      { label: '5–10 km', female: 400, male: null },
      { label: '10 km ou mais', female: null, male: null },
    ]);
  });

  it('groupPace é a média ponderada de todas as linhas', () => {
    // (3000 + 1800 + 1120 + 2640 + 540) / 29 = 9100 / 29
    assert.equal(buildPaceStats(ROWS, BUCKETS).groupPace, Math.round(9100 / 29));
  });

  it('sem linhas devolve estruturas vazias', () => {
    const stats = buildPaceStats([], BUCKETS);
    assert.deepEqual(stats.runners, []);
    assert.deepEqual(stats.fastestRuns, []);
    assert.deepEqual(stats.byMonth, []);
    assert.equal(stats.groupPace, null);
    assert.equal(stats.byDistance.length, BUCKETS.length);
    assert.ok(stats.byDistance.every((d) => d.female === null && d.male === null));
  });

  it('empate de pace desempata por nome', () => {
    const rows = [row('Zeca', 'male', 11, 5, 300), row('Ana', 'female', 11, 5, 300)];
    const { runners, fastestRuns } = buildPaceStats(rows, BUCKETS);
    assert.deepEqual(
      runners.map((r) => r.name),
      ['Ana', 'Zeca'],
    );
    assert.deepEqual(
      fastestRuns.map((r) => r.name),
      ['Ana', 'Zeca'],
    );
  });
});
