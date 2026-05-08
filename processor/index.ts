import * as path from 'path';
import 'dotenv/config';
import { extractKmFromImage } from './imageAnalyzerGemini';
import { loadParticipants, findParticipant } from './participantsParser';
import { loadMonthData, appendKm, saveMonthData, getDataFilePath } from './jsonUpdater';
import { computeHash, getCached, storeCache } from './cacheManager';
import { getImageFiles } from './imageFiles';
import { getCurrentMonth, capitalizeFirstLetter } from './utils';

interface Results {
  file: string;
  runner: string;
  km: number;
  gender: string;
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
      if (cached) {
        km = cached.km;
        process.stdout.write(` ${canonicalName} → ${km.toFixed(2)}km (cache — ignorando)`);
      } else {
        km = await extractKmFromImage(imagePath);
        process.stdout.write(` ${canonicalName} → ${km.toFixed(2)}km`);
        storeCache(hash, { km, date: today, filename });

        const data = await loadMonthData(gender, month);
        appendKm(data, canonicalName, km);
        await saveMonthData(gender, month, data);
      }

      console.log(` ✓ (${getDataFilePath(gender, month)})`);
      results.push({ file: filename, runner: canonicalName, km, gender });
    } catch (err) {
      console.log(` ✗`);
      console.error(`  Erro ao processar ${filename}: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  if (results.length > 0) {
    console.log('\nResumo:');
    for (const r of results) {
      console.log(`  ${r.file} → ${r.runner} (${r.gender}) → ${r.km.toFixed(2)}km`);
    }
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
