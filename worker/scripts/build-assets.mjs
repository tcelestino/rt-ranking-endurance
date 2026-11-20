// Copia backoffice/public/* para worker/dist-assets/backoffice/ (servido em /backoffice/<arquivo>).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(root, 'backoffice/public');
const target = resolve(root, 'worker/dist-assets/backoffice');

rmSync(resolve(root, 'worker/dist-assets'), { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`assets copiados: ${source} -> ${target}`);
