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

function readJsonFile(filePath: string, res: express.Response): void {
  fs.readFile(filePath, 'utf-8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.status(404).json({ error: 'Dado não encontrado' });
      } else {
        res.status(500).json({ error: 'Erro ao ler os dados' });
      }
      return;
    }
    try {
      res.json(JSON.parse(data));
    } catch {
      res.status(500).json({ error: 'Erro ao fazer o parse do JSON' });
    }
  });
}

function getDataByYear(year?: string): string {
  const fullYear = !year ? new Date().getFullYear() : year;
  return path.resolve(DATA_DIR, fullYear.toString());
}

function resultData(gender: 'male' | 'female', req: Request, res: Response) {
  const { year, month } = req.params;
  const data = getDataByYear(year as string);

  readJsonFile(path.join(data, `${gender}-${month}.json`), res);
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

app.get('/api/manifest', (_req, res) => {
  readJsonFile(path.join(DATA_DIR, 'manifest.json'), res);
});

app.get('/api/runners', (_req, res) => {
  readJsonFile(path.join(DATA_DIR, 'runners.json'), res);
});

app.get('/api/data/:year/:month/female', validateMonth, (req, res) => {
  resultData('female', req, res);
});

app.get('/api/data/:year/:month/male', validateMonth, (req, res) => {
  resultData('male', req, res);
});

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
