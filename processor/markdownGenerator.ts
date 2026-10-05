import * as fs from 'fs';
import * as path from 'path';
import { getDataFilePath, getMonthName, getFullYear } from './jsonUpdater';
import { buildRankingMarkdown, MONTH_DISPLAY } from './ranking';
import { getCurrentMonth } from './utils';

export function writeRankingMarkdown(): string {
  const currentMonth = getCurrentMonth();
  const year = getFullYear();
  const slug = getMonthName(currentMonth);

  const femaleFilePath = getDataFilePath('female', currentMonth);
  const maleFilePath = getDataFilePath('male', currentMonth);

  if (!fs.existsSync(femaleFilePath) || !fs.existsSync(maleFilePath)) {
    throw new Error(`Dados do mês ${slug} não encontrados (${femaleFilePath} ou ${maleFilePath}).`);
  }

  const markdown = buildRankingMarkdown(currentMonth, year);

  const outputDir = path.resolve('output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(path.resolve(outputDir, 'ranking.md'), markdown, 'utf-8');
  return markdown;
}

function main() {
  try {
    writeRankingMarkdown();
    const slug = getMonthName(getCurrentMonth());
    console.log(`output/ranking.md gerado com sucesso (${MONTH_DISPLAY[slug]} ${getFullYear()})`);
  } catch (error) {
    console.error(`Erro: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (require.main === module) main();
