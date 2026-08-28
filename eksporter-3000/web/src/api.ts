/**
 * Klient serwisu Eksporter 3000.
 *
 * Wszystko leci pod ten sam origin, z ciasteczkiem sesji - GUI jest serwowane
 * przez ten sam proces co API.
 */

export class NotAuthorized extends Error {
  constructor() {
    super('Sesja wygasła - zaloguj się ponownie');
    this.name = 'NotAuthorized';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init });

  if (response.status === 401) throw new NotAuthorized();
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

// --- sesja ----------------------------------------------------------------

export const me = () => request<{ user: string }>('/api/me');

export const login = (user: string, password: string) =>
  request<{ ok: true; user: string }>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, password }),
  });

export const logout = () => request<{ ok: true }>('/api/logout', { method: 'POST' });

// --- dane -----------------------------------------------------------------

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

export interface PropertyRow {
  id: number;
  oid: string;
  /** Etykieta złożona przez serwis - Hotres nie ma pola z nazwą obiektu. */
  label: string;
  identifier: string | null;
  companyName: string | null;
  city: string | null;
  email: string | null;
  updatedAt: string;
  _count: {
    roomTypes: number; rooms: number; ratePlans: number;
    addons: number; reviews: number; definitions: number; importFiles: number;
  };
  lastRun: { status: string; startedAt: string; requests: number } | null;

  /** Postęp przepisywania - dane nasze, nie z Hotresa. */
  migrationStatus: MigrationStatus;
  migrationNote: string | null;
  migrationUpdatedAt: string | null;
  migrationUpdatedBy: string | null;
  migrationSteps: MigrationStepState[];
  migrationPercent: number;
  migrationDoneCount: number;
  migrationStepCount: number;
}

export interface MigrationStepState {
  key: string;
  label: string;
  /** Ile rekordów jest do przepisania; null = krok bezilościowy (obiekt). */
  total: number | null;
  checked: boolean;
  done: boolean;
  /** Zaliczony automatycznie, bo sekcja jest pusta. */
  auto: boolean;
}

export type MigrationStatus = 'todo' | 'in_progress' | 'done' | 'skipped';

export const MIGRATION_LABELS: Record<MigrationStatus, string> = {
  todo: 'Do zrobienia',
  in_progress: 'W trakcie',
  done: 'Przepisane',
  skipped: 'Pomijamy',
};

export const setMigrationStep = (oid: string, step: string, done: boolean) =>
  request<{ ok: true }>(`/api/properties/${encodeURIComponent(oid)}/migration/step`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step, done }),
  });

export const setMigration = (oid: string, patch: { status?: MigrationStatus; note?: string }) =>
  request<{ oid: string }>(`/api/properties/${encodeURIComponent(oid)}/migration`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

export const getCatalogue = () => request<Catalogue>('/api/catalogue');
export const getProperties = () => request<PropertyRow[]>('/api/properties');
export const getPropertyData = (oid: string) =>
  request<any>(`/api/properties/${encodeURIComponent(oid)}/data`);
export const getRuns = (oid: string) =>
  request<any[]>(`/api/runs?oid=${encodeURIComponent(oid)}&limit=20`);

export const exportJsonUrl = (oid: string) =>
  `/api/properties/${encodeURIComponent(oid)}/export.json`;

/** ZIP ze zdjęciami - całego obiektu albo pojedynczej galerii. */
export const photosZipUrl = (
  oid: string,
  scope?: { roomType?: string; ratePlan?: string },
) => {
  const params = new URLSearchParams();
  if (scope?.roomType) params.set('roomType', scope.roomType);
  if (scope?.ratePlan) params.set('ratePlan', scope.ratePlan);
  const query = params.toString();
  return `/api/properties/${encodeURIComponent(oid)}/photos.zip${query ? `?${query}` : ''}`;
};

// --- pliki importu --------------------------------------------------------

export interface ImportFile {
  id: number;
  filename: string;
  mimeType: string | null;
  size: number;
  note: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
}

export const getFiles = (oid: string) =>
  request<ImportFile[]>(`/api/properties/${encodeURIComponent(oid)}/files`);

export const fileDownloadUrl = (id: number) => `/api/files/${id}/download`;

export const setFileNote = (id: number, note: string) =>
  request<ImportFile>(`/api/files/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });

export const deleteFile = (id: number) =>
  request<{ ok: true }>(`/api/files/${id}`, { method: 'DELETE' });

/** Wysyłka wieloczęściowa - Content-Type ustawia przeglądarka razem z boundary. */
export async function uploadFiles(oid: string, files: File[]): Promise<ImportFile[]> {
  const form = new FormData();
  for (const file of files) form.append('files', file);

  const response = await fetch(`/api/properties/${encodeURIComponent(oid)}/files`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });

  if (response.status === 401) throw new NotAuthorized();
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<ImportFile[]>;
}

// --- eksport (strumień NDJSON) -------------------------------------------

export type ProgressLevel = 'info' | 'ok' | 'warn' | 'error';

export interface ProgressEvent {
  type: 'progress';
  completed: number;
  total: number;
  message: string;
  level: ProgressLevel;
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
  errors: {
    group: string;
    action: string;
    hotresId?: string;
    lang?: string | null;
    message: string;
    soft: boolean;
  }[];
  unmapped: { group: string; field: string; sample: string | null }[];
}

export type ExportEvent =
  | ProgressEvent
  | { type: 'done'; summary: RunSummary; counts: Record<string, number> }
  | { type: 'error'; message: string };

export interface ExportRequest {
  oid: string;
  langs: string[];
  groups: string[];
  withDetails: boolean;
  delayMs: number;
}

export async function* streamExport(
  payload: ExportRequest,
  signal?: AbortSignal,
): AsyncGenerator<ExportEvent> {
  const response = await fetch('/api/export', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  if (response.status === 401) throw new NotAuthorized();
  if (!response.ok || !response.body) throw new Error(`Serwis odpowiedział HTTP ${response.status}`);

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
        if (trimmed) yield JSON.parse(trimmed) as ExportEvent;
      }
    }
    const rest = buffer.trim();
    if (rest) yield JSON.parse(rest) as ExportEvent;
  } finally {
    reader.releaseLock();
  }
}
