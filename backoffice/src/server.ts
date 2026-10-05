import 'dotenv/config';
import { execFile } from 'child_process';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { promisify } from 'util';
import { extractKmFromImageBuffer } from '../../processor/imageAnalyzerCloudflare';
import { computeHashFromBuffer, getCached, removeCache, storeCache } from '../../processor/cacheManager';
import { appendKm, getMonthName, loadMonthData, saveMonthData } from '../../processor/jsonUpdater';
import { generateManifest, isManifestCurrent } from '../../processor/manifest';
import { writeRankingMarkdown } from '../../processor/markdownGenerator';
import {
  buildRankingMarkdown,
  calcAnnualRanking,
  calcMonthlyRanking,
  calcTotalKm,
  listRankingPeriods,
  MONTH_DISPLAY,
} from '../../processor/ranking';
import {
  addParticipant,
  findParticipant,
  loadParticipants,
  removeParticipant,
  saveParticipants,
} from '../../processor/participantsParser';
import { capitalizeFirstLetter, getCurrentMonth } from '../../processor/utils';

type Gender = 'female' | 'male';

interface SaveEntry {
  name: string;
  km: number;
  hash: string;
  filename: string;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const PORT = Number(process.env.BACKOFFICE_PORT) || 3002;
const SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const DEPLOY_TIMEOUT_MS = 5 * 60 * 1000;

const execFileAsync = promisify(execFile);
let publishing = false;

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.resolve(__dirname, '../public')));

function resolveParticipant(name: unknown) {
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Nome do participante é obrigatório');
  const participant = findParticipant(loadParticipants(), name);
  if (!participant) throw new HttpError(404, `Participante "${name}" não encontrado em data/runners.json`);
  return participant;
}

async function buildState() {
  const month = getCurrentMonth();
  const participants = loadParticipants();
  const genders: Gender[] = ['female', 'male'];

  const result = [];
  for (const gender of genders) {
    const data = await loadMonthData(gender, month);
    for (const name of participants[gender]) {
      const km = data.find((p) => p.name === name)?.km ?? [];
      const total = km.reduce((sum, v) => sum + v, 0);
      result.push({ name, gender, km, total });
    }
  }

  return {
    month,
    monthName: getMonthName(month),
    year: new Date().getFullYear(),
    manifestCurrent: isManifestCurrent(),
    participants: result,
  };
}

app.get('/api/state', async (_req, res, next) => {
  try {
    res.json(await buildState());
  } catch (err) {
    next(err);
  }
});

function displayMonthName(month: number): string {
  return capitalizeFirstLetter(MONTH_DISPLAY[getMonthName(month)]);
}

function parsePeriodParam(value: unknown, label: string, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new HttpError(400, `${label} inválido: ${value}`);
  return parsed;
}

app.get('/api/ranking', (req, res, next) => {
  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = getCurrentMonth();
    const periods = listRankingPeriods();
    const hasData = (y: number, m: number) => periods.some((p) => p.year === y && p.months.includes(m));

    let year = parsePeriodParam(req.query.year, 'Ano', currentYear);
    let month = parsePeriodParam(req.query.month, 'Mês', currentMonth);
    const explicit = req.query.year !== undefined || req.query.month !== undefined;

    if (!hasData(year, month)) {
      // sem filtro explícito (ex.: dia 1 antes do novo mês), exibe o período mais recente com dados
      const latest = periods[periods.length - 1];
      if (explicit || !latest) throw new HttpError(404, `Não há dados para ${month}/${year}`);
      year = latest.year;
      month = latest.months[latest.months.length - 1];
    }

    const female = calcMonthlyRanking('female', month, year);
    const male = calcMonthlyRanking('male', month, year);
    const annual = calcAnnualRanking(year);
    res.json({
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
      markdown: buildRankingMarkdown(month, year),
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/analyze', async (req, res, next) => {
  try {
    const { name, mimeType, data } = req.body ?? {};
    resolveParticipant(name);
    if (!SUPPORTED_MIME_TYPES.includes(mimeType)) throw new HttpError(400, `Formato não suportado: ${mimeType}`);
    if (typeof data !== 'string' || !data) throw new HttpError(400, 'Imagem vazia');

    const buffer = Buffer.from(data, 'base64');
    const hash = computeHashFromBuffer(buffer);
    const cachedEntry = getCached(hash);
    if (cachedEntry) {
      res.json({ km: cachedEntry.km, hash, cached: true, cachedEntry });
      return;
    }

    const km = await extractKmFromImageBuffer(buffer, mimeType);
    res.json({ km, hash, cached: false });
  } catch (err) {
    next(err);
  }
});

app.post('/api/save', async (req, res, next) => {
  try {
    const entries: SaveEntry[] = req.body?.entries;
    if (!Array.isArray(entries) || entries.length === 0) throw new HttpError(400, 'Nenhum registro para salvar');

    const month = getCurrentMonth();
    const byGender: Record<Gender, { canonicalName: string; entry: SaveEntry }[]> = { female: [], male: [] };
    const hashes = new Set<string>();

    for (const entry of entries) {
      const { gender, canonicalName } = resolveParticipant(entry.name);
      if (typeof entry.km !== 'number' || !Number.isFinite(entry.km) || entry.km <= 0) {
        throw new HttpError(400, `Km inválido para ${canonicalName}: ${entry.km}`);
      }
      if (typeof entry.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash)) {
        throw new HttpError(400, `Hash inválido para ${canonicalName}`);
      }
      if (hashes.has(entry.hash) || getCached(entry.hash)) {
        throw new HttpError(409, `Imagem ${entry.filename} (${canonicalName}) já foi processada`);
      }
      hashes.add(entry.hash);
      byGender[gender].push({ canonicalName, entry });
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const gender of Object.keys(byGender) as Gender[]) {
      if (byGender[gender].length === 0) continue;
      const data = await loadMonthData(gender, month);
      for (const { canonicalName, entry } of byGender[gender]) {
        appendKm(data, canonicalName, entry.km);
      }
      await saveMonthData(gender, month, data);
      for (const { entry } of byGender[gender]) {
        storeCache(entry.hash, { km: entry.km, date: today, filename: entry.filename });
      }
    }

    res.json(await buildState());
  } catch (err) {
    next(err);
  }
});

app.post('/api/runners', async (req, res, next) => {
  try {
    const { name, gender } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Nome do participante é obrigatório');
    if (gender !== 'female' && gender !== 'male') throw new HttpError(400, `Gênero inválido: ${gender}`);

    const participants = loadParticipants();
    const existing = findParticipant(participants, name.trim());
    if (existing) throw new HttpError(409, `Participante "${existing.canonicalName}" já existe`);

    addParticipant(participants, name, gender);
    saveParticipants(participants);
    res.json(await buildState());
  } catch (err) {
    next(err);
  }
});

app.delete('/api/runners/:name', async (req, res, next) => {
  try {
    const { canonicalName } = resolveParticipant(req.params.name);
    const participants = loadParticipants();
    removeParticipant(participants, canonicalName);
    saveParticipants(participants);
    res.json(await buildState());
  } catch (err) {
    next(err);
  }
});

app.post('/api/new-month', async (_req, res, next) => {
  try {
    if (isManifestCurrent()) {
      const month = getCurrentMonth();
      throw new HttpError(409, `O manifest de ${getMonthName(month)}/${new Date().getFullYear()} já foi gerado`);
    }
    removeCache();
    const { createdFiles } = generateManifest();
    res.json({ createdFiles, state: await buildState() });
  } catch (err) {
    next(err);
  }
});

async function listPendingDataChanges(): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', 'data/']);
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
}

app.get('/api/publish/status', async (_req, res, next) => {
  try {
    res.json({ publishing, pendingChanges: await listPendingDataChanges() });
  } catch (err) {
    next(err);
  }
});

app.post('/api/publish', async (req, res, next) => {
  try {
    const { autoMerge } = req.body ?? {};
    if (typeof autoMerge !== 'boolean') throw new HttpError(400, 'Informe se o merge deve ser automático');
    if (publishing) throw new HttpError(409, 'Já existe uma publicação em andamento');

    const pendingChanges = await listPendingDataChanges();
    if (pendingChanges.length === 0) throw new HttpError(409, 'Nenhuma alteração em data/ para publicar');

    publishing = true;
    try {
      const markdown = writeRankingMarkdown();
      const args = ['scripts/deploy.sh', ...(autoMerge ? [] : ['--no-merge'])];
      try {
        const { stdout, stderr } = await execFileAsync('bash', args, { timeout: DEPLOY_TIMEOUT_MS });
        const log = `${stdout}${stderr}`;
        res.json({ log, prUrl: extractPrUrl(log), markdown });
      } catch (err) {
        const { stdout = '', stderr = '', message } = err as { stdout?: string; stderr?: string; message: string };
        const log = `${stdout}${stderr}` || message;
        console.error(`[POST /api/publish] deploy.sh falhou: ${message}`);
        res.status(500).json({ error: 'Falha ao publicar. Confira o log.', log, prUrl: extractPrUrl(log) });
      }
    } finally {
      publishing = false;
    }
  } catch (err) {
    next(err);
  }
});

function extractPrUrl(log: string): string | null {
  return log.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0] ?? null;
}

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${req.method} ${req.path}] ${status}: ${message}`);
  res.status(status).json({ error: message });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Backoffice rodando em http://localhost:${PORT}`);
});
