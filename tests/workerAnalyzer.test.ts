import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeImage } from '../worker/src/analyzer';
import { base64ToBytes, sha256Hex } from '../worker/src/bytes';
import { HttpError } from '../worker/src/errors';
import { computeHashFromBuffer } from '../processor/cacheManager';

function fakeAi(result: unknown) {
  const calls: { model: string; input: any }[] = [];
  return {
    calls,
    run: async (model: string, input: unknown) => {
      calls.push({ model, input });
      return result;
    },
  };
}

test('analyzeImage interpreta km e pace da resposta do binding', async () => {
  const ai = fakeAi({ response: '{"km": 10.5, "pace": "5:45"}' });
  const result = await analyzeImage(ai, new Uint8Array([1, 2, 3]), 'image/png');
  assert.deepEqual(result, { km: 10.5, pace: 345 });
  assert.equal(ai.calls[0].model, '@cf/meta/llama-3.2-11b-vision-instruct');
  assert.equal(ai.calls[0].input.max_tokens, 60);
});

test('analyzeImage aceita resposta já parseada como objeto', async () => {
  const ai = fakeAi({ response: { km: 5.25, pace: null } });
  assert.deepEqual(await analyzeImage(ai, new Uint8Array([1]), 'image/png'), { km: 5.25, pace: null });
});

test('analyzeImage usa o modelo informado', async () => {
  const ai = fakeAi({ response: '{"km": 1, "pace": null}' });
  await analyzeImage(ai, new Uint8Array([1]), 'image/png', '@cf/outro/modelo');
  assert.equal(ai.calls[0].model, '@cf/outro/modelo');
});

test('analyzeImage envia imagens grandes como data URI sem estourar a pilha', async () => {
  const bytes = new Uint8Array(200 * 1024).map((_, i) => i % 256);
  const ai = fakeAi({ response: '{"km": 1, "pace": null}' });
  await analyzeImage(ai, bytes, 'image/jpeg');
  const content = ai.calls[0].input.messages[0].content;
  assert.equal(content[0].type, 'text');
  const url: string = content[1].image_url.url;
  assert.ok(url.startsWith('data:image/jpeg;base64,'));
  assert.deepEqual(base64ToBytes(url.slice('data:image/jpeg;base64,'.length)), bytes);
});

test('analyzeImage lança quando o binding não retorna resposta', async () => {
  for (const result of [{}, { response: null }, null]) {
    await assert.rejects(
      analyzeImage(fakeAi(result), new Uint8Array([1]), 'image/png'),
      /Workers AI não retornou resposta/,
    );
  }
});

test('sha256Hex de "abc" bate com o vetor conhecido', async () => {
  const hash = await sha256Hex(new TextEncoder().encode('abc'));
  assert.equal(hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256Hex é igual ao computeHashFromBuffer do processor', async () => {
  const buffer = Buffer.from('conteúdo da imagem');
  assert.equal(await sha256Hex(new Uint8Array(buffer)), computeHashFromBuffer(buffer));
});

test('base64ToBytes decodifica base64 válido', () => {
  assert.deepEqual(base64ToBytes('AQID'), new Uint8Array([1, 2, 3]));
});

test('base64ToBytes lança 400 para base64 malformado', () => {
  assert.throws(
    () => base64ToBytes('!!!'),
    (err) => err instanceof HttpError && err.status === 400 && /malformado/.test(err.message),
  );
});

test('base64ToBytes lança 400 para string vazia', () => {
  assert.throws(
    () => base64ToBytes(''),
    (err) => err instanceof HttpError && err.status === 400 && /vazia/.test(err.message),
  );
});
