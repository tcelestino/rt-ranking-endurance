import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import test from 'node:test';
import express from 'express';
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
  app.use(express.json({ limit: '20mb' }));
  app.use(createRequestLogger(createLogger({ level: 'info', destination })));
  app.get('/api/ok', (_req, res) => void res.json({ ok: true }));
  app.get('/api/missing', (_req, res) => void res.status(404).json({ error: 'não achou' }));
  app.get('/api/boom', (_req, res) => void res.status(500).json({ error: 'erro' }));
  app.post('/api/echo', (_req, res) => void res.json({ ok: true }));
  app.get('/index.html', (_req, res) => void res.send('ok'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, lines);
  } finally {
    server.close();
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('loga requisição com reqId, status e duração e devolve x-request-id', async () => {
  await withServer(async (url, lines) => {
    const res = await fetch(`${url}/api/ok`);
    await settle();

    const id = res.headers.get('x-request-id');
    assert.ok(id);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, 'info');
    assert.equal(lines[0].req.id, id);
    assert.equal(lines[0].res.statusCode, 200);
    assert.equal(typeof lines[0].responseTime, 'number');
  });
});

test('4xx vira warn e 5xx vira error', async () => {
  await withServer(async (url, lines) => {
    await fetch(`${url}/api/missing`);
    await fetch(`${url}/api/boom`);
    await settle();

    assert.equal(lines[0].level, 'warn');
    assert.equal(lines[1].level, 'error');
  });
});

test('não loga arquivos estáticos', async () => {
  await withServer(async (url, lines) => {
    await fetch(`${url}/index.html`);
    await settle();
    assert.equal(lines.length, 0);
  });
});

test('reaproveita x-request-id válido e descarta o inválido', async () => {
  await withServer(async (url) => {
    const ok = await fetch(`${url}/api/ok`, { headers: { 'x-request-id': 'abc-123' } });
    assert.equal(ok.headers.get('x-request-id'), 'abc-123');

    const bad = await fetch(`${url}/api/ok`, { headers: { 'x-request-id': 'a'.repeat(200) } });
    assert.notEqual(bad.headers.get('x-request-id'), 'a'.repeat(200));
    assert.match(String(bad.headers.get('x-request-id')), /^[0-9a-f-]{36}$/);
  });
});

test('nunca loga Authorization, Cookie nem o corpo da requisição', async () => {
  await withServer(async (url, lines) => {
    const body = JSON.stringify({ data: 'QUJDREVGRw=='.repeat(50), name: 'Eli' });
    await fetch(`${url}/api/echo`, {
      method: 'POST',
      headers: { authorization: 'Bearer segredo-token', cookie: '__session=cookie-secreto', 'content-type': 'application/json' },
      body,
    });
    await settle();

    const raw = JSON.stringify(lines);
    assert.ok(!raw.includes('segredo-token'));
    assert.ok(!raw.includes('cookie-secreto'));
    assert.ok(!raw.includes('QUJDREVGRw'));
  });
});
