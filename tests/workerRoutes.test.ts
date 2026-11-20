import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryDataSource, type DataSource } from '../processor/dataSource';
import { buildStats } from '../processor/stats';
import type { CacheEntry, ImageCache } from '../processor/cacheManager';
import { createApp, type AppDeps, type AppEnv } from '../worker/src/app';
import { HttpError } from '../worker/src/errors';
import type { WorkingCopy } from '../worker/src/workingCopy';
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

function env(success = true, extra: Partial<AppEnv> = {}): AppEnv {
  return {
    ...extra,
    ALLOWED_ORIGIN: ORIGIN,
    CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: 'sk_test_x',
    RATE_LIMITER: { limit: async () => ({ success }) },
  };
}

type WorkingCopyFake = ReturnType<AppDeps['workingCopy']>;

// Working copy em memória: grava os arquivos de cada save e registra commits e publicações.
function fakeWorkingCopy(opts: { buildTwice?: boolean; failSave?: Error; files?: Record<string, string> } = {}) {
  let current: Record<string, string> = { ...(opts.files ?? files) };
  const saves: { files: Record<string, string>; message: string }[] = [];
  const published: boolean[] = [];
  const wc: WorkingCopyFake = {
    load: async () => memoryDataSource(current),
    pendingChanges: async () => ['data/2026/female-maio.json'],
    commitMessage: (base: string, user: { id: string; email: string | null }) =>
      `${base}\n\nBackoffice-User: ${user.email ?? user.id}`,
    save: async (buildFiles: Parameters<WorkingCopy['save']>[0], message: string) => {
      if (opts.failSave) throw opts.failSave;
      let out = buildFiles(memoryDataSource(current));
      if (opts.buildTwice) out = buildFiles(memoryDataSource(current));
      saves.push({ files: out, message });
      current = { ...current, ...out };
    },
    publish: async (autoMerge: boolean) => {
      published.push(autoMerge);
      return { prUrl: 'https://github.com/o/r/pull/7', merged: autoMerge };
    },
  };
  return { wc, saves, published, files: () => current };
}

function fakeImageCache() {
  const store = new Map<string, CacheEntry>();
  const sets: string[] = [];
  let cleared = 0;
  const cache: ImageCache = {
    get: async (hash) => store.get(hash) ?? null,
    set: async (hash, entry) => {
      sets.push(hash);
      store.set(hash, entry);
    },
    clear: async () => {
      cleared++;
      store.clear();
    },
  };
  return { cache, store, sets, cleared: () => cleared };
}

function post(app: ReturnType<typeof build>, path: string, body: unknown, headers: Record<string, string> = {}) {
  const json = JSON.stringify(body);
  return app.request(
    `/backoffice${path}`,
    {
      method: 'POST',
      body: json,
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        'content-length': String(json.length),
        ...headers,
      },
    },
    env(),
  );
}

function build(overrides: Partial<AppDeps> & { verifyResult?: VerifyResult; source?: DataSource } = {}) {
  const source = overrides.source ?? memoryDataSource(files);
  const deps: AppDeps = {
    verify: () => async () => overrides.verifyResult ?? admin,
    workingCopy: () => ({ ...fakeWorkingCopy().wc, load: async () => source }),
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
  const originalLog = console.log;
  const lines: string[] = [];
  console.error = (line: string) => lines.push(line);
  console.warn = (line: string) => lines.push(line);
  console.log = (line: string) => lines.push(line);
  return {
    lines,
    restore: () => {
      console.error = originalError;
      console.warn = originalWarn;
      console.log = originalLog;
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

test('GET /api/state respeita CURRENT_MONTH do env', async () => {
  const res = await build().request('/backoffice/api/state', {}, env(true, { CURRENT_MONTH: '4' }));
  assert.equal(((await res.json()) as { month: number }).month, 4);
});

test('GET /api/stats usa o now injetado para decidir os meses fechados', async () => {
  const winnerMonths = async (now: string) => {
    const app = build({ now: () => new Date(now) });
    const body = (await (await app.request('/backoffice/api/stats', {}, env())).json()) as {
      winners: { month: number }[];
      months: { month: number; closed: boolean }[];
    };
    return {
      winners: body.winners.map((w) => w.month),
      closed: body.months.filter((m) => m.closed).map((m) => m.month),
    };
  };
  // com now em novembro, maio fecha; com now em maio, nenhum mês fica fechado
  assert.deepEqual(await winnerMonths('2026-11-20T15:00:00Z'), { winners: [5], closed: [5] });
  assert.deepEqual(await winnerMonths('2026-05-20T15:00:00Z'), { winners: [], closed: [] });
});

test('rateLimit roda antes de requireAdmin: sem sessao e limitado responde 429', async () => {
  const res = await build({ verifyResult: { ok: false } }).request('/backoffice/api/state', {}, env(false));
  assert.equal(res.status, 429);
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
        ...fakeWorkingCopy().wc,
        pendingChanges: async () => {
          throw new Error('segredo interno');
        },
      }),
    });
    const internal = await boom.request('/backoffice/api/publish/status', {}, env());
    assert.equal(internal.status, 500);
    const internalBody = await internal.json();
    assert.deepEqual(internalBody, { error: 'Erro interno do servidor' });

    const gh = build({
      workingCopy: () => ({
        ...fakeWorkingCopy().wc,
        pendingChanges: async () => {
          throw new GitHubError(500, 'token ghp_xxx invalido');
        },
      }),
    });
    const bad = await gh.request('/backoffice/api/publish/status', {}, env());
    assert.equal(bad.status, 502);
    assert.deepEqual(await bad.json(), { error: 'Falha ao falar com o GitHub' });
    assert.ok(log.lines.some((l) => l.includes('erro nao tratado') && l.includes('stack')));
    assert.ok(!JSON.stringify(internalBody).includes('stack'));
  } finally {
    log.restore();
  }
});

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const PNG_B64 = Buffer.from('imagem-falsa').toString('base64');

function writeApp(opts: Parameters<typeof fakeWorkingCopy>[0] = {}, analyze?: AppDeps['analyze']) {
  const wc = fakeWorkingCopy(opts);
  const cache = fakeImageCache();
  const analyzeCalls: number[] = [];
  const app = build({
    workingCopy: () => wc.wc,
    imageCache: () => cache.cache,
    analyze:
      analyze ??
      (async () => {
        analyzeCalls.push(1);
        return { km: 7.5, pace: 330 };
      }),
  });
  return { app, wc, cache, analyzeCalls };
}

test('POST com Origin errado em qualquer rota de escrita responde 403', async () => {
  const { app } = writeApp();
  for (const path of ['/api/analyze', '/api/save', '/api/runners', '/api/new-month', '/api/publish']) {
    const res = await post(app, path, {}, { origin: 'https://evil.example.com' });
    assert.equal(res.status, 403, path);
  }
});

test('POST /api/analyze com mime nao suportado responde 400 sem chamar a IA', async () => {
  const { app, analyzeCalls } = writeApp();
  const res = await post(app, '/api/analyze', { name: 'Ana', mimeType: 'image/bmp', data: PNG_B64 });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Formato não suportado: image/bmp' });
  assert.equal(analyzeCalls.length, 0);
});

test('POST /api/analyze valida nome, imagem vazia e base64 invalido', async () => {
  const { app } = writeApp();
  assert.equal((await post(app, '/api/analyze', { mimeType: 'image/png', data: PNG_B64 })).status, 400);
  assert.equal((await post(app, '/api/analyze', { name: 'Zeca', mimeType: 'image/png', data: PNG_B64 })).status, 404);
  const empty = await post(app, '/api/analyze', { name: 'Ana', mimeType: 'image/png', data: '' });
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'Imagem vazia' });
  assert.equal((await post(app, '/api/analyze', { name: 'Ana', mimeType: 'image/png', data: '***' })).status, 400);
});

test('POST /api/analyze devolve km e pace da IA com hash e cached false', async () => {
  const log = silence();
  try {
    const { app, analyzeCalls } = writeApp();
    const res = await post(app, '/api/analyze', { name: 'ana', mimeType: 'image/png', data: PNG_B64 });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { hash: string };
    assert.deepEqual(body, { km: 7.5, pace: 330, hash: body.hash, cached: false });
    assert.match(body.hash, /^[a-f0-9]{64}$/);
    assert.equal(analyzeCalls.length, 1);
    const line = log.lines.find((l) => l.includes('atividade extraída da imagem'));
    assert.ok(line);
    assert.ok(!line.includes(PNG_B64));
    assert.ok(line.includes(body.hash.slice(0, 12)));
  } finally {
    log.restore();
  }
});

test('POST /api/analyze com hash no cache responde cached true sem chamar a IA', async () => {
  const log = silence();
  try {
    const { app, cache, analyzeCalls } = writeApp();
    const first = await post(app, '/api/analyze', { name: 'Ana', mimeType: 'image/png', data: PNG_B64 });
    const { hash } = (await first.json()) as { hash: string };
    const entry = { km: 3, pace: null, date: '2026-11-01', filename: 'x.png' };
    cache.store.set(hash, entry);
    const res = await post(app, '/api/analyze', { name: 'Ana', mimeType: 'image/png', data: PNG_B64 });
    assert.deepEqual(await res.json(), { km: 3, pace: null, hash, cached: true, cachedEntry: entry });
    assert.equal(analyzeCalls.length, 1);
  } finally {
    log.restore();
  }
});

test('POST /api/analyze aceita imagem de ~9 MB decodificada (corpo honesto)', async () => {
  const { app, analyzeCalls } = writeApp();
  const data = Buffer.alloc(9 * 1024 * 1024, 1).toString('base64');
  const res = await post(app, '/api/analyze', { name: 'Ana', mimeType: 'image/png', data });
  assert.equal(res.status, 200);
  assert.equal(analyzeCalls.length, 1);
});

test('POST /api/analyze rejeita imagem de 10 MB + 30 KB decodificada com 413 pela checagem real, sem chamar a IA', async () => {
  const { app, analyzeCalls } = writeApp();
  const data = Buffer.alloc(10 * 1024 * 1024 + 30000, 1).toString('base64');
  const res = await post(app, '/api/analyze', { name: 'Ana', mimeType: 'image/png', data });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'Imagem muito grande' });
  assert.equal(analyzeCalls.length, 0);
});

test('POST /api/analyze com Content-Length acima do limite responde 413', async () => {
  const { app } = writeApp();
  const res = await post(app, '/api/analyze', {}, { 'content-length': String(14 * 1024 * 1024) });
  assert.equal(res.status, 413);
});

const entry = (over: Record<string, unknown> = {}) => ({
  name: 'Ana',
  km: 5.5,
  pace: 330,
  hash: HASH_A,
  filename: 'a.png',
  ...over,
});

test('POST /api/save grava um unico commit so com os arquivos do genero afetado e popula o cache depois', async () => {
  const log = silence();
  try {
    const { app, wc, cache } = writeApp();
    const res = await post(app, '/api/save', { entries: [entry(), entry({ hash: HASH_B, km: 2, pace: null })] });
    assert.equal(res.status, 200);
    assert.equal(wc.saves.length, 1);
    assert.deepEqual(Object.keys(wc.saves[0].files), ['2026/female-novembro.json']);
    assert.equal(
      wc.saves[0].files['2026/female-novembro.json'],
      JSON.stringify([{ name: 'Ana', km: [4, 5.5, 2], pace: [null, 330, null] }], null, 2) + '\n',
    );
    assert.match(wc.saves[0].message, /^update: dados 20\/11\/2026\n\nBackoffice-User: admin@example\.com$/);
    assert.deepEqual(cache.sets, [HASH_A, HASH_B]);
    assert.deepEqual(cache.store.get(HASH_A), { km: 5.5, pace: 330, date: '2026-11-20', filename: 'a.png' });
    const state = (await res.json()) as { participants: { name: string; total: number }[] };
    assert.equal(state.participants[0].total, 11.5);
    assert.ok(log.lines.some((l) => l.includes('registros salvos')));
  } finally {
    log.restore();
  }
});

test('POST /api/save com os dois generos grava os dois arquivos no mesmo commit', async () => {
  const { app, wc } = writeApp();
  const res = await post(app, '/api/save', { entries: [entry(), entry({ name: 'Bruno', hash: HASH_B })] });
  assert.equal(res.status, 200);
  assert.equal(wc.saves.length, 1);
  assert.deepEqual(Object.keys(wc.saves[0].files).sort(), ['2026/female-novembro.json', '2026/male-novembro.json']);
});

test('POST /api/save cai no id do usuario quando o Clerk falha', async () => {
  const wc = fakeWorkingCopy();
  const app = build({
    workingCopy: () => wc.wc,
    imageCache: () => fakeImageCache().cache,
    userSummary: async () => {
      throw new Error('clerk fora');
    },
  });
  const log = silence();
  try {
    assert.equal((await post(app, '/api/save', { entries: [entry()] })).status, 200);
  } finally {
    log.restore();
  }
  assert.match(wc.saves[0].message, /Backoffice-User: user_1$/);
});

test('POST /api/save com o mesmo hash duas vezes responde 409 na segunda', async () => {
  const { app, wc } = writeApp();
  assert.equal((await post(app, '/api/save', { entries: [entry()] })).status, 200);
  const second = await post(app, '/api/save', { entries: [entry({ filename: 'b.png' })] });
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: 'Imagem b.png (Ana) já foi processada' });
  assert.equal(wc.saves.length, 1);
});

test('POST /api/save com hash repetido na mesma requisicao responde 409', async () => {
  const { app, wc } = writeApp();
  const res = await post(app, '/api/save', { entries: [entry(), entry()] });
  assert.equal(res.status, 409);
  assert.equal(wc.saves.length, 0);
});

test('POST /api/save valida entradas', async () => {
  const { app, wc } = writeApp();
  const bad = async (body: unknown, status: number) =>
    assert.equal((await post(app, '/api/save', body)).status, status);
  await bad({}, 400);
  await bad({ entries: [] }, 400);
  await bad({ entries: [entry({ name: 'Zeca' })] }, 404);
  await bad({ entries: [entry({ km: 0 })] }, 400);
  await bad({ entries: [entry({ km: 'x' })] }, 400);
  await bad({ entries: [entry({ pace: 60 })] }, 400);
  await bad({ entries: [entry({ pace: 5000 })] }, 400);
  await bad({ entries: [entry({ hash: 'zz' })] }, 400);
  assert.equal(wc.saves.length, 0);
});

test('POST /api/save nao grava o cache quando o commit falha e o conflito persistente vira 409', async () => {
  const { app, cache } = writeApp({
    failSave: new HttpError(
      409,
      'Conflito ao salvar: a branch de atualização mudou durante a gravação. Tente novamente.',
    ),
  });
  const res = await post(app, '/api/save', { entries: [entry()] });
  assert.equal(res.status, 409);
  assert.deepEqual(cache.sets, []);
});

test('POST /api/save: build e idempotente quando o WorkingCopy o chama duas vezes', async () => {
  const log = silence();
  try {
    const { app, wc, cache } = writeApp({ buildTwice: true });
    assert.equal((await post(app, '/api/save', { entries: [entry()] })).status, 200);
    assert.equal(
      wc.saves[0].files['2026/female-novembro.json'],
      JSON.stringify([{ name: 'Ana', km: [4, 5.5], pace: [null, 330] }], null, 2) + '\n',
    );
    assert.deepEqual(cache.sets, [HASH_A]);
  } finally {
    log.restore();
  }
});

test('POST /api/runners adiciona participante e devolve o estado', async () => {
  const log = silence();
  try {
    const { app, wc } = writeApp();
    const res = await post(app, '/api/runners', { name: ' Carla ', gender: 'female' });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(wc.saves[0].files), ['runners.json']);
    assert.equal(
      wc.saves[0].files['runners.json'],
      JSON.stringify({ female: ['Ana', 'Carla'], male: ['Bruno'] }, null, 2) + '\n',
    );
    const state = (await res.json()) as { participants: { name: string }[] };
    assert.deepEqual(
      state.participants.map((p) => p.name),
      ['Ana', 'Carla', 'Bruno'],
    );
  } finally {
    log.restore();
  }
});

test('POST /api/runners valida nome e genero e rejeita duplicado em qualquer genero com 409', async () => {
  const { app, wc } = writeApp();
  assert.equal((await post(app, '/api/runners', { name: ' ', gender: 'male' })).status, 400);
  assert.equal((await post(app, '/api/runners', { name: 'Zeca', gender: 'x' })).status, 400);
  const dup = await post(app, '/api/runners', { name: 'bruno', gender: 'female' });
  assert.equal(dup.status, 409);
  assert.deepEqual(await dup.json(), { error: 'Participante "Bruno" já existe' });
  assert.equal(wc.saves.length, 0);
});

test('DELETE /api/runners/:name remove participante e responde 404 para desconhecido', async () => {
  const log = silence();
  try {
    const { app, wc } = writeApp();
    const del = (name: string) =>
      app.request(
        `/backoffice/api/runners/${encodeURIComponent(name)}`,
        { method: 'DELETE', headers: { origin: ORIGIN } },
        env(),
      );
    assert.equal((await del('Zeca')).status, 404);
    const ok = await del('bruno');
    assert.equal(ok.status, 200);
    assert.equal(wc.saves[0].files['runners.json'], JSON.stringify({ female: ['Ana'], male: [] }, null, 2) + '\n');
  } finally {
    log.restore();
  }
});

test('POST /api/new-month com manifest atual responde 409 sem gravar', async () => {
  const { app, wc, cache } = writeApp();
  const res = await post(app, '/api/new-month', {});
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'O manifest de novembro/2026 já foi gerado' });
  assert.equal(wc.saves.length, 0);
  assert.equal(cache.cleared(), 0);
});

test('POST /api/new-month cria os JSONs do mes, grava o manifest e limpa o cache depois', async () => {
  const log = silence();
  try {
    const { wc, cache } = writeApp();
    const dec = new Date('2026-12-02T15:00:00Z');
    const decApp = build({ workingCopy: () => wc.wc, imageCache: () => cache.cache, now: () => dec });
    const res = await post(decApp, '/api/new-month', {});
    assert.equal(res.status, 200);
    const body = (await res.json()) as { createdFiles: string[]; state: { month: number; manifestCurrent: boolean } };
    assert.deepEqual(body.createdFiles, ['female-dezembro.json', 'male-dezembro.json']);
    assert.equal(body.state.month, 12);
    assert.equal(body.state.manifestCurrent, true);
    assert.deepEqual(Object.keys(wc.saves[0].files).sort(), [
      '2026/female-dezembro.json',
      '2026/male-dezembro.json',
      'manifest.json',
    ]);
    assert.equal(cache.cleared(), 1);
  } finally {
    log.restore();
  }
});

test('POST /api/new-month nao limpa o cache quando o commit falha', async () => {
  const wc = fakeWorkingCopy({ failSave: new HttpError(409, 'conflito') });
  const cache = fakeImageCache();
  const app = build({
    workingCopy: () => wc.wc,
    imageCache: () => cache.cache,
    now: () => new Date('2026-12-02T15:00:00Z'),
  });
  assert.equal((await post(app, '/api/new-month', {})).status, 409);
  assert.equal(cache.cleared(), 0);
});

test('POST /api/publish exige autoMerge booleano', async () => {
  const { app, wc } = writeApp();
  for (const body of [{}, { autoMerge: 'true' }, { autoMerge: 1 }]) {
    const res = await post(app, '/api/publish', body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Informe se o merge deve ser automático' });
  }
  assert.deepEqual(wc.published, []);
});

test('POST /api/publish devolve log, prUrl e markdown', async () => {
  const log = silence();
  try {
    const { app, wc } = writeApp();
    const merged = await post(app, '/api/publish', { autoMerge: true });
    assert.equal(merged.status, 200);
    const body = (await merged.json()) as { log: string; prUrl: string; markdown: string };
    assert.equal(body.prUrl, 'https://github.com/o/r/pull/7');
    assert.match(body.log, /pull\/7/);
    assert.match(body.log, /Merge automático concluído/);
    assert.equal(typeof body.markdown, 'string');
    assert.ok(body.markdown.length > 0);

    const open = (await (await post(app, '/api/publish', { autoMerge: false })).json()) as { log: string };
    assert.match(open.log, /PR aberto sem merge/);
    assert.deepEqual(wc.published, [true, false]);
  } finally {
    log.restore();
  }
});

test('POST /api/publish propaga o 409 do WorkingCopy', async () => {
  const wc = fakeWorkingCopy();
  wc.wc.publish = async () => {
    throw new HttpError(409, 'Nenhuma alteração em data/ para publicar');
  };
  const app = build({ workingCopy: () => wc.wc });
  const res = await post(app, '/api/publish', { autoMerge: true });
  assert.equal(res.status, 409);
});

test('POST /api/publish nao publica quando a leitura do snapshot falha', async () => {
  const wc = fakeWorkingCopy();
  wc.wc.load = async () => {
    throw new Error('falha de leitura');
  };
  const log = silence();
  try {
    const res = await post(build({ workingCopy: () => wc.wc }), '/api/publish', { autoMerge: true });
    assert.equal(res.status, 500);
    assert.deepEqual(wc.published, []);
  } finally {
    log.restore();
  }
});

test('POST /api/save: falha no cache apos o commit usa logError e responde normalmente', async () => {
  const log = silence();
  try {
    const wc = fakeWorkingCopy();
    const cache = fakeImageCache();
    cache.cache.set = async () => {
      throw new Error('kv fora');
    };
    const app = build({ workingCopy: () => wc.wc, imageCache: () => cache.cache });
    assert.equal((await post(app, '/api/save', { entries: [entry()] })).status, 200);
    assert.equal(wc.saves.length, 1);
    assert.ok(log.lines.some((l) => l.includes('"level":"error"') && l.includes('falha ao gravar imagem no cache')));
  } finally {
    log.restore();
  }
});

test('POST /api/save limita entries e valida filename', async () => {
  const { app, wc } = writeApp();
  const many = Array.from({ length: 201 }, (_, i) => entry({ hash: i.toString(16).padStart(64, '0') }));
  assert.equal((await post(app, '/api/save', { entries: many })).status, 400);
  assert.equal((await post(app, '/api/save', { entries: [entry({ filename: 'x'.repeat(256) })] })).status, 400);
  assert.equal((await post(app, '/api/save', { entries: [entry({ filename: 'a\nb.png' })] })).status, 400);
  assert.equal(wc.saves.length, 0);
  assert.equal((await post(app, '/api/save', { entries: [entry({ filename: 'x'.repeat(255) })] })).status, 200);
});

test('POST /api/runners limita o tamanho e rejeita caracteres de controle no nome', async () => {
  const { app, wc } = writeApp();
  assert.equal((await post(app, '/api/runners', { name: 'x'.repeat(101), gender: 'male' })).status, 400);
  assert.equal((await post(app, '/api/runners', { name: 'Jo\u0007ao', gender: 'male' })).status, 400);
  assert.equal(wc.saves.length, 0);
});

test('POST /api/new-month: falha ao limpar o cache apos o commit usa logError e responde normalmente', async () => {
  const log = silence();
  try {
    const wc = fakeWorkingCopy();
    const cache = fakeImageCache();
    cache.cache.clear = async () => {
      throw new Error('kv fora');
    };
    const app = build({
      workingCopy: () => wc.wc,
      imageCache: () => cache.cache,
      now: () => new Date('2026-12-02T15:00:00Z'),
    });
    assert.equal((await post(app, '/api/new-month', {})).status, 200);
    assert.equal(wc.saves.length, 1);
    assert.ok(log.lines.some((l) => l.includes('"level":"error"') && l.includes('falha ao limpar o cache')));
  } finally {
    log.restore();
  }
});

test('DELETE /api/runners/:name decodifica nome acentuado', async () => {
  const log = silence();
  try {
    const wc = fakeWorkingCopy({
      files: { ...files, 'runners.json': JSON.stringify({ female: ['Ana', 'Júlia'], male: ['Bruno'] }) },
    });
    const app = build({ workingCopy: () => wc.wc });
    const res = await app.request(
      '/backoffice/api/runners/J%C3%BAlia',
      { method: 'DELETE', headers: { origin: ORIGIN } },
      env(),
    );
    assert.equal(res.status, 200);
    assert.equal(
      wc.saves[0].files['runners.json'],
      JSON.stringify({ female: ['Ana'], male: ['Bruno'] }, null, 2) + '\n',
    );
  } finally {
    log.restore();
  }
});
