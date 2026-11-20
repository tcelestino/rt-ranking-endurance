import { Hono, type MiddlewareHandler } from 'hono';
import type { DataSource } from '../../processor/dataSource';
import type { ImageCache } from '../../processor/cacheManager';
import type { ActivityResult } from '../../processor/kmPrompt';
import { loadParticipants } from '../../processor/participantsParser';
import { loadMonthDataSync, getMonthName } from '../../processor/jsonUpdater';
import { isManifestCurrent } from '../../processor/manifest';
import { averagePace, paceTotals } from '../../processor/pace';
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
import { HttpError, notFound, onError } from './errors';
import { logWarn } from './logger';
import { clerkFrontendHost, rateLimit, requireSameOrigin, securityHeaders } from './security';
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
  workingCopy: (env: E) => Pick<WorkingCopy, 'load' | 'pendingChanges'>;
  imageCache: (env: E) => ImageCache;
  analyze: (env: E, bytes: Uint8Array, mimeType: string) => Promise<ActivityResult>;
  userSummary: (env: E, userId: string) => Promise<{ name: string | null; email: string | null }>;
  now: () => Date;
}

type Gender = 'female' | 'male';
const GENDERS: Gender[] = ['female', 'male'];

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

  app.onError(onError);
  app.notFound(notFound);
  return app;
}
