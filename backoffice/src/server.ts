import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { extractKmFromImageBuffer } from '../../processor/imageAnalyzerCloudflare';
import { computeHashFromBuffer, getCached, storeCache } from '../../processor/cacheManager';
import { appendKm, getMonthName, loadMonthData, saveMonthData } from '../../processor/jsonUpdater';
import { findParticipant, loadParticipants } from '../../processor/participantsParser';
import { getCurrentMonth } from '../../processor/utils';

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

  return { month, monthName: getMonthName(month), year: new Date().getFullYear(), participants: result };
}

app.get('/api/state', async (_req, res, next) => {
  try {
    res.json(await buildState());
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

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${req.method} ${req.path}] ${status}: ${message}`);
  res.status(status).json({ error: message });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Backoffice rodando em http://localhost:${PORT}`);
});
