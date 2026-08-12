/**
 * Eksporter 3000 - lokalny serwis HTTP dla widoku "Eksport Hotres" w Machinie.
 *
 * Świadomie stoi obok Supabase: to tymczasowe narzędzie migracyjne, dane lądują
 * w lokalnej bazie SQLite pod Prismą, a poświadczenia Hotres siedzą w .env,
 * nie w bundlu przeglądarki.
 */

import express from 'express';
import cors from 'cors';

import { EXCLUDED, GROUPS, LANGS } from './catalogue.js';
import { prisma, readCounts, readSnapshot } from './db.js';
import { runExport } from './runExport.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'eksporter-3000' });
});

/** GUI buduje listę grup i języków z tego endpointu - żeden katalog nie jest duplikowany. */
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
 * Uruchamia eksport i streamuje postęp jako NDJSON (linia = zdarzenie).
 * Zerwanie połączenia przez klienta przerywa przebieg.
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

    const counts = await readCounts(summary.propertyId);
    send({ type: 'done', summary, counts });
  } catch (error: any) {
    console.error('[export]', error);
    send({ type: 'error', message: error?.message ?? String(error) });
  } finally {
    res.end();
  }
});

/** Historia przebiegów, opcjonalnie zawężona do jednego obiektu. */
app.get('/api/runs', async (req, res) => {
  const oid = req.query.oid ? String(req.query.oid) : undefined;
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

/** Co siedzi w bazie dla danego obiektu - liczniki do kafelków w GUI. */
app.get('/api/properties/:oid/snapshot', async (req, res) => {
  const property = await prisma.property.findUnique({
    where: { oid: String(req.params.oid) },
    select: { id: true, oid: true, city: true, email: true, currency: true, updatedAt: true },
  });
  if (!property) {
    res.status(404).json({ error: 'Obiekt nie był jeszcze eksportowany' });
    return;
  }
  res.json({ property, counts: await readCounts(property.id) });
});

/** Pełny zrzut obiektu z bazy - to jest plik do zassania przez nowy PMS. */
app.get('/api/properties/:oid/export.json', async (req, res) => {
  const snapshot = await readSnapshot(String(req.params.oid));
  if (!snapshot) {
    res.status(404).json({ error: 'Obiekt nie był jeszcze eksportowany' });
    return;
  }
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="hotres-${snapshot.oid}-export.json"`,
  );
  res.json(snapshot);
});

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server]', error);
  res.status(500).json({ error: error?.message ?? 'Błąd serwera' });
});

const server = app.listen(PORT, () => {
  console.log(`Eksporter 3000 słucha na http://localhost:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
