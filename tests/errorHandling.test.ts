import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import test from 'node:test';
import express from 'express';
import { errorHandler, HttpError } from '../backoffice/src/errorHandler';
import { summarizeExecError } from '../backoffice/src/logSafe';
import { createRequestLogger } from '../backoffice/src/requestLogger';
import { createLogger } from '../processor/logger';

async function withServer(run: (baseUrl: string, lines: Record<string, any>[]) => Promise<void>) {
  const lines: Record<string, any>[] = [];
  const destination = new Writable({
    write(chunk, _e, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  const app = express();
  app.use(createRequestLogger(createLogger({ level: 'info', destination })));
  app.use(express.json({ limit: '1kb' }));
  app.post('/api/echo', (_req, res) => void res.json({ ok: true }));
  app.get('/api/user', (_req, res) => {
    res.locals.userId = 'user_123';
    res.json({ ok: true });
  });
  app.get('/api/http-error', (_req, _res, next) => next(new HttpError(409, 'conflito')));
  app.get('/api/crash', (_req, _res, next) => next(new Error('quebrou')));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, lines);
  } finally {
    server.close();
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const post = (url: string, body: string) =>
  fetch(`${url}/api/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

test('JSON malformado responde 400 em JSON, com log e sem vazar o corpo', async () => {
  await withServer(async (url, lines) => {
    const res = await post(url, '{"data":"SEGREDOBASE64", quebrado');
    await settle();

    assert.equal(res.status, 400);
    assert.ok(((await res.json()) as { error?: string }).error);
    assert.ok(lines.length > 0);
    assert.ok(!JSON.stringify(lines).includes('SEGREDOBASE64'));
  });
});

test('corpo acima do limite responde 413 sem vazar o corpo', async () => {
  await withServer(async (url, lines) => {
    const res = await post(url, JSON.stringify({ data: 'SEGREDOBASE64'.repeat(500) }));
    await settle();

    assert.equal(res.status, 413);
    assert.ok(!JSON.stringify(lines).includes('SEGREDOBASE64'));
  });
});

test('HttpError vira warn com o status e erro inesperado vira error com stack', async () => {
  await withServer(async (url, lines) => {
    assert.equal((await fetch(`${url}/api/http-error`)).status, 409);
    assert.equal((await fetch(`${url}/api/crash`)).status, 500);
    await settle();

    const handler = lines.filter((l) => l.msg === 'conflito' || l.msg === 'quebrou');
    assert.equal(handler.find((l) => l.msg === 'conflito')?.level, 'warn');
    const crash = handler.find((l) => l.msg === 'quebrou');
    assert.equal(crash?.level, 'error');
    assert.ok(crash?.err.stack.includes('quebrou'));
  });
});

test('linha da requisição inclui o userId definido em res.locals', async () => {
  await withServer(async (url, lines) => {
    await fetch(`${url}/api/user`);
    await settle();
    assert.equal(lines[0].userId, 'user_123');
  });
});

test('summarizeExecError não inclui stdout, stderr nem cmd', () => {
  const err = Object.assign(new Error('Command failed: bash x\nSEGREDO-STDERR'), {
    code: 1,
    signal: null,
    killed: false,
    stdout: 'SEGREDO-STDOUT',
    stderr: 'SEGREDO-STDERR',
    cmd: 'bash x',
  });

  const summary = summarizeExecError(err);

  assert.deepEqual(summary, { code: 1, signal: null, killed: false });
  assert.ok(!JSON.stringify(summary).includes('SEGREDO'));
});
