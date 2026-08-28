/**
 * Pliki importu - materiały człowieka przypięte do obiektu.
 *
 * Nie mają nic wspólnego z Hotresem: to arkusze, zdjęcia od właściciela,
 * notatki czy gotowe paczki do wgrania w nowym PMS. Leżą na dysku obok bazy,
 * w bazie są tylko metadane.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import multer from 'multer';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Katalog na pliki; obok bazy, żeby backup obejmował jedno miejsce. */
export const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR ?? path.join(HERE, '..', 'data', 'uploads'),
);

/** 200 MB - paczki zdjęć od właścicieli potrafią być duże. */
export const MAX_FILE_SIZE = Number(process.env.MAX_UPLOAD_MB ?? 200) * 1024 * 1024;

export function propertyDir(oid: string): string {
  // OID jest wyłącznie cyfrowy, ale i tak filtrujemy - katalog buduje się
  // z danych z zewnątrz.
  return path.join(UPLOADS_DIR, oid.replace(/[^0-9a-zA-Z_-]/g, ''));
}

/**
 * Nazwa pliku na dysku.
 *
 * Nazwa od użytkownika NIGDY nie trafia do ścieżki - trzymamy ją w bazie,
 * a na dysku leży losowy identyfikator z zachowanym rozszerzeniem.
 */
function storedNameFor(originalName: string): string {
  const extension = path.extname(originalName).slice(0, 12).replace(/[^.0-9a-zA-Z]/g, '');
  return `${crypto.randomUUID()}${extension}`;
}

/**
 * Nazwy plików z przeglądarek przyjeżdżają jako latin1 - bez tego polskie
 * znaki w nazwie zamieniają się w krzaki.
 */
export function decodeOriginalName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  // Jeśli dekodowanie dało znak zastępczy, oryginał był już poprawnym UTF-8.
  return decoded.includes('�') ? name : decoded;
}

export const upload = multer({
  limits: { fileSize: MAX_FILE_SIZE },
  storage: multer.diskStorage({
    destination(req, _file, done) {
      const dir = propertyDir(String(req.params.oid ?? ''));
      fs.mkdir(dir, { recursive: true }, error => done(error, dir));
    },
    filename(_req, file, done) {
      done(null, storedNameFor(file.originalname));
    },
  }),
});

/** Kasuje plik z dysku; brak pliku nie jest błędem - metadane i tak znikają. */
export function removeStoredFile(oid: string, storedName: string): void {
  try {
    fs.rmSync(path.join(propertyDir(oid), storedName), { force: true });
  } catch {
    // Nie przerywamy kasowania rekordu przez problem z plikiem.
  }
}

export function storedFilePath(oid: string, storedName: string): string {
  return path.join(propertyDir(oid), storedName);
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
