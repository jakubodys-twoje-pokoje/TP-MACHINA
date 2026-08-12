/**
 * Eksporter 3000 - samodzielne narzędzie migracyjne.
 *
 * Jeden proces serwuje i GUI, i API. Nie ma tu Supabase, nie ma automatyzacji:
 * dane z Hotresa lądują w lokalnym SQLite, a ludzie przepisują je z GUI
 * do nowego PMS-a.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';

import { EXCLUDED, GROUPS, LANGS } from './catalogue.js';
import { assertCredentials, isLoggedIn, login, logout, readCredentials, requireAuth } from './auth.js';
import { normalizeOid } from './coerce.js';
import { prisma, readCounts, readSnapshot } from './db.js';
import { runExport } from './runExport.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(HERE, '..', '..', 'web', 'dist');
const PORT = Number(process.env.PORT ?? 4000);

assertCredentials(readCredentials());

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

// --- publiczne ------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'eksporter-3000' });
});

app.post('/api/login', (req, res) => {
  if (!login(req, res)) {
    res.status(401).json({ error: 'Zły login lub hasło' });
    return;
  }
  res.json({ ok: true, user: readCredentials().user });
});

app.post('/api/logout', (req, res) => {
  logout(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!isLoggedIn(req)) {
    res.status(401).json({ error: 'Nie zalogowano' });
    return;
  }
  res.json({ user: readCredentials().user });
});

// --- za logowaniem --------------------------------------------------------

app.use('/api', requireAuth);

/** GUI buduje z tego formularz eksportu - katalog nie jest nigdzie duplikowany. */
app.get('/api/catalogue', (_req, res) => {
  res.json({
    groups: GROUPS.map(group => ({
      key: group.key,
      label: group.label,
      action: group.action,
      description: group.description,
      lang: group.lang,
      optional: Boolean(group.optional),
      detailAction: group.detail?.action ?? null,
    })),
    excluded: EXCLUDED,
    langs: LANGS,
  });
});

/**
 * Lista obiektów w bazie - podstawa widoku "Obiekty".
 *
 * Hotres nie ma pola z nazwą obiektu, więc etykietę składamy z tego, co jest:
 * identyfikator tekstowy → nazwa firmy → miejscowość → sam OID.
 */
app.get('/api/properties', async (_req, res) => {
  const properties = await prisma.property.findMany({
    orderBy: { oid: 'asc' },
    select: {
      id: true,
      oid: true,
      identifier: true,
      companyName: true,
      city: true,
      email: true,
      updatedAt: true,
      migrationStatus: true,
      migrationNote: true,
      migrationUpdatedAt: true,
      migrationUpdatedBy: true,
      _count: {
        select: {
          roomTypes: true, rooms: true, ratePlans: true, addons: true,
          reviews: true, definitions: true,
        },
      },
    },
  });

  // Ostatni przebieg per obiekt - żeby na liście było widać, co i kiedy poszło.
  const runs = await prisma.exportRun.findMany({
    orderBy: { startedAt: 'desc' },
    select: { oid: true, status: true, startedAt: true, requests: true },
  });
  const lastRun = new Map<string, (typeof runs)[number]>();
  for (const run of runs) if (!lastRun.has(run.oid)) lastRun.set(run.oid, run);

  res.json(
    properties.map(property => ({
      ...property,
      label:
        property.identifier || property.companyName || property.city || `OID ${property.oid}`,
      lastRun: lastRun.get(property.oid) ?? null,
    })),
  );
});

const MIGRATION_STATUSES = ['todo', 'in_progress', 'done', 'skipped'];

/**
 * Postęp przepisywania obiektu do nowego PMS.
 *
 * To jedyne dane w bazie, których nie ma w Hotresie - dlatego ustawia je
 * człowiek, a eksport ich nie nadpisuje.
 */
app.patch('/api/properties/:oid/migration', async (req, res) => {
  const { status, note } = req.body ?? {};

  if (status !== undefined && !MIGRATION_STATUSES.includes(String(status))) {
    res.status(400).json({ error: `Nieznany status: ${status}` });
    return;
  }

  const property = await prisma.property.findUnique({
    where: { oid: normalizeOid(req.params.oid) },
    select: { id: true },
  });
  if (!property) {
    res.status(404).json({ error: 'Obiekt nie był jeszcze eksportowany' });
    return;
  }

  const updated = await prisma.property.update({
    where: { id: property.id },
    data: {
      ...(status !== undefined ? { migrationStatus: String(status) } : {}),
      ...(note !== undefined ? { migrationNote: note === '' ? null : String(note) } : {}),
      migrationUpdatedAt: new Date(),
      migrationUpdatedBy: readCredentials().user,
    },
    select: {
      oid: true, migrationStatus: true, migrationNote: true,
      migrationUpdatedAt: true, migrationUpdatedBy: true,
    },
  });

  res.json(updated);
});

/**
 * Uruchamia eksport i streamuje postęp jako NDJSON (linia = zdarzenie).
 * Rozłączenie klienta przerywa przebieg.
 */
app.post('/api/export', async (req, res) => {
  const { oid, langs, groups, withDetails, delayMs } = req.body ?? {};

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (event: Record<string, unknown>) => {
    if (res.writableEnded) return;
    res.write(`${JSON.stringify(event)}\n`);
  };

  // Uwaga: sygnałem "klient się rozłączył" jest zamknięcie ODPOWIEDZI.
  // `req.on('close')` odpala się już po wczytaniu ciała żądania, więc
  // przerywałoby każdy eksport natychmiast po starcie.
  const signal = { aborted: false };
  res.on('close', () => {
    if (!res.writableEnded) signal.aborted = true;
  });

  try {
    const summary = await runExport({
      prisma,
      oid: String(oid ?? ''),
      langs,
      groups,
      withDetails,
      delayMs,
      signal,
      onProgress: event => send({ type: 'progress', ...event }),
    });

    send({ type: 'done', summary, counts: await readCounts(summary.propertyId) });
  } catch (error: any) {
    console.error('[export]', error);
    send({ type: 'error', message: error?.message ?? String(error) });
  } finally {
    res.end();
  }
});

app.get('/api/runs', async (req, res) => {
  const oid = req.query.oid ? normalizeOid(req.query.oid) : undefined;
  const runs = await prisma.exportRun.findMany({
    where: oid ? { oid } : undefined,
    orderBy: { startedAt: 'desc' },
    take: Math.min(Number(req.query.limit ?? 25), 100),
    include: { stats: true, _count: { select: { errors: true, unmapped: true } } },
  });
  res.json(runs);
});

app.get('/api/runs/:id', async (req, res) => {
  const run = await prisma.exportRun.findUnique({
    where: { id: Number(req.params.id) },
    include: { stats: true, errors: true, unmapped: true },
  });
  if (!run) {
    res.status(404).json({ error: 'Nie ma takiego przebiegu' });
    return;
  }
  res.json(run);
});

/** Liczniki per tabela - kafelki "co siedzi w bazie". */
app.get('/api/properties/:oid/snapshot', async (req, res) => {
  const property = await prisma.property.findUnique({
    where: { oid: normalizeOid(req.params.oid) },
    select: { id: true, oid: true, city: true, email: true, currency: true, updatedAt: true },
  });
  if (!property) {
    res.status(404).json({ error: 'Obiekt nie był jeszcze eksportowany' });
    return;
  }
  res.json({ property, counts: await readCounts(property.id) });
});

/** Komplet danych obiektu - GUI renderuje z tego wszystkie widoki. */
app.get('/api/properties/:oid/data', async (req, res) => {
  const snapshot = await readSnapshot(normalizeOid(req.params.oid));
  if (!snapshot) {
    res.status(404).json({ error: 'Obiekt nie był jeszcze eksportowany' });
    return;
  }
  res.json(snapshot);
});

/** To samo, ale jako plik do pobrania. */
app.get('/api/properties/:oid/export.json', async (req, res) => {
  const snapshot = await readSnapshot(normalizeOid(req.params.oid));
  if (!snapshot) {
    res.status(404).json({ error: 'Obiekt nie był jeszcze eksportowany' });
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="hotres-${snapshot.oid}-export.json"`);
  res.json(snapshot);
});

// --- GUI ------------------------------------------------------------------

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  // Fallback tylko dla ścieżek GUI - nieznany endpoint API ma zwrócić 404 JSON,
  // a nie stronę HTML, bo inaczej literówka w adresie wygląda jak działający call.
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
} else {
  app.get('/', (_req, res) => {
    res
      .status(503)
      .type('text/plain')
      .send('GUI nie jest zbudowane. Uruchom: cd eksporter-3000/web && npm install && npm run build');
  });
}

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server]', error);
  res.status(500).json({ error: error?.message ?? 'Błąd serwera' });
});

const server = app.listen(PORT, () => {
  console.log(`Eksporter 3000 słucha na http://localhost:${PORT}`);
  if (!fs.existsSync(WEB_DIST)) console.warn('⚠️  Brak zbudowanego GUI w web/dist');
});

for (const name of ['SIGINT', 'SIGTERM'] as const) {
  process.on(name, () => {
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
