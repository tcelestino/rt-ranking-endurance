import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDataSource, type DataSource } from '../processor/dataSource';
import { buildStats } from '../processor/stats';
import { createApp, type AppDeps, type AppEnv } from '../worker/src/app';
import { GitHubError } from '../worker/src/github';
import type { VerifyResult } from '../worker/src/auth';

const ORIGIN = 'https://ranking-endurance.tcelestino.dev.br';
const PUBLISHABLE_KEY = `pk_live_${btoa('clerk.example.com$')}`;

const files: Record<string, string> = {
  'runners.json': JSON.stringify({ female: ['Ana'], male: ['Bruno'] }),
  'manifest.json': JSON.stringify({
    year: 2026,
    currentMonth: 11,
    months: [
      { month: 5, slug: 'maio', monthName: 'Maio' },
      { month: 11, slug: 'novembro', monthName: 'Novembro' },
    ],
  }),
  '2026/female-maio.json': JSON.stringify([{ name: 'Ana', km: [10, 5], pace: [330, 360] }]),
  '2026/male-maio.json': JSON.stringify([{ name: 'Bruno', km: [8] }]),
  '2026/female-novembro.json': JSON.stringify([{ name: 'Ana', km: [4] }]),
  '2026/male-novembro.json': JSON.stringify([{ name: 'Bruno', km: [] }]),
};

const admin: VerifyResult = { ok: true, userId: 'user_1', claims: { metadata: { role: 'admin' } } };

function env(success = true): AppEnv {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: 'sk_test_x',
    RATE_LIMITER: { limit: async () => ({ success }) },
  };
}

function build(overrides: Partial<AppDeps> & { verifyResult?: VerifyResult; source?: DataSource } = {}) {
  const source = overrides.source ?? memoryDataSource(files);
  const deps: AppDeps = {
    verify: () => async () => overrides.verifyResult ?? admin,
    workingCopy: () => ({ load: async () => source, pendingChanges: async () => ['data/2026/female-maio.json'] }),
    imageCache: () => {
      throw new Error('imageCache não deveria ser usado');
    },
    analyze: async () => {
      throw new Error('analyze não deveria ser usado');
    },
    userSummary: async () => ({ name: 'Admin', email: 'admin@example.com' }),
    now: () => new Date('2026-11-20T15:00:00Z'),
    ...overrides,
  };
  return createApp(deps);
}

function silence() {
  const originalError = console.error;
  const originalWarn = console.warn;
  const lines: string[] = [];
  console.error = (line: string) => lines.push(line);
  console.warn = (line: string) => lines.push(line);
  return {
    lines,
    restore: () => {
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
}

test('GET /api/config e publico e devolve a publishable key', async () => {
  const res = await build({ verifyResult: { ok: false } }).request('/backoffice/api/config', {}, env());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { publishableKey: PUBLISHABLE_KEY });
});

test('GET /api/state sem sessao responde 401 e com role errada 403', async () => {
  const noSession = await build({ verifyResult: { ok: false } }).request('/backoffice/api/state', {}, env());
  assert.equal(noSession.status, 401);
  const wrongRole = await build({
    verifyResult: { ok: true, userId: 'u', claims: { metadata: { role: 'viewer' } } },
  }).request('/backoffice/api/state', {}, env());
  assert.equal(wrongRole.status, 403);
});

test('GET /api/state admin devolve participantes, mes, manifestCurrent e user', async () => {
  const res = await build().request('/backoffice/api/state', {}, env());
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.month, 11);
  assert.equal(body.year, 2026);
  assert.equal(body.monthName, 'novembro');
  assert.equal(body.manifestCurrent, true);
  assert.deepEqual(body.user, { name: 'Admin', email: 'admin@example.com' });
  assert.deepEqual(body.participants, [
    { name: 'Ana', gender: 'female', km: [4], total: 4, pace: null },
    { name: 'Bruno', gender: 'male', km: [], total: 0, pace: null },
  ]);
});

test('GET /api/state usa now injetado: 2026-12-01T02:00:00Z ainda e novembro em Sao Paulo', async () => {
  const app = build({ now: () => new Date('2026-12-01T02:00:00Z') });
  const body = (await (await app.request('/backoffice/api/state', {}, env())).json()) as { month: number };
  assert.equal(body.month, 11);
});

test('GET /api/state degrada user para nulos quando o Clerk falha', async () => {
  const log = silence();
  try {
    const app = build({
      userSummary: async () => {
        throw new Error('clerk fora do ar');
      },
    });
    const res = await app.request('/backoffice/api/state', {}, env());
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as { user: unknown }).user, { name: null, email: null });
    assert.ok(log.lines.some((l) => l.includes('falha ao buscar dados do usuário')));
  } finally {
    log.restore();
  }
});

test('GET /api/ranking do mes vigente devolve o contrato esperado', async () => {
  const res = await build().request('/backoffice/api/ranking', {}, env());
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, any>;
  assert.equal(body.year, 2026);
  assert.equal(body.month, 11);
  assert.equal(body.monthName, 'Novembro');
  assert.deepEqual(body.current, { year: 2026, month: 11 });
  assert.deepEqual(body.periods, [
    {
      year: 2026,
      months: [
        { month: 5, monthName: 'Maio' },
        { month: 11, monthName: 'Novembro' },
      ],
    },
  ]);
  assert.equal(body.female[0].name, 'Ana');
  assert.equal(body.female[0].km, 4);
  assert.equal(body.totals.female, 4);
  assert.equal(body.totals.annual, 4 + 15 + 8);
  assert.equal(typeof body.markdown, 'string');
});

test('GET /api/ranking com periodo explicito usa o mes pedido', async () => {
  const body = (await (await build().request('/backoffice/api/ranking?year=2026&month=5', {}, env())).json()) as any;
  assert.equal(body.month, 5);
  assert.equal(body.totals.female, 15);
});

test('GET /api/ranking sem dados no periodo explicito responde 404', async () => {
  const res = await build().request('/backoffice/api/ranking?year=2030&month=1', {}, env());
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Não há dados para 1/2030' });
});

test('GET /api/ranking sem filtro cai no periodo mais recente quando o mes vigente nao tem dados', async () => {
  const app = build({ now: () => new Date('2026-12-15T15:00:00Z') });
  const body = (await (await app.request('/backoffice/api/ranking', {}, env())).json()) as any;
  assert.equal(body.month, 11);
  assert.deepEqual(body.current, { year: 2026, month: 12 });
});

test('GET /api/ranking com parametro invalido responde 400', async () => {
  const res = await build().request('/backoffice/api/ranking?year=abc', {}, env());
  assert.equal(res.status, 400);
});

test('GET /api/stats devolve buildStats do ultimo ano com dados', async () => {
  const res = await build().request('/backoffice/api/stats', {}, env());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), JSON.parse(JSON.stringify(buildStats(2026, memoryDataSource(files)))));
});

test('GET /api/stats sem dados responde 404', async () => {
  const empty = memoryDataSource({ 'runners.json': files['runners.json'] });
  const app = build({ source: empty });
  assert.equal((await app.request('/backoffice/api/stats', {}, env())).status, 404);
  assert.equal((await build().request('/backoffice/api/stats?year=2030', {}, env())).status, 404);
});

test('GET /api/publish/status devolve publishing false e as pendencias', async () => {
  const res = await build().request('/backoffice/api/publish/status', {}, env());
  assert.deepEqual(await res.json(), { publishing: false, pendingChanges: ['data/2026/female-maio.json'] });
});

test('401 e 429 ainda carregam X-Robots-Tag e CSP', async () => {
  const unauthorized = await build({ verifyResult: { ok: false } }).request('/backoffice/api/state', {}, env());
  assert.equal(unauthorized.status, 401);
  const limited = await build().request('/backoffice/api/state', {}, env(false));
  assert.equal(limited.status, 429);
  for (const res of [unauthorized, limited]) {
    assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  }
});

test('rate limit cobre /api/config', async () => {
  const res = await build().request('/backoffice/api/config', {}, env(false));
  assert.equal(res.status, 429);
});

test('erros: rota inexistente 404, erro interno 500 sem vazar mensagem, GitHubError 502', async () => {
  const log = silence();
  try {
    const notFound = await build().request('/backoffice/api/nada', {}, env());
    assert.equal(notFound.status, 404);
    assert.deepEqual(await notFound.json(), { error: 'Não encontrado' });

    const boom = build({
      workingCopy: () => ({
        load: async () => memoryDataSource(files),
        pendingChanges: async () => {
          throw new Error('segredo interno');
        },
      }),
    });
    const internal = await boom.request('/backoffice/api/publish/status', {}, env());
    assert.equal(internal.status, 500);
    assert.deepEqual(await internal.json(), { error: 'Erro interno do servidor' });

    const gh = build({
      workingCopy: () => ({
        load: async () => memoryDataSource(files),
        pendingChanges: async () => {
          throw new GitHubError(500, 'token ghp_xxx invalido');
        },
      }),
    });
    const bad = await gh.request('/backoffice/api/publish/status', {}, env());
    assert.equal(bad.status, 502);
    assert.deepEqual(await bad.json(), { error: 'Falha ao falar com o GitHub' });
    assert.ok(log.lines.some((l) => l.includes('erro nao tratado')));
  } finally {
    log.restore();
  }
});
