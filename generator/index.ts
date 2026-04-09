import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import { extractKmFromImage } from "./imageAnalyzerGemini";
import { loadParticipants, findGender } from "./participantsParser";
import {
  loadMonthData,
  appendKm,
  saveMonthData,
  getDataFilePath,
} from "./jsonUpdater";
import { computeHash, getCached, storeCache } from "./cacheManager";

function capitalizeFirstLetter(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function getCurrentMonth(): number {
  const env = process.env.CURRENT_MONTH;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 12) return parsed;
  }
  return new Date().getMonth() + 1;
}

function getImageFiles(imagesDir: string): string[] {
  if (!fs.existsSync(imagesDir)) {
    throw new Error(`Pasta "${imagesDir}" não encontrada`);
  }

  const supported = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
  return fs
    .readdirSync(imagesDir)
    .filter((f) => supported.includes(path.extname(f).toLowerCase()))
    .map((f) => path.join(imagesDir, f));
}

async function main() {
  const participants = loadParticipants();
  const month = getCurrentMonth();

  const imagesDir = path.resolve("images");
  const imageFiles = getImageFiles(imagesDir);

  if (imageFiles.length === 0) {
    console.log("Nenhuma imagem encontrada em images/");
    return;
  }

  const results: Array<{
    file: string;
    runner: string;
    km: number;
    gender: string;
  }> = [];

  for (const imagePath of imageFiles) {
    const filename = path.basename(imagePath);
    const nameWithoutExt = path.basename(imagePath, path.extname(imagePath));
    const runnerName = capitalizeFirstLetter(nameWithoutExt);

    const gender = findGender(participants, runnerName);
    if (!gender) {
      console.warn(
        `  Participante "${runnerName}" não encontrado em data/runners.json — ignorando`,
      );
      continue;
    }

    try {
      process.stdout.write(`Processando ${filename}...`);
      const today = new Date().toISOString().slice(0, 10);
      const hash = computeHash(imagePath);
      const cached = getCached(hash);

      let km: number;
      if (cached) {
        km = cached.km;
        process.stdout.write(
          ` ${runnerName} → ${km.toFixed(2)}km (cache — ignorando)`,
        );
      } else {
        km = await extractKmFromImage(imagePath);
        process.stdout.write(` ${runnerName} → ${km.toFixed(2)}km`);
        storeCache(hash, { km, date: today, filename });

        const data = loadMonthData(gender, month);
        appendKm(data, runnerName, km);
        saveMonthData(gender, month, data);
      }

      console.log(` ✓ (${getDataFilePath(gender, month)})`);
      results.push({ file: filename, runner: runnerName, km, gender });
    } catch (err) {
      console.log(` ✗`);
      console.error(
        `  Erro ao processar ${filename}: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }
  }

  if (results.length > 0) {
    console.log("\nResumo:");
    for (const r of results) {
      console.log(
        `  ${r.file} → ${r.runner} (${r.gender}) → ${r.km.toFixed(2)}km`,
      );
    }
  }
}

main().catch((err) => {
  console.error("Erro fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
