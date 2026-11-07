import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPaceStats, FASTEST_RUNS_LIMIT, type PaceRow } from '../processor/paceStats';

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
    const { runners } = buildPaceStats(ROWS);
    const avg = Object.fromEntries(runners.map((r) => [r.name, r.avgPace]));
    assert.deepEqual(avg, { Ana: 320, Bia: 280, Caio: 318 });
    assert.deepEqual(
      runners.map((r) => r.name),
      ['Bia', 'Caio', 'Ana'],
    );
  });

  it('runners traz a melhor atividade de cada corredor', () => {
    const { runners } = buildPaceStats(ROWS);
    const ana = runners.find((r) => r.name === 'Ana')!;
    const caio = runners.find((r) => r.name === 'Caio')!;
    assert.deepEqual([ana.bestPace, ana.bestPaceKm, ana.bestPaceMonth], [300, 10, 11]);
    assert.deepEqual([caio.bestPace, caio.bestPaceKm, caio.bestPaceMonth], [270, 2, 11]);
    assert.deepEqual([ana.activities, ana.km], [2, 15]);
  });

  it('corredor com uma atividade tem avgPace igual a bestPace', () => {
    const bia = buildPaceStats(ROWS).runners.find((r) => r.name === 'Bia')!;
    assert.deepEqual([bia.avgPace, bia.bestPace], [280, 280]);
  });

  it('fastestRuns lista as mais rápidas e respeita o limite', () => {
    assert.equal(buildPaceStats(ROWS).fastestRuns[0].name, 'Caio');
    const many = Array.from({ length: 12 }, (_, i) => row(`R${i}`, 'male', 11, 5, 300 + i));
    const { fastestRuns } = buildPaceStats(many);
    assert.equal(fastestRuns.length, FASTEST_RUNS_LIMIT);
    assert.equal(fastestRuns[0].pace, 300);
  });

  it('byMonth separa por gênero e deixa null quando o gênero não correu', () => {
    const { byMonth } = buildPaceStats(ROWS);
    assert.deepEqual(byMonth, [
      { month: 10, female: null, male: 330 },
      { month: 11, female: 312, male: 270 },
    ]);
  });

  it('runs traz todas as atividades com pace', () => {
    const { runs } = buildPaceStats(ROWS);
    assert.equal(runs.length, ROWS.length);
    assert.deepEqual(
      runs.map((r) => [r.name, r.km, r.pace]),
      ROWS.map((r) => [r.name, r.km, r.pace]),
    );
  });

  it('groupPace é a média ponderada de todas as linhas', () => {
    // (3000 + 1800 + 1120 + 2640 + 540) / 29 = 9100 / 29
    assert.equal(buildPaceStats(ROWS).groupPace, Math.round(9100 / 29));
  });

  it('sem linhas devolve estruturas vazias', () => {
    const stats = buildPaceStats([]);
    assert.deepEqual(stats.runners, []);
    assert.deepEqual(stats.fastestRuns, []);
    assert.deepEqual(stats.byMonth, []);
    assert.equal(stats.groupPace, null);
    assert.deepEqual(stats.runs, []);
  });

  it('empate de pace desempata por nome', () => {
    const rows = [row('Zeca', 'male', 11, 5, 300), row('Ana', 'female', 11, 5, 300)];
    const { runners, fastestRuns } = buildPaceStats(rows);
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
