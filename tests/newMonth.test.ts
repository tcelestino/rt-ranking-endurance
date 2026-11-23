import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryDataSource } from '../processor/dataSource';
import { isManifestCurrent, planNewMonth } from '../processor/manifest';

const base: Record<string, string> = {
  'runners.json': '{"female":["Ana"],"male":["Beto"]}',
  '2026/female-novembro.json': '[{"name":"Ana","km":[5]}]',
  '2026/male-novembro.json': '[{"name":"Beto","km":[3]}]',
};

test('planNewMonth cria os JSONs do mês e regenera o manifest', () => {
  const plan = planNewMonth(memoryDataSource(base), 12, 2026);
  assert.deepEqual(plan.createdFiles, ['female-dezembro.json', 'male-dezembro.json']);
  assert.equal(plan.files['2026/female-dezembro.json'], '[\n  {\n    "name": "Ana",\n    "km": [\n      0\n    ]\n  }\n]\n');
  assert.deepEqual(JSON.parse(plan.files['2026/male-dezembro.json']), [{ name: 'Beto', km: [0] }]);
  const manifest = JSON.parse(plan.files['manifest.json']);
  assert.equal(manifest.year, 2026);
  assert.equal(manifest.currentMonth, 12);
  assert.deepEqual(
    manifest.months.map((m: { slug: string }) => m.slug),
    ['novembro', 'dezembro'],
  );
});

test('planNewMonth não recria meses existentes e isManifestCurrent fica verdadeiro', () => {
  const first = planNewMonth(memoryDataSource(base), 12, 2026);
  const source = memoryDataSource({ ...base, ...first.files });
  assert.equal(isManifestCurrent(source, 12, 2026), true);
  const second = planNewMonth(source, 12, 2026);
  assert.deepEqual(second.createdFiles, []);
  assert.deepEqual(Object.keys(second.files), ['manifest.json']);
});

test('isManifestCurrent é falso antes de planejar o mês', () => {
  assert.equal(isManifestCurrent(memoryDataSource(base), 12, 2026), false);
});

test('planNewMonth falha sem corredores de um gênero', () => {
  const source = memoryDataSource({ ...base, 'runners.json': '{"female":["Ana"],"male":[]}' });
  assert.throws(() => planNewMonth(source, 12, 2026), /Nenhum corredor/);
});
