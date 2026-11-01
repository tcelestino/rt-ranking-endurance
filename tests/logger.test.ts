import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';
import { createLogger } from '../processor/logger';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  return { lines, destination };
}

test('emite JSON com level como label, timestamp ISO e service', () => {
  const { lines, destination } = capture();
  createLogger({ level: 'info', destination }).info({ runner: 'Eli' }, 'olá');

  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'info');
  assert.equal(lines[0].msg, 'olá');
  assert.equal(lines[0].runner, 'Eli');
  assert.equal(lines[0].service, 'rt-ranking-backoffice');
  assert.match(String(lines[0].time), /^\d{4}-\d{2}-\d{2}T/);
});

test('respeita OTEL_SERVICE_NAME', () => {
  process.env.OTEL_SERVICE_NAME = 'outro-servico';
  try {
    const { lines, destination } = capture();
    createLogger({ level: 'info', destination }).info('x');
    assert.equal(lines[0].service, 'outro-servico');
  } finally {
    delete process.env.OTEL_SERVICE_NAME;
  }
});

test('redige authorization, cookie e tokens', () => {
  const { lines, destination } = capture();
  createLogger({ level: 'info', destination }).info(
    { req: { headers: { authorization: 'Bearer segredo', cookie: 'a=b', accept: '*/*' } }, config: { apiToken: 't' } },
    'req',
  );

  const line = JSON.stringify(lines[0]);
  assert.ok(!line.includes('segredo'));
  assert.ok(!line.includes('a=b'));
  assert.deepEqual((lines[0].req as { headers: Record<string, string> }).headers.accept, '*/*');
  assert.equal((lines[0].config as { apiToken: string }).apiToken, '[Redacted]');
});

test('serializa erros sob a chave err com stack', () => {
  const { lines, destination } = capture();
  createLogger({ level: 'info', destination }).error({ err: new Error('boom') }, 'falhou');

  const err = lines[0].err as { message: string; stack: string };
  assert.equal(err.message, 'boom');
  assert.ok(err.stack.includes('Error: boom'));
});

test('sem LOG_LEVEL o logger fica silent', () => {
  const previous = process.env.LOG_LEVEL;
  delete process.env.LOG_LEVEL;
  try {
    const { lines, destination } = capture();
    const log = createLogger({ destination });
    log.info('não deve sair');
    log.error('nem este');
    assert.equal(log.level, 'silent');
    assert.equal(lines.length, 0);
  } finally {
    if (previous !== undefined) process.env.LOG_LEVEL = previous;
  }
});
