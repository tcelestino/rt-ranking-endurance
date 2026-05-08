import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.resolve(__dirname, '../../data');

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000'];

const VALID_MONTH_SLUGS = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const validateMonth = (req: Request, res: Response, next: NextFunction) => {
  const { month } = req.params;
  if (!month || typeof month !== 'string' || !VALID_MONTH_SLUGS.includes(month)) {
    return res.status(400).json({ error: 'Parâmetro de mês inválido ou ausente' });
  }
  next();
};

const validateYear = (req: Request, res: Response, next: NextFunction) => {
  const { year } = req.params;
  if (year && !/^\d{4}$/.test(year as string)) {
    return res.status(400).json({ error: 'Parâmetro de ano inválido' });
  }
  next();
};

async function readJsonFile(filePath: string, res: express.Response): Promise<void> {
  try {
    const data = await fs.promises.readFile(filePath, 'utf-8');
    res.json(JSON.parse(data));
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      res.status(404).json({ error: 'Dado não encontrado' });
    } else {
      console.error(`Erro ao ler arquivo ${filePath}:`, err);
      res.status(500).json({ error: 'Erro ao ler os dados' });
    }
  }
}

function getDataByYear(year?: string): string {
  const fullYear = !year ? new Date().getFullYear().toString() : year;
  return path.join(DATA_DIR, fullYear);
}

async function resultData(gender: 'male' | 'female', req: Request, res: Response) {
  const { year, month } = req.params;
  const dataDir = getDataByYear(year as string);
  const filePath = path.join(dataDir, `${gender}-${month}.json`);

  // Adicional safety check: ensure the resolved path is still within DATA_DIR
  if (!filePath.startsWith(DATA_DIR)) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  await readJsonFile(filePath, res);
}

app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET'],
  }),
);

const limiter =
  process.env.NODE_ENV === 'production'
    ? rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
      })
    : (_req: Request, _res: Response, next: NextFunction) => next();

app.use(limiter);

app.get('/api/manifest', async (_req, res) => {
  await readJsonFile(path.join(DATA_DIR, 'manifest.json'), res);
});

app.get('/api/runners', async (_req, res) => {
  await readJsonFile(path.join(DATA_DIR, 'runners.json'), res);
});

app.get('/api/data/:year/:month/female', validateYear, validateMonth, async (req, res) => {
  await resultData('female', req, res);
});

app.get('/api/data/:year/:month/male', validateYear, validateMonth, async (req, res) => {
  await resultData('male', req, res);
});

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
