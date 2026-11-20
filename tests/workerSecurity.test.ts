import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { clerkFrontendHost, limitBody, rateLimit, requireSameOrigin, securityHeaders } from '../worker/src/security';

const ORIGIN = 'https://ranking-endurance.tcelestino.dev.br';
const CLERK_HOST = 'clerk.example.com';
const PUBLISHABLE_KEY = `pk_live_${btoa(`${CLERK_HOST}$`)}`;

type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };
type TestEnv = { CLERK_PUBLISHABLE_KEY: string; RATE_LIMITER: Limiter };

const allowAll: Limiter = { limit: async () => ({ success: true }) };
const env = (limiter: Limiter = allowAll): TestEnv => ({
  CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
  RATE_LIMITER: limiter,
});

function buildApp() {
  const app = new Hono<{ Bindings: TestEnv }>();
  app.use(
    '*',
    securityHeaders((e: TestEnv) => clerkFrontendHost(e.CLERK_PUBLISHABLE_KEY)),
  );
  app.get('/api/ok', (c) => c.json({ ok: true }));
  app.get('/api/boom', () => {
    throw new Error('falhou');
  });
  app.get('/api/denied', (c) => c.json({ error: 'nao autorizado' }, 401));
  app.get('/page', (c) => c.text('pagina'));
  app.onError((_err, c) => c.json({ error: 'erro interno' }, 500));
  return app;
}

test('clerkFrontendHost extrai o dominio da publishable key', () => {
  assert.equal(clerkFrontendHost(PUBLISHABLE_KEY), CLERK_HOST);
  assert.equal(clerkFrontendHost(`pk_test_${btoa(`${CLERK_HOST}$`)}`), CLERK_HOST);
});

test('X-Robots-Tag presente em 200, 401, 404 e erro 500', async () => {
  const app = buildApp();
  for (const path of ['/api/ok', '/api/denied', '/nao-existe', '/api/boom']) {
    const res = await app.request(path, {}, env());
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive', path);
  }
  assert.equal((await app.request('/api/boom', {}, env())).status, 500);
  assert.equal((await app.request('/nao-existe', {}, env())).status, 404);
});

test('headers de seguranca e CSP', async () => {
  const res = await buildApp().request('/page', {}, env());
  assert.equal(res.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, new RegExp(`script-src [^;]*https://cdn.jsdelivr.net[^;]*https://${CLERK_HOST}`));
  assert.match(csp, new RegExp(`connect-src 'self' https://${CLERK_HOST}`));
  assert.match(csp, /img-src 'self' data: blob: https:\/\/img.clerk.com/);
});

test('Cache-Control no-store apenas em /api/*', async () => {
  const app = buildApp();
  assert.equal((await app.request('/api/ok', {}, env())).headers.get('cache-control'), 'no-store');
  assert.equal((await app.request('/api/boom', {}, env())).headers.get('cache-control'), 'no-store');
  assert.equal((await app.request('/page', {}, env())).headers.get('cache-control'), null);
});

function sameOriginApp() {
  const app = new Hono();
  app.use('*', requireSameOrigin(ORIGIN));
  app.all('*', (c) => c.json({ ok: true }));
  return app;
}

test('requireSameOrigin bloqueia Origin ausente ou diferente em metodos mutaveis', async () => {
  const app = sameOriginApp();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await app.request('/x', { method, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await app.request('/x', { method })).status, 403);
  }
});

test('requireSameOrigin aceita o origin permitido e metodos seguros sem Origin', async () => {
  const app = sameOriginApp();
  assert.equal((await app.request('/x', { method: 'POST', headers: { origin: ORIGIN } })).status, 200);
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal((await app.request('/x', { method })).status, 200, method);
  }
});

test('requireSameOrigin aceita funcao que le o origin do env', async () => {
  const app = new Hono<{ Bindings: { ALLOWED_ORIGIN: string } }>();
  app.use(
    '*',
    requireSameOrigin((e: { ALLOWED_ORIGIN: string }) => e.ALLOWED_ORIGIN),
  );
  app.post('/x', (c) => c.json({ ok: true }));
  const init = { method: 'POST', headers: { origin: ORIGIN } };
  assert.equal((await app.request('/x', init, { ALLOWED_ORIGIN: ORIGIN })).status, 200);
  assert.equal((await app.request('/x', init, { ALLOWED_ORIGIN: 'https://outro.example' })).status, 403);
});

function rateLimitApp() {
  const app = new Hono<{ Bindings: TestEnv }>();
  app.use('*', rateLimit());
  app.get('/x', (c) => c.json({ ok: true }));
  return app;
}

test('rateLimit usa CF-Connecting-IP como chave e responde 429 ao exceder', async () => {
  const keys: string[] = [];
  const deny: Limiter = {
    limit: async ({ key }) => {
      keys.push(key);
      return { success: false };
    },
  };
  const res = await rateLimitApp().request('/x', { headers: { 'cf-connecting-ip': '203.0.113.7' } }, env(deny));
  assert.equal(res.status, 429);
  assert.deepEqual(keys, ['203.0.113.7']);
});

test('rateLimit passa quando permitido e usa chave constante sem o header', async () => {
  const keys: string[] = [];
  const allow: Limiter = {
    limit: async ({ key }) => {
      keys.push(key);
      return { success: true };
    },
  };
  const res = await rateLimitApp().request('/x', {}, env(allow));
  assert.equal(res.status, 200);
  assert.deepEqual(keys, ['unknown']);
});

function bodyApp() {
  const app = new Hono();
  app.use('*', limitBody(10 * 1024 * 1024));
  app.all('*', (c) => c.json({ ok: true }));
  return app;
}

test('limitBody responde 413 acima do limite e 411 sem Content-Length em POST', async () => {
  const app = bodyApp();
  const big = await app.request('/x', { method: 'POST', headers: { 'content-length': '20000000' }, body: 'x' });
  assert.equal(big.status, 413);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('abc'));
      controller.close();
    },
  });
  const chunked = await app.request('/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  assert.equal(chunked.status, 411);
});

test('limitBody aceita corpo dentro do limite e GET sem Content-Length', async () => {
  const app = bodyApp();
  assert.equal(
    (await app.request('/x', { method: 'POST', headers: { 'content-length': '7' }, body: '{"a":1}' })).status,
    200,
  );
  assert.equal((await app.request('/x')).status, 200);
});

test('CSP permite blob: em img-src, Turnstile em script-src e Chart.js so na versao exata', async () => {
  const csp = (await buildApp().request('/page', {}, env())).headers.get('content-security-policy') ?? '';
  assert.match(csp, /img-src [^;]*blob:/);
  assert.match(csp, /script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(csp, /script-src [^;]*https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.4\.7\//);
  assert.doesNotMatch(csp, /script-src [^;]*https:\/\/cdn\.jsdelivr\.net(?!\/npm)/);
});

test('securityHeaders aceita Response com headers imutaveis', async () => {
  const app = buildApp();
  app.get('/redirect', () => Response.redirect('https://example.com/', 302));
  const res = await app.request('/redirect', {}, env());
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.ok(res.headers.get('content-security-policy'));
});

test('clerkFrontendHost rejeita chave invalida e host com caracteres de injecao', () => {
  assert.throws(() => clerkFrontendHost('pk_live'), /inválida/);
  assert.throws(() => clerkFrontendHost('pk_live_@@@'), /inválida/);
  assert.throws(() => clerkFrontendHost(`pk_live_${btoa('a.com; script-src *$')}`), /inválida/);
});

test('securityHeaders falha fechado com 500 e X-Robots-Tag quando a chave e invalida', async () => {
  const originalError = console.error;
  const lines: string[] = [];
  console.error = (line: string) => lines.push(line);
  try {
    const bad = { ...env(), CLERK_PUBLISHABLE_KEY: 'pk_live_segredo-invalido' };
    const res = await buildApp().request('/page', {}, bad);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes('segredo-invalido'));
  } finally {
    console.error = originalError;
  }
});

test('requireSameOrigin falha fechado com origin permitido indefinido', async () => {
  const app = new Hono();
  app.use('*', requireSameOrigin(undefined as unknown as string));
  app.post('/x', (c) => c.json({ ok: true }));
  assert.equal((await app.request('/x', { method: 'POST' })).status, 403);
});

test('limitBody rejeita Content-Length invalido com 400', async () => {
  const app = bodyApp();
  for (const value of ['-1', '1e3', 'abc', '5.5', '0x10']) {
    const res = await app.request('/x', { method: 'POST', headers: { 'content-length': value }, body: 'x' });
    assert.equal(res.status, 400, JSON.stringify(value));
  }
});
