import { Hono, type MiddlewareHandler } from 'hono';
import type { DataSource } from '../../processor/dataSource';
import type { CacheEntry, ImageCache } from '../../processor/cacheManager';
import type { ActivityResult } from '../../processor/kmPrompt';
import {
  addParticipant,
  findParticipant,
  loadParticipants,
  removeParticipant,
  type Participants,
} from '../../processor/participantsParser';
import { appendKm, getMonthName, loadMonthDataSync, monthRelPath } from '../../processor/jsonUpdater';
import { isManifestCurrent, planNewMonth } from '../../processor/manifest';
import { averagePace, isValidPace, paceTotals } from '../../processor/pace';
import {
  MONTH_DISPLAY,
  buildRankingMarkdown,
  calcAnnualRanking,
  calcMonthlyRanking,
  calcTotalKm,
  listRankingPeriods,
} from '../../processor/ranking';
import { buildStats } from '../../processor/stats';
import { capitalizeFirstLetter, getCurrentMonth, getCurrentYear } from '../../processor/utils';
import { requireAdmin, type AuthVariables, type VerifyResult } from './auth';
import { base64ToBytes, sha256Hex } from './bytes';
import { HttpError, notFound, onError } from './errors';
import { logInfo, logWarn } from './logger';
import { clerkFrontendHost, limitBody, rateLimit, requireSameOrigin, securityHeaders } from './security';
import type { WorkingCopy } from './workingCopy';

// Subconjunto de Env usado pelo app (sem importar env.ts: usa tipos do Workers, ausentes no tsconfig do backoffice
// que checa tests/). Env é atribuível a este tipo.
export interface AppEnv {
  ALLOWED_ORIGIN: string;
  CURRENT_MONTH?: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export interface AppDeps<E extends AppEnv = AppEnv> {
  verify: (env: E) => (req: Request) => Promise<VerifyResult>;
  workingCopy: (env: E) => Pick<WorkingCopy, 'load' | 'pendingChanges' | 'save' | 'publish' | 'commitMessage'>;
  imageCache: (env: E) => ImageCache;
  analyze: (env: E, bytes: Uint8Array, mimeType: string) => Promise<ActivityResult>;
  userSummary: (env: E, userId: string) => Promise<{ name: string | null; email: string | null }>;
  now: () => Date;
}

type Gender = 'female' | 'male';
const GENDERS: Gender[] = ['female', 'male'];

const SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface SaveEntry {
  name: string;
  km: number;
  pace: number | null;
  hash: string;
  filename: string;
}

// Data e hora no fuso de Brasília (mesmo critério do nome da branch e do título do PR).
function brasiliaParts(now: Date): { dd: string; mm: string; yyyy: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { dd: get('day'), mm: get('month'), yyyy: get('year') };
}

function serialize(data: unknown): string {
  return JSON.stringify(data, null, 2) + '\n';
}

async function readJsonBody(req: { json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'Corpo da requisição não é um JSON válido');
  }
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function resolveParticipant(source: DataSource, name: unknown) {
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Nome do participante é obrigatório');
  const participant = findParticipant(loadParticipants(source), name);
  if (!participant) throw new HttpError(404, `Participante "${name}" não encontrado em data/runners.json`);
  return participant;
}

function displayMonthName(month: number): string {
  return capitalizeFirstLetter(MONTH_DISPLAY[getMonthName(month)]);
}

function parsePeriodParam(value: string | undefined, label: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new HttpError(400, `${label} inválido: ${value}`);
  return parsed;
}

// Mês e ano vigentes, calculados uma vez por requisição (relógio injetado + CURRENT_MONTH do env).
function currentPeriod(now: Date, env: AppEnv): { year: number; month: number } {
  return { year: getCurrentYear(now), month: getCurrentMonth(now, env.CURRENT_MONTH) };
}

function buildState(source: DataSource, { month, year }: { year: number; month: number }) {
  const participants = loadParticipants(source);

  const result = [];
  for (const gender of GENDERS) {
    const data = loadMonthDataSync(gender, month, year, source);
    for (const name of participants[gender]) {
      const record = data.find((p) => p.name === name);
      const km = record?.km ?? [];
      const total = km.reduce((sum, v) => sum + v, 0);
      const pace = averagePace(paceTotals(km, record?.pace));
      result.push({ name, gender, km, total, pace });
    }
  }

  return {
    month,
    monthName: getMonthName(month),
    year,
    manifestCurrent: isManifestCurrent(source, month, year),
    participants: result,
  };
}

export function createApp<E extends AppEnv>(deps: AppDeps<E>) {
  const app = new Hono<{ Bindings: E; Variables: AuthVariables }>().basePath('/backoffice');

  // Ordem importa: headers de segurança primeiro (valem também para 401/429), depois rate limit,
  // a rota pública de config e só então origem e autenticação.
  app.use(
    '*',
    securityHeaders((env: E) => clerkFrontendHost(env.CLERK_PUBLISHABLE_KEY)),
  );
  app.use('/api/*', rateLimit<E>());

  // público: o frontend precisa da chave para carregar o Clerk antes do login
  app.get('/api/config', (c) => c.json({ publishableKey: c.env.CLERK_PUBLISHABLE_KEY }));

  app.use(
    '/api/*',
    requireSameOrigin<E>((env) => env.ALLOWED_ORIGIN),
  );
  app.use('/api/*', (c, next) =>
    (requireAdmin(deps.verify(c.env)) as unknown as MiddlewareHandler<{ Bindings: E; Variables: AuthVariables }>)(
      c,
      next,
    ),
  );

  app.get('/api/state', async (c) => {
    const source = await deps.workingCopy(c.env).load();
    const period = currentPeriod(deps.now(), c.env);
    // a busca no Clerk roda em paralelo com o cálculo do estado; falha degrada para nulos
    const userPromise = deps.userSummary(c.env, c.get('userId')).catch((err: unknown) => {
      logWarn('falha ao buscar dados do usuário no Clerk', {
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      });
      return { name: null, email: null };
    });
    const state = buildState(source, period);
    const user = await userPromise;
    return c.json({ ...state, user });
  });

  app.get('/api/ranking', async (c) => {
    const source = await deps.workingCopy(c.env).load();
    const { year: currentYear, month: currentMonth } = currentPeriod(deps.now(), c.env);
    const periods = listRankingPeriods(source);
    const hasData = (y: number, m: number) => periods.some((p) => p.year === y && p.months.includes(m));

    const yearParam = c.req.query('year');
    const monthParam = c.req.query('month');
    let year = parsePeriodParam(yearParam, 'Ano', currentYear);
    let month = parsePeriodParam(monthParam, 'Mês', currentMonth);
    const explicit = yearParam !== undefined || monthParam !== undefined;

    if (!hasData(year, month)) {
      // sem filtro explícito (ex.: dia 1 antes do novo mês), exibe o período mais recente com dados
      const latest = periods[periods.length - 1];
      if (explicit || !latest) throw new HttpError(404, `Não há dados para ${month}/${year}`);
      year = latest.year;
      month = latest.months[latest.months.length - 1];
    }

    const female = calcMonthlyRanking('female', month, year, source);
    const male = calcMonthlyRanking('male', month, year, source);
    const annual = calcAnnualRanking(year, source);
    return c.json({
      year,
      month,
      monthName: displayMonthName(month),
      current: { year: currentYear, month: currentMonth },
      periods: periods.map((p) => ({
        year: p.year,
        months: p.months.map((m) => ({ month: m, monthName: displayMonthName(m) })),
      })),
      female,
      male,
      annual,
      totals: { female: calcTotalKm(female), male: calcTotalKm(male), annual: calcTotalKm(annual) },
      markdown: buildRankingMarkdown(month, year, source),
    });
  });

  app.get('/api/stats', async (c) => {
    const source = await deps.workingCopy(c.env).load();
    const periods = listRankingPeriods(source);
    const latest = periods[periods.length - 1];
    if (!latest) throw new HttpError(404, 'Não há dados em data/');

    const year = parsePeriodParam(c.req.query('year'), 'Ano', latest.year);
    if (!periods.some((p) => p.year === year)) throw new HttpError(404, `Não há dados para ${year}`);

    return c.json(buildStats(year, source, currentPeriod(deps.now(), c.env)));
  });

  // publishing é sempre false: o GitHub é o árbitro de publicações concorrentes (compat com o frontend)
  app.get('/api/publish/status', async (c) => {
    const pendingChanges = await deps.workingCopy(c.env).pendingChanges();
    return c.json({ publishing: false, pendingChanges });
  });

  // Resumo do usuário para a trilha de auditoria; falha do Clerk nunca impede a gravação.
  async function auditUser(env: E, userId: string): Promise<{ id: string; email: string | null }> {
    try {
      const { email } = await deps.userSummary(env, userId);
      return { id: userId, email };
    } catch (err) {
      logWarn('falha ao buscar dados do usuário no Clerk', {
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      });
      return { id: userId, email: null };
    }
  }

  function commitMessageFor(wc: ReturnType<AppDeps<E>['workingCopy']>, user: { id: string; email: string | null }) {
    const { dd, mm, yyyy } = brasiliaParts(deps.now());
    return wc.commitMessage(`update: dados ${dd}/${mm}/${yyyy}`, user);
  }

  app.use('/api/analyze', limitBody(MAX_IMAGE_BYTES));
  app.post('/api/analyze', async (c) => {
    const { name, mimeType, data } = await readJsonBody(c.req);
    const source = await deps.workingCopy(c.env).load();
    const { canonicalName } = resolveParticipant(source, name);
    if (typeof mimeType !== 'string' || !SUPPORTED_MIME_TYPES.includes(mimeType)) {
      throw new HttpError(400, `Formato não suportado: ${mimeType}`);
    }
    if (typeof data !== 'string' || !data) throw new HttpError(400, 'Imagem vazia');

    const bytes = base64ToBytes(data);
    if (bytes.byteLength === 0) throw new HttpError(400, 'Imagem vazia');
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, 'Imagem muito grande');

    const hash = await sha256Hex(bytes);
    const hashPrefix = hash.slice(0, 12);
    const cachedEntry = await deps.imageCache(c.env).get(hash);
    if (cachedEntry) {
      logInfo('imagem encontrada no cache', {
        runner: canonicalName,
        hash: hashPrefix,
        km: cachedEntry.km,
        pace: cachedEntry.pace ?? null,
      });
      return c.json({ km: cachedEntry.km, pace: cachedEntry.pace ?? null, hash, cached: true, cachedEntry });
    }

    const startedAt = Date.now();
    const { km, pace } = await deps.analyze(c.env, bytes, mimeType);
    logInfo('atividade extraída da imagem', {
      runner: canonicalName,
      hash: hashPrefix,
      km,
      pace,
      mimeType,
      imageBytes: bytes.byteLength,
      durationMs: Date.now() - startedAt,
    });
    return c.json({ km, pace, hash, cached: false });
  });

  app.post('/api/save', async (c) => {
    const { entries: rawEntries } = await readJsonBody(c.req);
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) throw new HttpError(400, 'Nenhum registro para salvar');

    const wc = deps.workingCopy(c.env);
    const cache = deps.imageCache(c.env);
    const period = currentPeriod(deps.now(), c.env);
    const snapshot = await wc.load();

    // Validação e consultas ao cache ficam fora de build (que pode rodar duas vezes e deve ser puro).
    const entries: SaveEntry[] = [];
    const hashes = new Set<string>();
    for (const raw of rawEntries as Record<string, unknown>[]) {
      const { canonicalName } = resolveParticipant(snapshot, raw?.name);
      const { km, pace = null, hash, filename } = raw;
      if (typeof km !== 'number' || !Number.isFinite(km) || km <= 0) {
        throw new HttpError(400, `Km inválido para ${canonicalName}: ${km}`);
      }
      if (pace !== null && !isValidPace(pace)) throw new HttpError(400, `Pace inválido para ${canonicalName}: ${pace}`);
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
        throw new HttpError(400, `Hash inválido para ${canonicalName}`);
      }
      if (typeof filename !== 'string') throw new HttpError(400, `Nome do arquivo inválido para ${canonicalName}`);
      if (hashes.has(hash) || (await cache.get(hash))) {
        throw new HttpError(409, `Imagem ${filename} (${canonicalName}) já foi processada`);
      }
      hashes.add(hash);
      entries.push({ name: canonicalName, km, pace, hash, filename });
    }

    const user = await auditUser(c.env, c.get('userId'));
    await wc.save(
      (source) => {
        const participants = loadParticipants(source);
        const byGender: Record<Gender, SaveEntry[]> = { female: [], male: [] };
        for (const entry of entries) {
          const found = findParticipant(participants, entry.name);
          if (!found) throw new HttpError(404, `Participante "${entry.name}" não encontrado em data/runners.json`);
          byGender[found.gender].push({ ...entry, name: found.canonicalName });
        }
        const out: Record<string, string> = {};
        for (const gender of GENDERS) {
          if (byGender[gender].length === 0) continue;
          const data = loadMonthDataSync(gender, period.month, period.year, source);
          for (const entry of byGender[gender]) appendKm(data, entry.name, entry.km, entry.pace);
          out[monthRelPath(gender, period.month, period.year)] = serialize(data);
        }
        return out;
      },
      commitMessageFor(wc, user),
    );

    // Só depois do commit: se ele falhar, o usuário pode reenviar a mesma imagem.
    const { dd, mm, yyyy } = brasiliaParts(deps.now());
    const date = `${yyyy}-${mm}-${dd}`;
    for (const entry of entries) {
      const cacheEntry: CacheEntry = { km: entry.km, pace: entry.pace, date, filename: entry.filename };
      try {
        await cache.set(entry.hash, cacheEntry);
      } catch (err) {
        logWarn('falha ao gravar imagem no cache após o commit', {
          hash: entry.hash.slice(0, 12),
          err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
        });
      }
    }

    const fresh = await wc.load();
    const genderOf = (name: string) => findParticipant(loadParticipants(fresh), name)?.gender;
    logInfo('registros salvos', {
      month: period.month,
      entries: entries.length,
      female: entries.filter((e) => genderOf(e.name) === 'female').length,
      male: entries.filter((e) => genderOf(e.name) === 'male').length,
      totalKm: Number(entries.reduce((sum, e) => sum + e.km, 0).toFixed(2)),
    });
    return c.json(buildState(fresh, period));
  });

  app.post('/api/runners', async (c) => {
    const { name, gender } = await readJsonBody(c.req);
    if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Nome do participante é obrigatório');
    if (gender !== 'female' && gender !== 'male') throw new HttpError(400, `Gênero inválido: ${gender}`);

    const wc = deps.workingCopy(c.env);
    const user = await auditUser(c.env, c.get('userId'));
    await wc.save(
      (source) => {
        const participants: Participants = loadParticipants(source);
        const existing = findParticipant(participants, name.trim());
        if (existing) throw new HttpError(409, `Participante "${existing.canonicalName}" já existe`);
        addParticipant(participants, name, gender);
        return { 'runners.json': serialize(participants) };
      },
      commitMessageFor(wc, user),
    );
    logInfo('participante adicionado', { runner: name.trim(), gender });
    return c.json(buildState(await wc.load(), currentPeriod(deps.now(), c.env)));
  });

  app.delete('/api/runners/:name', async (c) => {
    const wc = deps.workingCopy(c.env);
    const user = await auditUser(c.env, c.get('userId'));
    let removed = '';
    await wc.save(
      (source) => {
        const { canonicalName } = resolveParticipant(source, c.req.param('name'));
        const participants = loadParticipants(source);
        removed = removeParticipant(participants, canonicalName);
        return { 'runners.json': serialize(participants) };
      },
      commitMessageFor(wc, user),
    );
    logInfo('participante removido', { runner: removed });
    return c.json(buildState(await wc.load(), currentPeriod(deps.now(), c.env)));
  });

  app.post('/api/new-month', async (c) => {
    const wc = deps.workingCopy(c.env);
    const { month, year } = currentPeriod(deps.now(), c.env);
    const conflict = () => new HttpError(409, `O manifest de ${getMonthName(month)}/${year} já foi gerado`);
    if (isManifestCurrent(await wc.load(), month, year)) throw conflict();

    const user = await auditUser(c.env, c.get('userId'));
    let createdFiles: string[] = [];
    await wc.save(
      (source) => {
        if (isManifestCurrent(source, month, year)) throw conflict();
        const plan = planNewMonth(source, month, year);
        createdFiles = plan.createdFiles;
        return plan.files;
      },
      commitMessageFor(wc, user),
    );

    // Só depois do commit: o cache de imagens é do mês anterior
    await deps.imageCache(c.env).clear();
    logInfo('novo mês gerado', { month, createdFiles });
    return c.json({ createdFiles, state: buildState(await wc.load(), { month, year }) });
  });

  app.post('/api/publish', async (c) => {
    const { autoMerge } = await readJsonBody(c.req);
    if (typeof autoMerge !== 'boolean') throw new HttpError(400, 'Informe se o merge deve ser automático');

    const wc = deps.workingCopy(c.env);
    const startedAt = Date.now();
    const { prUrl, merged } = await wc.publish(autoMerge);
    const log = `Pull request: ${prUrl}\n${merged ? 'Merge automático concluído.' : 'PR aberto sem merge.'}`;
    logInfo('publicação concluída', { autoMerge, prUrl, durationMs: Date.now() - startedAt });

    const { month, year } = currentPeriod(deps.now(), c.env);
    return c.json({ log, prUrl, markdown: buildRankingMarkdown(month, year, await wc.load()) });
  });

  app.onError(onError);
  app.notFound(notFound);
  return app;
}
