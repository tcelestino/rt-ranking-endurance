import * as fs from 'fs';
import * as path from 'path';
import { fsDataSource } from './dataSource';
import { planNewMonth } from './manifest';
import { getCurrentMonth, getCurrentYear } from './utils';

// Wrapper com fs: aplica o plano de planNewMonth em data/
export function generateManifest(): { createdFiles: string[]; months: number } {
  const year = getCurrentYear();
  const { files, createdFiles } = planNewMonth(fsDataSource, getCurrentMonth(), year);

  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.resolve('data', rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  const manifest: { months: unknown[] } = JSON.parse(files['manifest.json']);
  return { createdFiles: createdFiles.map((f) => `data/${year}/${f}`), months: manifest.months.length };
}

function main() {
  try {
    const { createdFiles, months } = generateManifest();
    for (const file of createdFiles) console.log(`Criado: ${file}`);
    console.log(`data/manifest.json gerado (${months} mês/meses)`);
  } catch (error) {
    console.error(`Erro: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (require.main === module) main();
