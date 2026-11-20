import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentMonth, getCurrentYear } from '../processor/utils';

const original = process.env.CURRENT_MONTH;
afterEach(() => {
  if (original === undefined) delete process.env.CURRENT_MONTH;
  else process.env.CURRENT_MONTH = original;
});

test('getCurrentMonth usa America/Sao_Paulo', () => {
  delete process.env.CURRENT_MONTH;
  assert.equal(getCurrentMonth(new Date('2026-12-01T02:30:00Z')), 11);
});

test('getCurrentYear usa America/Sao_Paulo', () => {
  assert.equal(getCurrentYear(new Date('2027-01-01T02:30:00Z')), 2026);
});

test('CURRENT_MONTH sobrescreve o mês', () => {
  process.env.CURRENT_MONTH = '4';
  assert.equal(getCurrentMonth(new Date('2026-12-15T12:00:00Z')), 4);
});

test('getCurrentMonth com override explícito vence o relógio e process.env', () => {
  process.env.CURRENT_MONTH = '7';
  assert.equal(getCurrentMonth(new Date('2026-12-15T12:00:00Z'), '4'), 4);
});

test('getCurrentMonth com override indefinido ignora process.env e usa o relógio', () => {
  process.env.CURRENT_MONTH = '7';
  assert.equal(getCurrentMonth(new Date('2026-12-15T12:00:00Z'), undefined), 12);
});

test('getCurrentMonth com override inválido cai no relógio', () => {
  assert.equal(getCurrentMonth(new Date('2026-12-15T12:00:00Z'), '13'), 12);
});

test('getCurrentMonth sem override mantém process.env.CURRENT_MONTH', () => {
  process.env.CURRENT_MONTH = '7';
  assert.equal(getCurrentMonth(new Date('2026-12-15T12:00:00Z')), 7);
});
