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
