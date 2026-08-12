/**
 * Orkiestracja przebiegu: pobierz z Hotres → zapisz do bazy → zamknij ExportRun.
 */

import type { PrismaClient } from '@prisma/client';
import { GROUP_KEYS, LANGS, orderGroups } from './catalogue.js';
import { normalizeOid } from './coerce.js';
import { createHotresClient } from './hotres.js';
import { fetchAll, type ProgressEvent, type RunError } from './fetchAll.js';
import { IMPORTERS, type ImportContext } from './importers.js';

export interface RunOptions {
  prisma: PrismaClient;
  oid: string;
  langs?: string[];
  groups?: string[];
  withDetails?: boolean;
  delayMs?: number;
  onProgress?: (event: ProgressEvent) => void;
  signal?: { aborted: boolean };
  /** Wstrzykiwane w testach. */
  fetchImpl?: typeof fetch;
  credentials?: { user: string; password: string };
}

export interface RunSummary {
  runId: number;
  oid: string;
  propertyId: number;
  status: 'ok' | 'error' | 'aborted';
  langs: string[];
  groups: string[];
  requests: number;
  durationMs: number;
  stats: { group: string; fetched: number; written: number; removed: number }[];
  errors: RunError[];
  unmapped: { group: string; field: string; sample: string | null }[];
}

function validate(options: RunOptions): { langs: string[]; groups: string[] } {
  const oid = normalizeOid(options.oid);
  if (!oid) throw new Error('Brak OID obiektu');

  const langs = (options.langs?.length ? options.langs : ['pl']).map(lang => lang.trim());
  const unknownLang = langs.find(lang => !LANGS.includes(lang));
  if (unknownLang) throw new Error(`Nieznany język: ${unknownLang}`);

  const groups = options.groups?.length ? options.groups : GROUP_KEYS;
  const unknownGroup = groups.find(group => !GROUP_KEYS.includes(group));
  if (unknownGroup) throw new Error(`Nieznana grupa danych: ${unknownGroup}`);

  return { langs, groups };
}

export async function runExport(options: RunOptions): Promise<RunSummary> {
  const { prisma, onProgress, signal } = options;
  const { langs, groups } = validate(options);
  const oid = normalizeOid(options.oid);
  const withDetails = options.withDetails ?? true;
  const startedAt = Date.now();

  const ordered = orderGroups(groups);

  // Rekord obiektu musi istnieć przed czymkolwiek innym - wszystkie pozostałe
  // tabele wiszą na nim relacją, także gdy grupa `object` nie jest wybrana.
  const property = await prisma.property.upsert({
    where: { oid },
    create: { oid },
    update: {},
  });

  const run = await prisma.exportRun.create({
    data: {
      oid,
      propertyId: property.id,
      status: 'running',
      langs: langs.join(','),
      groups: ordered.map(group => group.key).join(','),
      withDetails,
    },
  });

  const client = createHotresClient({
    user: options.credentials?.user ?? process.env.HOTRES_API_USER ?? '',
    password: options.credentials?.password ?? process.env.HOTRES_API_PASSWORD ?? '',
    oid,
    delayMs: options.delayMs ?? 350,
    fetchImpl: options.fetchImpl,
  });

  const errors: RunError[] = [];
  const stats: RunSummary['stats'] = [];
  const unmapped = new Map<string, Map<string, string | null>>();

  try {
    const fetched = await fetchAll({
      client,
      langs,
      groups: ordered.map(group => group.key),
      withDetails,
      onProgress,
      signal,
    });
    errors.push(...fetched.errors);

    const ctx: ImportContext = { prisma, propertyId: property.id, langs, unmapped };

    for (const group of ordered) {
      if (signal?.aborted) throw new Error('Eksport przerwany');

      const entry = fetched.groups[group.key];
      if (!entry) continue;

      const importer = IMPORTERS[group.key];
      if (!importer) continue;

      try {
        const outcome = await importer(ctx, entry);
        const fetchedCount = countFetched(entry, langs);
        stats.push({
          group: group.key,
          fetched: fetchedCount,
          written: outcome.written,
          removed: outcome.removed,
        });
        onProgress?.({
          completed: 0,
          total: 0,
          message: `Zapis ${group.label}: ${outcome.written} rekordów${
            outcome.removed ? `, usunięto ${outcome.removed}` : ''
          }`,
          level: 'ok',
        });
      } catch (error: any) {
        errors.push({
          group: group.key,
          action: group.action,
          message: `Zapis do bazy: ${error.message ?? String(error)}`,
          soft: false,
        });
        onProgress?.({
          completed: 0,
          total: 0,
          message: `Zapis ${group.label}: ${error.message}`,
          level: 'error',
        });
      }
    }

    const durationMs = Date.now() - startedAt;
    const status = errors.some(error => !error.soft) ? 'error' : 'ok';

    await persist(prisma, run.id, { status, requests: client.requestCount, durationMs, errors, stats, unmapped });

    onProgress?.({
      completed: 0,
      total: 0,
      message: `Gotowe: ${client.requestCount} zapytań, ${errors.length} błędów`,
      level: status === 'ok' ? 'ok' : 'warn',
    });

    return {
      runId: run.id,
      oid,
      propertyId: property.id,
      status,
      langs,
      groups: ordered.map(group => group.key),
      requests: client.requestCount,
      durationMs,
      stats,
      errors,
      unmapped: flattenUnmapped(unmapped),
    };
  } catch (error: any) {
    const durationMs = Date.now() - startedAt;
    const aborted = signal?.aborted === true;
    const status = aborted ? 'aborted' : 'error';

    await persist(prisma, run.id, {
      status,
      requests: client.requestCount,
      durationMs,
      errors,
      stats,
      unmapped,
      failureMessage: error.message ?? String(error),
    });

    if (aborted) {
      return {
        runId: run.id,
        oid,
        propertyId: property.id,
        status,
        langs,
        groups: ordered.map(group => group.key),
        requests: client.requestCount,
        durationMs,
        stats,
        errors,
        unmapped: flattenUnmapped(unmapped),
      };
    }

    throw error;
  }
}

function countFetched(entry: { byLang: Record<string, any> }, langs: string[]): number {
  const payload = entry.byLang[langs[0]] ?? entry.byLang._ ?? Object.values(entry.byLang)[0];
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === 'object') return Object.keys(payload).length;
  return 0;
}

function flattenUnmapped(
  unmapped: Map<string, Map<string, string | null>>,
): RunSummary['unmapped'] {
  const rows: RunSummary['unmapped'] = [];
  for (const [group, fields] of unmapped) {
    for (const [field, value] of fields) rows.push({ group, field, sample: value });
  }
  return rows;
}

async function persist(
  prisma: PrismaClient,
  runId: number,
  payload: {
    status: string;
    requests: number;
    durationMs: number;
    errors: RunError[];
    stats: RunSummary['stats'];
    unmapped: Map<string, Map<string, string | null>>;
    failureMessage?: string;
  },
): Promise<void> {
  await prisma.exportRun.update({
    where: { id: runId },
    data: {
      status: payload.status,
      requests: payload.requests,
      durationMs: payload.durationMs,
      finishedAt: new Date(),
      failureMessage: payload.failureMessage ?? null,
    },
  });

  for (const stat of payload.stats) {
    await prisma.exportStat.upsert({
      where: { runId_group: { runId, group: stat.group } },
      create: {
        runId,
        group: stat.group,
        fetched: stat.fetched,
        written: stat.written,
        removed: stat.removed,
      },
      update: { fetched: stat.fetched, written: stat.written, removed: stat.removed },
    });
  }

  for (const error of payload.errors) {
    await prisma.exportError.create({
      data: {
        runId,
        group: error.group,
        action: error.action,
        hotresId: error.hotresId ?? null,
        lang: error.lang ?? null,
        message: error.message,
        soft: error.soft,
      },
    });
  }

  for (const [group, fields] of payload.unmapped) {
    for (const [field, value] of fields) {
      await prisma.unmappedField.upsert({
        where: { runId_group_field: { runId, group, field } },
        create: { runId, group, field, sample: value },
        update: { sample: value },
      });
    }
  }
}
