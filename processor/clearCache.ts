import * as path from 'path';
import * as fs from 'fs';

const CACHE_PATH = path.resolve('data', '.image-cache.json');

function main() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.log('Arquivo de cache não encontrado. Nada a limpar.');
    return;
  }

  fs.writeFileSync(CACHE_PATH, '{}\n');
  console.log('Cache limpo com sucesso.');
}

main();
