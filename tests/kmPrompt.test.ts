import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseActivityResponse } from '../processor/kmPrompt';

describe('parseActivityResponse', () => {
  it('lê JSON em string', () => {
    assert.deepEqual(parseActivityResponse('{"km": 10.5, "pace": "5:45"}'), { km: 10.5, pace: 345 });
  });

  it('lê JSON com texto ao redor', () => {
    assert.deepEqual(parseActivityResponse('Aqui: {"km": 5.25, "pace": null}'), { km: 5.25, pace: null });
  });

  it('lê resposta já parseada como objeto (Workers AI)', () => {
    assert.deepEqual(parseActivityResponse({ km: 10.5, pace: '5:45' }), { km: 10.5, pace: 345 });
  });

  it('lê objeto sem pace', () => {
    assert.deepEqual(parseActivityResponse({ km: 5.25, pace: null }), { km: 5.25, pace: null });
  });

  it('lê número puro', () => {
    assert.deepEqual(parseActivityResponse(7.3), { km: 7.3, pace: null });
  });

  it('falha com contexto quando não há km', () => {
    assert.throws(() => parseActivityResponse('sem numero'), /Não foi possível extrair km/);
  });
});
