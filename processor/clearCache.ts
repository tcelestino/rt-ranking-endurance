import * as path from 'path';
import * as fs from 'fs';
import { CACHE_PATH, removeCache } from './cacheManager';

function main() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.log('Arquivo de cache não encontrado. Nada a limpar.');
    return;
  }
  console.log('Iniciando limpeza do cache...');
  removeCache();
  console.log('Cache limpo com sucesso.');
}

main();
