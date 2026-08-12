/**
 * Klient lokalnego serwisu "Eksporter 3000" (katalog `server/`).
 *
 * Machina nie rozmawia już z Hotresem bezpośrednio: pobieranie i zapis do bazy
 * Prisma dzieją się po stronie serwisu, a przeglądarka tylko steruje i słucha
 * postępu. Dzięki temu poświadczenia Hotres siedzą w .env serwisu, a nie w bundlu.
 */

const DEFAULT_API = 'http://localhost:4000';

export const API_BASE: string =
  ((import.meta as any).env?.VITE_EKSPORTER_API as string | undefined)?.replace(/\/$/, '') ??
  DEFAULT_API;

// ---------------------------------------------------------------------------
// typy
// ---------------------------------------------------------------------------

export interface CatalogueGroup {
  key: string;
  label: string;
  action: string;
  description: string;
  lang: boolean;
  optional: boolean;
  detailAction: string | null;
}

export interface Catalogue {
  groups: CatalogueGroup[];
  excluded: { action: string; reason: string }[];
  langs: string[];
}

export type ProgressLevel = 'info' | 'ok' | 'warn' | 'error';

export interface ProgressEvent {
  type: 'progress';
  completed: number;
  total: number;
  message: string;
  level: ProgressLevel;
}

export interface RunError {
  group: string;
  action: string;
  hotresId?: string;
  lang?: string | null;
  message: string;
  soft: boolean;
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

export type SnapshotCounts = Record<string, number>;

export interface DoneEvent {
  type: 'done';
  summary: RunSummary;
  counts: SnapshotCounts;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
}

export type ExportEvent = ProgressEvent | DoneEvent | ErrorEvent;

export interface Snapshot {
  property: {
    id: number;
    oid: string;
    city: string | null;
    email: string | null;
    currency: string | null;
    updatedAt: string;
  };
  counts: SnapshotCounts;
}

export interface RunRow {
  id: number;
  oid: string;
  status: string;
  langs: string;
  groups: string;
  requests: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  failureMessage: string | null;
  stats: { group: string; fetched: number; written: number; removed: number }[];
  _count: { errors: number; unmapped: number };
}

export interface ExportRequest {
  oid: string;
  langs: string[];
  groups: string[];
  withDetails: boolean;
  delayMs: number;
}

// ---------------------------------------------------------------------------
// zapytania
// ---------------------------------------------------------------------------

export class ServiceOfflineError extends Error {
  constructor() {
    super(
      `Nie widzę serwisu eksportera pod ${API_BASE}. ` +
        'Uruchom go: cd server && npm run dev',
    );
    this.name = 'ServiceOfflineError';
  }
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`);
  } catch {
    throw new ServiceOfflineError();
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function pingService(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export function fetchCatalogue(): Promise<Catalogue> {
  return getJson<Catalogue>('/api/catalogue');
}

/** Zwraca null, gdy obiekt nie był jeszcze eksportowany (404 to nie błąd). */
export async function fetchSnapshot(oid: string): Promise<Snapshot | null> {
  try {
    return await getJson<Snapshot>(`/api/properties/${encodeURIComponent(oid)}/snapshot`);
  } catch (error) {
    if (error instanceof ServiceOfflineError) throw error;
    return null;
  }
}

export async function fetchRuns(oid: string): Promise<RunRow[]> {
  try {
    return await getJson<RunRow[]>(`/api/runs?oid=${encodeURIComponent(oid)}&limit=10`);
  } catch (error) {
    if (error instanceof ServiceOfflineError) throw error;
    return [];
  }
}

/** Adres pełnego zrzutu obiektu z bazy - to plik do zassania przez nowy PMS. */
export function exportJsonUrl(oid: string): string {
  return `${API_BASE}/api/properties/${encodeURIComponent(oid)}/export.json`;
}

/**
 * Uruchamia eksport i wypuszcza zdarzenia w miarę ich napływania.
 *
 * Serwis streamuje NDJSON - jedna linia to jedno zdarzenie. Zerwanie połączenia
 * (abort) jest po stronie serwisu sygnałem do przerwania przebiegu.
 */
export async function* streamExport(
  request: ExportRequest,
  signal?: AbortSignal,
): AsyncGenerator<ExportEvent> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
    throw new ServiceOfflineError();
  }

  if (!response.ok || !response.body) {
    throw new Error(`Serwis odpowiedział HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Ostatni fragment może być niepełną linią - zostaje w buforze.
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        yield JSON.parse(trimmed) as ExportEvent;
      }
    }

    const rest = buffer.trim();
    if (rest) yield JSON.parse(rest) as ExportEvent;
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// etykiety
// ---------------------------------------------------------------------------

export const COUNT_LABELS: Record<string, string> = {
  roomTypes: 'Standardy',
  rooms: 'Pokoje',
  ratePlans: 'Cenniki',
  addons: 'Dodatki',
  vouchers: 'Vouchery',
  tickets: 'Bilety',
  reviews: 'Opinie',
  informator: 'Informator',
  users: 'Użytkownicy',
  params: 'Parametry',
  facilities: 'Udogodnienia',
  photos: 'Zdjęcia obiektu',
};

export function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
