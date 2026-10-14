# Logs estruturados com Pino no backoffice - Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os `console.*` do backoffice por logs estruturados (Pino) cobrindo requisições HTTP, autenticação, fluxos de negócio (analyze, save, runners, new-month, publish) e ciclo de vida do processo, prontos para uma futura adoção de OpenTelemetry.

**Architecture:** Um módulo `processor/logger.ts` expõe `createLogger()` (factory testável, com destino injetável) e o singleton `logger`. O backoffice usa `pino-http` como middleware, que cria `req.log` (child logger com `reqId`); o `requireAdmin` enriquece `req.log` com `userId`. Saída em JSON no stdout (pretty só em dev/TTY). Os módulos de `processor/` usam `logger.child({ module })`; por padrão o logger é `silent`, então os CLIs (`npm run update` etc.) não mudam de comportamento. O backoffice define `LOG_LEVEL=info` por padrão em `backoffice/src/env.ts`.

**Tech Stack:** pino 10.4.0, pino-http 11.0.0, pino-pretty 13.2.0 (devDependency), `node:test` via `tsx --test` (sem novas ferramentas de teste), Express 5.

**Spec:** Pedido do usuário (sem documento de spec): "adicionar logs no backoffice para observabilidade, usando as melhores práticas, pensando em OTel futuro, com pino, garantindo logs nos fluxos importantes".

## Global Constraints

- Logs sempre em JSON estruturado no stdout em produção; nunca `console.*` no código do backoffice.
- Mensagens de log em português; chaves de campos em inglês e camelCase (`reqId`, `userId`, `durationMs`).
- Nível como label (`"level":"info"`), timestamp ISO 8601, erros sob a chave `err` (serializer padrão do pino).
- Nome do serviço vem de `OTEL_SERVICE_NAME` (padrão `rt-ranking-backoffice`) - convenção OTel.
- Nunca logar: header `Authorization`, cookies, corpo das requisições (base64 de imagens), tokens (`CLOUDFLARE_API_TOKEN`, `CLERK_SECRET_KEY`).
- Hash de imagem logado apenas com os 12 primeiros caracteres.
- Dependências com versão exata (sem `^`), como o restante do `package.json`.
- Não alterar a saída `console.*` dos CLIs de `processor/` (`index.ts`, `manifest.ts` etc.).
- Arquivos de texto terminam com linha vazia. Nunca usar `--no-verify`.

## Review Focus

- Header `Authorization` e `Cookie` não podem aparecer em nenhum log (pino-http serializa headers por padrão): teste na Task 2.
- Corpo de `/api/analyze` (base64 de até 20mb) jamais vai para o log, nem em erro: teste na Task 2.
- `x-request-id` malicioso (muito longo, com quebras de linha) deve ser descartado e substituído por UUID: teste na Task 2.
- Falha do `deploy.sh` deve registrar o final do log (cauda) sem despejar saída inteira: coberto na Task 3 (verificação manual).
- Cache corrompido (`data/.image-cache.json` inválido) hoje é engolido silenciosamente: passa a gerar `warn`; teste na Task 4.
- Com `LOG_LEVEL` ausente os CLIs de `processor/` devem continuar sem emitir linhas de log: teste na Task 1.

---

### Task 1: Módulo de logger, dependências e configuração de ambiente

**Files:**
- Create: `processor/logger.ts`
- Create: `backoffice/src/env.ts`
- Create: `tests/logger.test.ts`
- Modify: `package.json` (dependências e script `test`)
- Modify: `backoffice/tsconfig.json` (incluir `../tests/**/*`)
- Modify: `backoffice/src/server.ts:1` (trocar `import 'dotenv/config'` por `import './env'`)

**Interfaces:**
- Produces:
  - `createLogger(options?: { level?: string; pretty?: boolean; destination?: DestinationStream }): Logger`
  - `logger: Logger` (singleton; nível `process.env.LOG_LEVEL ?? 'silent'`)
  - `REDACT_PATHS: string[]`

- [ ] **Step 1: Instalar dependências**

```bash
npm install --save-exact pino@10.4.0 pino-http@11.0.0
npm install --save-exact --save-dev pino-pretty@13.2.0
```

Adicione ao `package.json` em `scripts`:

```json
"test": "tsx --test tests/*.test.ts",
```

Adicione `"../tests/**/*"` ao `include` de `backoffice/tsconfig.json`:

```json
"include": ["src/**/*", "../processor/**/*", "../tests/**/*"]
```

- [ ] **Step 2: Escrever o teste que falha**

`tests/logger.test.ts`:

```ts
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
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `npm test`
Expected: FAIL com "Cannot find module '../processor/logger'".

- [ ] **Step 4: Implementar `processor/logger.ts`**

```ts
import pino, { DestinationStream, Logger, LoggerOptions } from 'pino';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.apiToken',
];

interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
  destination?: DestinationStream;
}

// nível padrão "silent": os CLIs de processor/ não emitem logs; o backoffice define LOG_LEVEL em backoffice/src/env.ts
export function createLogger({
  level = process.env.LOG_LEVEL ?? 'silent',
  pretty = false,
  destination,
}: CreateLoggerOptions = {}): Logger {
  const options: LoggerOptions = {
    level,
    base: { service: process.env.OTEL_SERVICE_NAME ?? 'rt-ranking-backoffice', env: process.env.NODE_ENV ?? 'development' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
  };

  if (pretty && !destination) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service,env' },
      },
    });
  }

  return pino({ ...options, formatters: { level: (label) => ({ level: label }) } }, destination);
}

const pretty = process.env.NODE_ENV !== 'production' && process.env.LOG_PRETTY !== 'false' && Boolean(process.stdout.isTTY);

export const logger = createLogger({ pretty });
```

- [ ] **Step 5: Implementar `backoffice/src/env.ts`**

```ts
import 'dotenv/config';

// o backoffice sempre loga; os CLIs de processor/ continuam silenciosos (ver processor/logger.ts)
process.env.LOG_LEVEL ??= 'info';
```

Em `backoffice/src/server.ts:1`, troque `import 'dotenv/config';` por `import './env';`.

- [ ] **Step 6: Rodar testes e checagem de tipos**

Run: `npm test && npm run backoffice:check`
Expected: 5 testes PASS; tsc sem erros.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json backoffice/tsconfig.json backoffice/src/env.ts backoffice/src/server.ts processor/logger.ts tests/logger.test.ts
git commit -m "feat: adiciona logger estruturado com pino"
```

---

### Task 2: Log de requisições HTTP, autenticação e tratamento de erros

**Files:**
- Create: `backoffice/src/requestLogger.ts`
- Create: `tests/requestLogger.test.ts`
- Modify: `backoffice/src/server.ts` (middleware, error handler, startup, ciclo de vida)
- Modify: `backoffice/src/auth.ts:24-27,31` (log de acesso negado e `userId` no `req.log`)

**Interfaces:**
- Consumes: `createLogger`, `logger` de `processor/logger.ts`.
- Produces: `createRequestLogger(logger: Logger): RequestHandler` - define `req.log` (child com `reqId`) e o header `x-request-id` na resposta. Ignora URLs que não começam com `/api/`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/requestLogger.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `npm test`
Expected: FAIL com "Cannot find module '../backoffice/src/requestLogger'".

- [ ] **Step 3: Implementar `backoffice/src/requestLogger.ts`**

```ts
import { randomUUID } from 'crypto';
import type { Logger } from 'pino';
import pinoHttp from 'pino-http';

const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

export function createRequestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    autoLogging: { ignore: (req) => !req.url?.startsWith('/api/') },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode} falhou`,
    // só o necessário: nunca headers nem corpo
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  });
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test`
Expected: todos PASS. Se o import padrão de `pino-http` falhar, use `import { pinoHttp } from 'pino-http'`.

- [ ] **Step 5: Integrar no `server.ts`**

Imports (substituem nenhum existente; adicione):

```ts
import { logger } from '../../processor/logger';
import { createRequestLogger } from './requestLogger';
```

Logo após `app.use(express.static(...))` e antes de `/api/config`:

```ts
app.use(createRequestLogger(logger));
```

Substitua o error handler final (linhas 338-343) por:

```ts
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) {
    req.log.error({ err, status }, message);
  } else {
    req.log.warn({ status }, message);
  }
  res.status(status).json({ error: message });
});
```

Substitua o `app.listen` final por (inclui ciclo de vida):

```ts
const server = app.listen(PORT, '127.0.0.1', () => {
  logger.info({ port: PORT, logLevel: logger.level, node: process.version }, `Backoffice rodando em http://localhost:${PORT}`);
});

function shutdown(signal: string) {
  logger.info({ signal }, 'encerrando backoffice');
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'exceção não tratada');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'promise rejeitada sem tratamento');
  process.exit(1);
});
```

Em `/api/publish`, remova o `console.error` (linha 323); ele é substituído na Task 3.

- [ ] **Step 6: Integrar no `auth.ts`**

Remova o `console.warn` e substitua o bloco 403 e o `res.locals.userId`:

```ts
  const metadata = auth.sessionClaims?.metadata as { role?: unknown } | undefined;
  if (metadata?.role !== ADMIN_ROLE) {
    req.log.warn({ userId: auth.userId, method: req.method, url: req.originalUrl }, `acesso negado: usuário sem role "${ADMIN_ROLE}"`);
    res.status(403).json({ error: 'Seu usuário não tem permissão para acessar o backoffice.' });
    return;
  }

  res.locals.userId = auth.userId;
  req.log = req.log.child({ userId: auth.userId });
  next();
```

- [ ] **Step 7: Verificar**

Run: `npm test && npm run backoffice:check`
Expected: PASS e tsc sem erros.

Run manual: `npm run backoffice`, abra `http://localhost:3002`, faça login e navegue. Expected: uma linha por chamada `/api/*` com `reqId` e `userId`, nenhuma linha para arquivos estáticos; `grep -rn "console\." backoffice/src` sem resultados.

- [ ] **Step 8: Commit**

```bash
git add backoffice/src/requestLogger.ts backoffice/src/server.ts backoffice/src/auth.ts tests/requestLogger.test.ts
git commit -m "feat: logs de requisições, autenticação e erros no backoffice"
```

---

### Task 3: Logs dos fluxos de negócio no backoffice

**Files:**
- Modify: `backoffice/src/server.ts` (rotas `analyze`, `save`, `runners`, `new-month`, `publish`)

**Interfaces:**
- Consumes: `req.log` (Task 2).
- Produces: eventos de log (campo `msg` estável, para alertas futuros): `km extraído da imagem`, `imagem encontrada no cache`, `registros salvos`, `participante adicionado`, `participante removido`, `novo mês gerado`, `publicação iniciada`, `publicação concluída`, `publicação falhou`.

Estes logs não têm teste automatizado (as rotas dependem de Clerk, Cloudflare e git); a verificação é manual no Step 7.

- [ ] **Step 1: `/api/analyze`**

Dentro do handler, troque a primeira linha do `try` e os dois `res.json`:

```ts
    const { name, mimeType, data } = req.body ?? {};
    const { canonicalName } = resolveParticipant(name);
    ...
    const buffer = Buffer.from(data, 'base64');
    const hash = computeHashFromBuffer(buffer);
    const hashPrefix = hash.slice(0, 12);
    const cachedEntry = getCached(hash);
    if (cachedEntry) {
      req.log.info({ runner: canonicalName, hash: hashPrefix, km: cachedEntry.km }, 'imagem encontrada no cache');
      res.json({ km: cachedEntry.km, hash, cached: true, cachedEntry });
      return;
    }

    const startedAt = Date.now();
    const km = await extractKmFromImageBuffer(buffer, mimeType);
    req.log.info(
      { runner: canonicalName, hash: hashPrefix, km, mimeType, imageBytes: buffer.length, durationMs: Date.now() - startedAt },
      'km extraído da imagem',
    );
    res.json({ km, hash, cached: false });
```

(`resolveParticipant(name)` hoje descarta o retorno; mantenha as demais validações como estão.)

- [ ] **Step 2: `/api/save`**

Antes de `res.json(await buildState())`:

```ts
    req.log.info(
      {
        month,
        entries: entries.length,
        female: byGender.female.length,
        male: byGender.male.length,
        totalKm: Number(entries.reduce((sum, e) => sum + e.km, 0).toFixed(2)),
      },
      'registros salvos',
    );
```

- [ ] **Step 3: `/api/runners` (POST e DELETE)**

POST, após `saveParticipants(participants);`:

```ts
    req.log.info({ runner: name.trim(), gender }, 'participante adicionado');
```

DELETE, após `saveParticipants(participants);`:

```ts
    req.log.info({ runner: canonicalName }, 'participante removido');
```

- [ ] **Step 4: `/api/new-month`**

Após `const { createdFiles } = generateManifest();`:

```ts
    req.log.info({ month: getCurrentMonth(), createdFiles }, 'novo mês gerado');
```

- [ ] **Step 5: `/api/publish`**

Substitua o bloco entre `publishing = true;` e o `finally` por:

```ts
    publishing = true;
    const startedAt = Date.now();
    req.log.info({ autoMerge, pendingFiles: pendingChanges.length }, 'publicação iniciada');
    try {
      const markdown = writeRankingMarkdown();
      const args = ['scripts/deploy.sh', ...(autoMerge ? [] : ['--no-merge'])];
      try {
        const { stdout, stderr } = await execFileAsync('bash', args, { timeout: DEPLOY_TIMEOUT_MS });
        const log = `${stdout}${stderr}`;
        const prUrl = extractPrUrl(log);
        req.log.info({ autoMerge, prUrl, durationMs: Date.now() - startedAt }, 'publicação concluída');
        res.json({ log, prUrl, markdown });
      } catch (err) {
        const { stdout = '', stderr = '', message } = err as { stdout?: string; stderr?: string; message: string };
        const log = `${stdout}${stderr}` || message;
        req.log.error(
          { err, autoMerge, durationMs: Date.now() - startedAt, deployLogTail: log.slice(-2000) },
          'publicação falhou',
        );
        res.status(500).json({ error: 'Falha ao publicar. Confira o log.', log, prUrl: extractPrUrl(log) });
      }
    } finally {
      publishing = false;
    }
```

- [ ] **Step 6: Checagem de tipos**

Run: `npm run backoffice:check && npm test`
Expected: sem erros.

- [ ] **Step 7: Verificação manual**

Run: `npm run backoffice`. No navegador: analisar uma imagem (duas vezes, para ver `km extraído` e depois `imagem encontrada no cache`), salvar, adicionar e remover um participante de teste. Expected: uma linha `info` por evento, com `reqId` e `userId`; nenhum base64 ou token nas linhas. Reverta alterações em `data/` feitas no teste (`git checkout -- data`).

Para `publish`, valide o caminho de falha sem publicar de verdade: com `data/` limpo a rota responde 409 e o log mostra `warn` (`Nenhuma alteração em data/ para publicar`).

- [ ] **Step 8: Commit**

```bash
git add backoffice/src/server.ts
git commit -m "feat: logs dos fluxos de análise, salvamento, participantes e publicação"
```

---

### Task 4: Logs nos módulos de `processor/` e documentação

**Files:**
- Modify: `processor/imageAnalyzerCloudflare.ts`
- Modify: `processor/cacheManager.ts:23-30`
- Create: `tests/cacheManager.test.ts`
- Modify: `CLAUDE.md` (seção Backoffice)

**Interfaces:**
- Consumes: `logger` de `processor/logger.ts`.

- [ ] **Step 1: Teste que falha para o cache corrompido**

`tests/cacheManager.test.ts` - o logger do módulo é o singleton (`silent`); para capturar, exporte o logger do módulo é desnecessário. Teste via `LOG_LEVEL` e `process.stdout` é frágil; em vez disso, `loadCache` passa a receber o logger por parâmetro opcional:

```ts
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import { loadCache } from '../processor/cacheManager';
import { createLogger } from '../processor/logger';

test('cache corrompido gera warn e retorna cache vazio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-'));
  const file = path.join(dir, '.image-cache.json');
  fs.writeFileSync(file, '{ não é json');

  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _e, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });

  const cache = loadCache(file, createLogger({ level: 'warn', destination }));

  assert.deepEqual(cache, {});
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'warn');
  assert.equal(lines[0].path, file);
});
```

Run: `npm test`
Expected: FAIL (`loadCache` não exportada).

- [ ] **Step 2: Implementar em `cacheManager.ts`**

Adicione `import type { Logger } from 'pino';` e `import { logger } from './logger';`, e troque `loadCache` por:

```ts
const log = logger.child({ module: 'cacheManager' });

export function loadCache(cachePath: string = CACHE_PATH, cacheLog: Logger = log): CacheFile {
  if (!fs.existsSync(cachePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as CacheFile;
  } catch (err) {
    cacheLog.warn({ err, path: cachePath }, 'cache de imagens ilegível; ignorando e usando cache vazio');
    return {};
  }
}
```

`getCached` e `storeCache` continuam chamando `loadCache()` sem argumentos.

- [ ] **Step 3: Logs no analyzer do Cloudflare**

Em `imageAnalyzerCloudflare.ts`, adicione `import { logger } from './logger';` e `const log = logger.child({ module: 'imageAnalyzerCloudflare' });`. Em `extractKmFromImageBuffer`, meça o tempo e logue:

```ts
  const startedAt = Date.now();
  const res = await fetch(url, { ... }); // chamada existente, inalterada

  const body = (await res.json().catch(() => null)) as WorkersAiResponse | null;
  const durationMs = Date.now() - startedAt;
  if (!res.ok || !body?.success) {
    const detail = body?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? 'sem detalhes';
    log.error({ model, status: res.status, durationMs, detail }, 'Workers AI retornou erro');
    throw new Error(`Workers AI falhou (HTTP ${res.status}, modelo ${model}): ${detail}`);
  }

  const response = body.result?.response;
  if (response === undefined || response === null) {
    log.error({ model, status: res.status, durationMs }, 'Workers AI não retornou resposta');
    throw new Error('Workers AI não retornou resposta');
  }
  log.debug({ model, status: res.status, durationMs, rawResponse: String(response) }, 'resposta do Workers AI');
  return parseKmResponse(String(response));
```

Nunca logue `apiToken` nem a URL com o `accountId` além do necessário (apenas `model`).

- [ ] **Step 4: Documentar em `CLAUDE.md`**

Na seção "Backoffice", adicione:

```markdown
**Logs (Pino)** — `processor/logger.ts` (`createLogger`, `logger`) e `backoffice/src/requestLogger.ts` (`pino-http`). JSON no stdout; pretty-print só em TTY fora de produção.
- Variáveis: `LOG_LEVEL` (padrão `info` no backoffice, `silent` nos CLIs de `processor/`), `LOG_PRETTY=false` para forçar JSON, `OTEL_SERVICE_NAME` (padrão `rt-ranking-backoffice`).
- Cada requisição `/api/*` gera uma linha com `reqId` (também devolvido em `x-request-id`) e `userId`; `req.log` carrega esses campos nos logs de negócio. Headers, cookies e corpos nunca são logados.
- Erros usam a chave `err`; eventos de negócio têm `msg` estável (ex.: `registros salvos`, `publicação falhou`).
- Preparado para OTel: adicionar `@opentelemetry/instrumentation-pino` injeta `trace_id`/`span_id` automaticamente, sem alterar as chamadas de log.
- `npm test` roda os testes (`tsx --test tests/*.test.ts`) de logger, request logger e cache.
```

Atualize também a frase "Não há testes automatizados..." para mencionar que existem testes apenas para a camada de logs (`npm test`).

- [ ] **Step 5: Verificar**

Run: `npm test && npm run backoffice:check && npx tsc --noEmit`
Expected: todos PASS, sem erros de tipo.

Run: `npm run update` com `images/` vazio. Expected: saída idêntica à anterior (CLI continua silencioso, sem linhas JSON).

- [ ] **Step 6: Commit**

```bash
git add processor/imageAnalyzerCloudflare.ts processor/cacheManager.ts tests/cacheManager.test.ts CLAUDE.md
git commit -m "feat: logs no analyzer e no cache de imagens; documenta observabilidade"
```

---

## Self-Review

- **Cobertura do pedido:** pino como gerenciador (Task 1); logs HTTP, auth e erros (Task 2); fluxos importantes - analyze, save, runners, new-month, publish (Task 3); dependências do processor e docs (Task 4); preparação OTel via `OTEL_SERVICE_NAME`, JSON, chave `err`, nota de `instrumentation-pino`. Ciclo de vida do processo na Task 2.
- **Placeholders:** nenhum.
- **Consistência de tipos:** `createLogger`/`logger` (Task 1) usados com os mesmos nomes nas Tasks 2 e 4; `createRequestLogger(logger)` (Task 2); `loadCache(cachePath, cacheLog)` definida e usada na Task 4.
- **Review Focus:** headers, corpo e `x-request-id` cobertos por testes (Task 2); CLI silencioso (Task 1 e Step 5 da Task 4); cache corrompido (Task 4); cauda do log de deploy (Task 3, manual).
