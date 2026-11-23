import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDataSource } from '../processor/dataSource';
import { calcMonthlyRanking, listRankingPeriods } from '../processor/ranking';

const source = memoryDataSource({
  'runners.json': '{"female":["Ana"],"male":[]}',
  '2026/female-maio.json': '[]',
});

test('memoryDataSource lê arquivos e retorna null para ausentes', () => {
  assert.equal(source.readText('runners.json'), '{"female":["Ana"],"male":[]}');
  assert.equal(source.readText('x'), null);
  assert.deepEqual(source.listYears(), [2026]);
});

test('listRankingPeriods usa a fonte injetada', () => {
  assert.deepEqual(listRankingPeriods(source), [{ year: 2026, months: [5] }]);
});

test('calcMonthlyRanking usa a fonte injetada', () => {
  const ranking = calcMonthlyRanking('female', 5, 2026, source);
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].name, 'Ana');
  assert.equal(ranking[0].km, 0);
});
