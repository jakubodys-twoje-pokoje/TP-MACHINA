import { supabase } from './supabaseClient';

/**
 * Eksport WSZYSTKICH statycznych danych obiektu z Hotres.
 *
 * ZAKRES: konfiguracja obiektu, pokoje, standardy, dodatki, treści, słowniki -
 * czyli to, co jest potrzebne do przeniesienia obiektu na własny PMS.
 *
 * ŚWIADOMIE POMINIĘTE (dane dynamiczne / transakcyjne - ciągnięte osobno,
 * jednym eksportem, żeby nie palić limitu zapytań Hotres):
 *   api_availability, api_prices, api_blocks, api_reservations,
 *   api_reservationdetails, api_guests, api_payments, api_invoices, api_messages
 */

const PROXY_URL = 'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/hotres-proxy';
const HOTRES_BASE = 'https://panel.hotres.pl';

// Te same dane dostępowe, z których korzysta reszta aplikacji (PropertyContext,
// funkcje Edge). Trzymane w jednym miejscu, żeby nie mnożyć kopii.
const HOTRES_API_USER = 'admin@twojepokoje.com.pl';
const HOTRES_API_PASSWORD = 'Stinson@121';

export const HOTRES_LANGS = ['pl', 'en', 'de', 'cz', 'sk', 'ua', 'ru', 'fr', 'es', 'it'] as const;

// ---------------------------------------------------------------------------
// katalog endpointów
// ---------------------------------------------------------------------------

export interface HotresDetailSpec {
  key: string;
  label: string;
  action: string;
  /** Pole identyfikatora w elemencie listy nadrzędnej. */
  idField: string;
  /** Nazwa parametru zapytania dla identyfikatora. */
  param: string;
  lang: boolean;
}

export interface HotresGroupSpec {
  key: string;
  label: string;
  action: string;
  description: string;
  /** Endpoint przyjmuje parametr `lang` - pobieramy go dla każdego języka. */
  lang: boolean;
  /** Pusta odpowiedź / błąd nie jest traktowany jako problem eksportu. */
  optional?: boolean;
  params?: Record<string, string | number>;
  detail?: HotresDetailSpec;
}

export const HOTRES_GROUPS: HotresGroupSpec[] = [
  {
    key: 'object',
    label: 'Obiekt',
    action: 'api_object',
    description: 'Adres, kontakt, dane firmy, galeria, opis, regulamin, godziny doby hotelowej',
    lang: true,
  },
  {
    key: 'params',
    label: 'Parametry',
    action: 'api_params',
    description: 'Pełna konfiguracja obiektu (parametry be_*)',
    lang: false,
  },
  {
    key: 'definitions',
    label: 'Słowniki',
    action: 'api_definitions',
    description: 'Definicje i słowniki: udogodnienia, ikony, kategorie',
    lang: false,
  },
  {
    key: 'rooms',
    label: 'Pokoje fizyczne',
    action: 'api_rooms',
    description: 'Numery pokoi, łóżka, piętro, stan, pola własne',
    lang: false,
  },
  {
    key: 'roomstypes',
    label: 'Standardy / typy pokoi',
    action: 'api_roomstypes',
    description: 'Lista standardów wraz z metrażem, wyposażeniem i zdjęciem głównym',
    lang: true,
    detail: {
      key: 'roomtypes',
      label: 'Szczegóły standardów',
      action: 'api_roomtype',
      idField: 'type_id',
      param: 'type_id',
      lang: true,
    },
  },
  {
    key: 'rates',
    label: 'Plany cenowe (definicje)',
    action: 'api_rates',
    description: 'Metadane cenników: nazwa, wyżywienie, min/max pobyt. BEZ kalendarza cen',
    lang: true,
    detail: {
      key: 'rateDetails',
      label: 'Szczegóły planów cenowych',
      action: 'api_rate',
      idField: 'rate_id',
      param: 'rate_id',
      lang: true,
    },
  },
  {
    key: 'addons',
    label: 'Dodatki / upselling',
    action: 'api_addons',
    description: 'Dodatki wraz z cenami, stanami i regułami sprzedaży',
    lang: false,
  },
  {
    key: 'vouchers',
    label: 'Vouchery',
    action: 'api_vouchers',
    description: 'Vouchery prezentowe i ich opisy',
    lang: true,
    optional: true,
    detail: {
      key: 'voucherDetails',
      label: 'Szczegóły voucherów',
      action: 'api_voucher',
      idField: 'voucher_id',
      param: 'voucher_id',
      lang: true,
    },
  },
  {
    key: 'tickets',
    label: 'Bilety / wydarzenia',
    action: 'api_tickets',
    description: 'Bilety, wydarzenia, limity i stany',
    lang: true,
    optional: true,
    detail: {
      key: 'ticketDetails',
      label: 'Szczegóły biletów',
      action: 'api_ticket',
      idField: 'ticket_id',
      param: 'ticket_id',
      lang: true,
    },
  },
  {
    key: 'reviews',
    label: 'Opinie gości',
    action: 'api_reviews',
    description: 'Publiczne opinie (maks. 300)',
    lang: false,
    optional: true,
    params: { limit: 300 },
  },
  {
    key: 'informator',
    label: 'Informator',
    action: 'api_informator',
    description: 'Kafle informacyjne dla gości',
    lang: true,
    optional: true,
  },
  {
    key: 'users',
    label: 'Użytkownicy',
    action: 'api_users',
    description: 'Konta z dostępem do obiektu',
    lang: false,
    optional: true,
  },
];

export const HOTRES_EXCLUDED: { action: string; reason: string }[] = [
  { action: 'api_availability', reason: 'dostępność - dane dynamiczne' },
  { action: 'api_prices', reason: 'kalendarz cen - dane dynamiczne' },
  { action: 'api_blocks', reason: 'blokady terminów - dane dynamiczne' },
  { action: 'api_reservations', reason: 'rezerwacje - osobny eksport' },
  { action: 'api_guests', reason: 'dane gości - osobny eksport' },
  { action: 'api_payments', reason: 'płatności - osobny eksport' },
  { action: 'api_invoices', reason: 'faktury - osobny eksport' },
  { action: 'api_messages', reason: 'wiadomości - osobny eksport' },
];

// ---------------------------------------------------------------------------
// typy wyniku
// ---------------------------------------------------------------------------

export interface HotresExportError {
  group: string;
  action: string;
  id?: string;
  lang?: string | null;
  message: string;
  /** Błąd nieblokujący: endpoint opcjonalny albo 404 na pojedynczym elemencie. */
  soft: boolean;
}

/** Dane grupy: dla endpointów tłumaczonych mapa lang → payload, inaczej payload. */
export type HotresGroupData = any;

export interface HotresExportResult {
  oid: string;
  propertyName?: string;
  exported_at: string;
  langs: string[];
  groups: string[];
  withDetails: boolean;
  requests: number;
  duration_ms: number;
  counts: Record<string, number>;
  errors: HotresExportError[];
  excluded: typeof HOTRES_EXCLUDED;
  data: Record<string, HotresGroupData>;
}

export type HotresProgressLevel = 'info' | 'ok' | 'warn' | 'error';

export interface HotresProgress {
  /** Kolejny numer wykonanego kroku (zapytania). */
  completed: number;
  /** Szacowana liczba kroków - rośnie, gdy poznajemy liczbę elementów list. */
  total: number;
  message: string;
  level: HotresProgressLevel;
}

export interface HotresExportOptions {
  oid: string;
  propertyName?: string;
  langs?: string[];
  /** Klucze grup do pobrania. Domyślnie wszystkie. */
  groups?: string[];
  /** Czy dociągać szczegóły per element (api_roomtype, api_rate, ...). */
  withDetails?: boolean;
  /** Minimalny odstęp między zapytaniami [ms] - Hotres limituje zapytania/h. */
  delayMs?: number;
  onProgress?: (progress: HotresProgress) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// warstwa HTTP
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function buildHotresUrl(
  action: string,
  oid: string,
  params: Record<string, string | number> = {},
): string {
  const url = new URL(`/${action}`, HOTRES_BASE);
  url.searchParams.set('user', HOTRES_API_USER);
  url.searchParams.set('password', HOTRES_API_PASSWORD);
  url.searchParams.set('oid', oid);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Hotres bywa niekonsekwentny: raz tablica, raz pojedynczy obiekt, raz null. */
export function toArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return [payload];
  return [];
}

/** Hotres na błąd potrafi odpowiedzieć HTTP 200 z { result: 'error', message }. */
function extractApiError(payload: any): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const result = String(payload.result ?? '').toLowerCase();
  if (result === 'error' || result === 'failed') {
    return payload.message || payload.error || 'Hotres API error';
  }
  return null;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sesja wygasła - zaloguj się ponownie');

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url }),
    signal,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || json?.error) {
    throw new Error(json?.error || `HTTP ${response.status}`);
  }
  if (!json?.data) throw new Error('Pusta odpowiedź z Hotres');

  let parsed: any;
  try {
    parsed = JSON.parse(json.data);
  } catch {
    throw new Error(`Odpowiedź nie jest JSON-em: ${String(json.data).slice(0, 200)}`);
  }

  const apiError = extractApiError(parsed);
  if (apiError) throw new Error(apiError);

  return parsed;
}

// ---------------------------------------------------------------------------
// eksport
// ---------------------------------------------------------------------------

export async function runHotresExport(options: HotresExportOptions): Promise<HotresExportResult> {
  const {
    oid,
    propertyName,
    langs = ['pl'],
    groups,
    withDetails = true,
    delayMs = 350,
    onProgress,
    signal,
  } = options;

  if (!oid) throw new Error('Brak OID obiektu w Hotres');
  if (langs.length === 0) throw new Error('Wybierz co najmniej jeden język');

  const selected = HOTRES_GROUPS.filter(group => !groups || groups.includes(group.key));
  if (selected.length === 0) throw new Error('Wybierz co najmniej jedną grupę danych');

  const startedAt = Date.now();
  const data: Record<string, HotresGroupData> = {};
  const counts: Record<string, number> = {};
  const errors: HotresExportError[] = [];

  let requests = 0;
  let completed = 0;
  // Szacunek startowy: same listy. Rośnie, gdy poznamy liczbę elementów.
  let total = selected.reduce((sum, group) => sum + (group.lang ? langs.length : 1), 0);
  let lastRequestAt = 0;

  const report = (message: string, level: HotresProgressLevel = 'info') => {
    onProgress?.({ completed, total, message, level });
  };

  const ensureAlive = () => {
    if (signal?.aborted) throw new Error('Eksport przerwany');
  };

  const request = async (action: string, params: Record<string, string | number>) => {
    ensureAlive();
    const elapsed = Date.now() - lastRequestAt;
    if (lastRequestAt && elapsed < delayMs) await sleep(delayMs - elapsed);
    ensureAlive();
    lastRequestAt = Date.now();
    requests++;
    return fetchJson(buildHotresUrl(action, oid, params), signal);
  };

  report(`Start eksportu obiektu ${propertyName ? `${propertyName} ` : ''}(OID ${oid})`);

  for (const group of selected) {
    const groupLangs: (string | null)[] = group.lang ? langs : [null];
    const byLang: Record<string, any> = {};
    /** id → true; zbierane ze wszystkich języków, żeby nic nie umknęło. */
    const detailIds = new Map<string, true>();

    for (const lang of groupLangs) {
      const params = { ...(group.params || {}) };
      if (lang) params.lang = lang;

      try {
        const payload = await request(group.action, params);
        byLang[lang ?? '_'] = payload;

        if (group.detail) {
          for (const item of toArray(payload)) {
            const id = item?.[group.detail.idField];
            if (id !== undefined && id !== null) detailIds.set(String(id), true);
          }
        }

        completed++;
        report(
          `${group.label}${lang ? ` [${lang}]` : ''}: ${toArray(payload).length} poz.`,
          'ok',
        );
      } catch (error: any) {
        if (signal?.aborted) throw error;
        completed++;
        const soft = Boolean(group.optional);
        errors.push({
          group: group.key,
          action: group.action,
          lang,
          message: error.message || String(error),
          soft,
        });
        report(
          `${group.label}${lang ? ` [${lang}]` : ''}: ${error.message}`,
          soft ? 'warn' : 'error',
        );
      }
    }

    data[group.key] = group.lang ? byLang : byLang._;
    counts[group.key] = toArray(group.lang ? byLang[langs[0]] : byLang._).length;

    if (!group.detail || !withDetails || detailIds.size === 0) continue;

    // --- szczegóły per element -------------------------------------------
    const detail = group.detail;
    const detailLangs: (string | null)[] = detail.lang ? langs : [null];
    const detailsByLang: Record<string, Record<string, any>> = {};

    total += detailIds.size * detailLangs.length;
    report(`${detail.label}: ${detailIds.size} × ${detailLangs.length} jęz.`);

    for (const lang of detailLangs) {
      const langKey = lang ?? '_';
      detailsByLang[langKey] = {};

      for (const id of detailIds.keys()) {
        const params: Record<string, string | number> = { [detail.param]: id };
        if (lang) params.lang = lang;

        try {
          detailsByLang[langKey][id] = await request(detail.action, params);
          completed++;
          report(`${detail.label} ${id}${lang ? ` [${lang}]` : ''}`, 'ok');
        } catch (error: any) {
          if (signal?.aborted) throw error;
          completed++;
          // 404 na pojedynczym elemencie zdarza się w Hotres normalnie -
          // element bywa usunięty, a wciąż widoczny na liście.
          const soft = String(error.message || '').includes('404');
          errors.push({
            group: detail.key,
            action: detail.action,
            id,
            lang,
            message: error.message || String(error),
            soft,
          });
          report(`${detail.label} ${id}: ${error.message}`, soft ? 'warn' : 'error');
        }
      }
    }

    data[detail.key] = detail.lang ? detailsByLang : detailsByLang._;
    counts[detail.key] = Object.keys(
      detail.lang ? detailsByLang[langs[0]] || {} : detailsByLang._ || {},
    ).length;
  }

  const result: HotresExportResult = {
    oid,
    propertyName,
    exported_at: new Date().toISOString(),
    langs,
    groups: selected.map(group => group.key),
    withDetails,
    requests,
    duration_ms: Date.now() - startedAt,
    counts,
    errors,
    excluded: HOTRES_EXCLUDED,
    data,
  };

  const hard = errors.filter(error => !error.soft).length;
  report(
    `Gotowe: ${requests} zapytań, ${errors.length} błędów (${hard} istotnych)`,
    hard ? 'warn' : 'ok',
  );

  return result;
}

// ---------------------------------------------------------------------------
// pobieranie plików
// ---------------------------------------------------------------------------

export function downloadJson(filename: string, payload: any): void {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportFilename(result: HotresExportResult, suffix = 'all'): string {
  const stamp = result.exported_at.slice(0, 19).replace(/[:T]/g, '-');
  const name = (result.propertyName || 'hotres')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `hotres-${name}-${result.oid}-${suffix}-${stamp}.json`;
}

/** Etykieta grupy (także dla kluczy szczegółów) - do wyświetlania i nazw plików. */
export function groupLabel(key: string): string {
  const group = HOTRES_GROUPS.find(item => item.key === key);
  if (group) return group.label;
  const parent = HOTRES_GROUPS.find(item => item.detail?.key === key);
  return parent?.detail?.label ?? key;
}

export function groupAction(key: string): string {
  const group = HOTRES_GROUPS.find(item => item.key === key);
  if (group) return group.action;
  const parent = HOTRES_GROUPS.find(item => item.detail?.key === key);
  return parent?.detail?.action ?? key;
}
