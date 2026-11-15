import assert from 'node:assert/strict';
import test from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { maskKm, maskKmWithCaret, kmToInput, parseKmInput } = require('../backoffice/public/kmMask.js');

const cases: [string, string, string][] = [
  ['vazio continua vazio', '', ''],
  ['1 dígito sem ponto', '5', '5'],
  ['2 dígitos sem ponto', '10', '10'],
  ['3 dígitos viram n.dd', '525', '5.25'],
  ['4 dígitos viram nn.dd', '1050', '10.50'],
  ['5 dígitos viram nnn.dd', '10050', '100.50'],
  ['descarta dígitos excedentes', '1234567', '123.45'],
  ['backspace sobre a ponto não a reinsere', '5.', '5'],
  ['idempotente', '10.50', '10.50'],
  ['ignora letras e vírgula', '1a0,5', '1.05'],
];

for (const [name, input, expected] of cases) {
  test(`maskKm: ${name}`, () => {
    assert.equal(maskKm(input), expected);
  });
}

const caretCases: [string, string, number, string, number][] = [
  ['digitando no fim mantém cursor no fim', '525', 3, '5.25', 4],
  ['backspace no meio não joga o cursor para o fim', '525', 1, '5.25', 1],
  ['sem mudança preserva cursor', '5.25', 2, '5.25', 2],
  ['vazio', '', 0, '', 0],
];

for (const [name, raw, caret, value, pos] of caretCases) {
  test(`maskKmWithCaret: ${name}`, () => {
    assert.deepEqual(maskKmWithCaret(raw, caret), { value, caret: pos });
  });
}

test('kmToInput formata com duas casas', () => {
  assert.equal(kmToInput(10.5), '10.50');
  assert.equal(kmToInput(5), '5.00');
  assert.equal(kmToInput(null), '');
});

test('parseKmInput converte texto em número', () => {
  assert.equal(parseKmInput('10.50'), 10.5);
  assert.equal(parseKmInput('7'), 7);
  assert.equal(parseKmInput(''), null);
});
