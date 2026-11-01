import * as path from 'path';
import 'dotenv/config';
import { extractActivityFromImage } from './imageAnalyzerGemini';
import { formatPace } from './pace';
import { loadParticipants, findParticipant } from './participantsParser';
import { loadMonthData, appendKm, saveMonthData, getDataFilePath } from './jsonUpdater';
import { computeHash, getCached, storeCache } from './cacheManager';
import { getImageFiles } from './imageFiles';
import { getCurrentMonth, capitalizeFirstLetter } from './utils';

interface Results {
  file: string;
  runner: string;
  km: number;
  pace: number | null;
  gender: string;
}

function describe(km: number, pace: number | null): string {
  return pace === null ? `${km.toFixed(2)}km` : `${km.toFixed(2)}km (${formatPace(pace)})`;
}

async function main() {
  const participants = loadParticipants();
  const month = getCurrentMonth();

  const imagesDir = path.resolve('images');
  const imageFiles = getImageFiles(imagesDir);

  if (imageFiles.length === 0) {
    console.log('Nenhuma imagem encontrada em images/');
    return;
  }

  const results: Results[] = [];

  for (const imagePath of imageFiles) {
    const filename = path.basename(imagePath);
    const nameWithoutExt = path.basename(imagePath, path.extname(imagePath));
    const baseName = nameWithoutExt.replace(/_\d+$/, '');
    const runnerName = capitalizeFirstLetter(baseName);
    const participant = findParticipant(participants, runnerName);

    if (!participant) {
      console.warn(`  Participante "${runnerName}" não encontrado em data/runners.json — ignorando`);
      continue;
    }

    const { gender, canonicalName } = participant;

    try {
      process.stdout.write(`Processando ${filename}...`);
      const today = new Date().toISOString().slice(0, 10);
      const hash = computeHash(imagePath);
      const cached = getCached(hash);

      let km: number;
      let pace: number | null;
      if (cached) {
        ({ km, pace = null } = cached);
        process.stdout.write(` ${canonicalName} → ${describe(km, pace)} (cache — ignorando)`);
      } else {
        ({ km, pace } = await extractActivityFromImage(imagePath));
        process.stdout.write(` ${canonicalName} → ${describe(km, pace)}`);
        storeCache(hash, { km, pace, date: today, filename });

        const data = await loadMonthData(gender, month);
        appendKm(data, canonicalName, km, pace);
        await saveMonthData(gender, month, data);
      }

      console.log(` ✓ (${getDataFilePath(gender, month)})`);
      results.push({ file: filename, runner: canonicalName, km, pace, gender });
    } catch (err) {
      console.log(` ✗`);
      console.error(`  Erro ao processar ${filename}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  if (results.length > 0) {
    console.log('\nResumo:');
    for (const r of results) {
      console.log(`  ${r.file} → ${r.runner} (${r.gender}) → ${describe(r.km, r.pace)}`);
    }
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
