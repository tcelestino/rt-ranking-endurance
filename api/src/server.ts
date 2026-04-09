import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.resolve(__dirname, "../../data");

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000"];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET"],
  }),
);

const limiter =
  process.env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
      })
    : (_req: Request, _res: Response, next: NextFunction) => next();

app.use(limiter);

function readJsonFile(filePath: string, res: express.Response): void {
  fs.readFile(filePath, "utf-8", (err, data) => {
    if (err) {
      res.status(404).json({ error: "Arquivo não encontrado" });
      return;
    }
    try {
      res.json(JSON.parse(data));
    } catch {
      res.status(500).json({ error: "Erro ao parsear JSON" });
    }
  });
}

app.get("/api/manifest", (_req, res) => {
  readJsonFile(path.join(DATA_DIR, "manifest.json"), res);
});

app.get("/api/runners", (_req, res) => {
  readJsonFile(path.join(DATA_DIR, "runners.json"), res);
});

const MONTH_REGEX = /^[a-z]+$/;

app.get("/api/data/:month/female", (req, res) => {
  const { month } = req.params;
  if (!MONTH_REGEX.test(month)) {
    res.status(400).json({ error: "Mês inválido" });
    return;
  }
  readJsonFile(path.join(DATA_DIR, `female-${month}.json`), res);
});

app.get("/api/data/:month/male", (req, res) => {
  const { month } = req.params;
  if (!MONTH_REGEX.test(month)) {
    res.status(400).json({ error: "Mês inválido" });
    return;
  }
  readJsonFile(path.join(DATA_DIR, `male-${month}.json`), res);
});

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
