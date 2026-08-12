import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.resolve(HERE, '..', 'prisma', 'test.db');

/**
 * Świeża baza testowa przed każdym uruchomieniem zestawu.
 *
 * Kasujemy plik i stawiamy schemat od zera zwykłym `db push` - bez
 * `--force-reset`, który jest destrukcyjną operacją migracyjną. Tu i tak nie ma
 * czego chronić: to lokalny plik SQLite tworzony wyłącznie na potrzeby testów.
 */
export default function setup() {
  for (const suffix of ['', '-journal']) {
    fs.rmSync(`${TEST_DB}${suffix}`, { force: true });
  }

  execSync('npx prisma db push --skip-generate', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
  });
}
