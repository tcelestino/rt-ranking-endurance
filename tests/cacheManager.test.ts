import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import { loadCache } from '../processor/cacheManager';
import { createLogger } from '../processor/logger';

test('cache corrompido gera warn e retorna cache vazio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-'));
  const file = path.join(dir, '.image-cache.json');
  fs.writeFileSync(file, '{ não é json');

  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _e, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });

  const cache = loadCache(file, createLogger({ level: 'warn', destination }));

  assert.deepEqual(cache, {});
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'warn');
  assert.equal(lines[0].path, file);
});
