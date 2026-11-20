import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { requireAdmin, type AuthVariables, type VerifyResult } from '../worker/src/auth';

function buildApp(verify: (req: Request) => Promise<VerifyResult>) {
  const calls = { handler: 0, userId: undefined as string | undefined };
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('/api/*', requireAdmin(verify));
  app.get('/api/state', (c) => {
    calls.handler += 1;
    calls.userId = c.get('userId');
    return c.json({ ok: true });
  });
  return { app, calls };
}

function silenceConsole() {
  const originalWarn = console.warn;
  const originalError = console.error;
  const lines: string[] = [];
  console.warn = (line: string) => lines.push(line);
  console.error = (line: string) => lines.push(line);
  return {
    lines,
    restore: () => {
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}

test('sem header de autorização: 401 e handler não roda', async () => {
  const { app, calls } = buildApp(async (req) =>
    req.headers.get('authorization')
      ? { ok: true, userId: 'u1', claims: { metadata: { role: 'admin' } } }
      : { ok: false },
  );
  const res = await app.request('/api/state');
  assert.equal(res.status, 401);
  assert.equal(calls.handler, 0);
});

test('verify devolve ok:false: 401', async () => {
  const { app, calls } = buildApp(async () => ({ ok: false }));
  const res = await app.request('/api/state', { headers: { authorization: 'Bearer x' } });
  assert.equal(res.status, 401);
  assert.equal(calls.handler, 0);
});

test('role diferente de admin: 403, handler não roda e acesso negado é logado sem query', async () => {
  const log = silenceConsole();
  try {
    const { app, calls } = buildApp(async () => ({
      ok: true,
      userId: 'user_1',
      claims: { metadata: { role: 'viewer' } },
    }));
    const res = await app.request('/api/state?secret=abc', { headers: { authorization: 'Bearer x' } });
    assert.equal(res.status, 403);
    assert.equal(calls.handler, 0);
    assert.equal(log.lines.length, 1);
    const entry = JSON.parse(log.lines[0]);
    assert.equal(entry.level, 'warn');
    assert.equal(entry.userId, 'user_1');
    assert.equal(entry.method, 'GET');
    assert.equal(entry.path, '/api/state');
    assert.ok(!log.lines[0].includes('secret'));
    assert.ok(!log.lines[0].includes('Bearer'));
  } finally {
    log.restore();
  }
});

test('sem metadata: 403', async () => {
  const log = silenceConsole();
  try {
    const { app, calls } = buildApp(async () => ({ ok: true, userId: 'user_1', claims: {} }));
    const res = await app.request('/api/state', { headers: { authorization: 'Bearer x' } });
    assert.equal(res.status, 403);
    assert.equal(calls.handler, 0);
  } finally {
    log.restore();
  }
});

test('role admin: handler roda e userId fica no contexto', async () => {
  const { app, calls } = buildApp(async () => ({
    ok: true,
    userId: 'user_admin',
    claims: { metadata: { role: 'admin' } },
  }));
  const res = await app.request('/api/state', { headers: { authorization: 'Bearer x' } });
  assert.equal(res.status, 200);
  assert.equal(calls.handler, 1);
  assert.equal(calls.userId, 'user_admin');
});

test('verify que lança exceção: 401 (nunca 200) e erro logado sem token', async () => {
  const log = silenceConsole();
  try {
    const { app, calls } = buildApp(async () => {
      throw new Error('jwks indisponível');
    });
    const res = await app.request('/api/state', { headers: { authorization: 'Bearer segredo' } });
    assert.equal(res.status, 401);
    assert.equal(calls.handler, 0);
    assert.equal(log.lines.length, 1);
    const entry = JSON.parse(log.lines[0]);
    assert.equal(entry.level, 'error');
    assert.ok(entry.err);
    assert.ok(!log.lines[0].includes('segredo'));
  } finally {
    log.restore();
  }
});
