import assert from 'node:assert/strict';
import test from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { maskPace } = require('../backoffice/public/paceMask.js');

const cases: [string, string, string][] = [
  ['vazio continua vazio', '', ''],
  ['1 dígito sem dois-pontos', '5', '5'],
  ['2 dígitos sem dois-pontos', '54', '54'],
  ['3 dígitos viram m:ss', '545', '5:45'],
  ['4 dígitos viram mm:ss', '1030', '10:30'],
  ['descarta dígitos excedentes', '123456', '12:34'],
  ['backspace sobre o dois-pontos não o reinsere', '5:', '5'],
  ['idempotente', '5:45', '5:45'],
  ['cola formato com apóstrofo', "5'45\"", '5:45'],
  ['cola formato com /km', '5:45/km', '5:45'],
  ['não valida segundos', '575', '5:75'],
];

for (const [name, input, expected] of cases) {
  test(`maskPace: ${name}`, () => {
    assert.equal(maskPace(input), expected);
  });
}

const { maskPaceWithCaret } = require('../backoffice/public/paceMask.js');

const caretCases: [string, string, number, string, number][] = [
  ['digitando no fim mantém cursor no fim', '545', 3, '5:45', 4],
  ['backspace no meio não joga o cursor para o fim', '545', 1, '5:45', 1],
  ['inserção no início de 2 dígitos', '154', 1, '1:54', 1],
  ['segundos reposicionam o ":"', '10:0', 4, '1:00', 4],
  ['sem mudança preserva cursor', '5:45', 2, '5:45', 2],
  ['vazio', '', 0, '', 0],
];

for (const [name, raw, caret, value, pos] of caretCases) {
  test(`maskPaceWithCaret: ${name}`, () => {
    assert.deepEqual(maskPaceWithCaret(raw, caret), { value, caret: pos });
  });
}
