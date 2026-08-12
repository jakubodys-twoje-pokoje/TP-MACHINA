/**
 * Hotres zwraca wszystko jako stringi ("0", "1", "", "2025-12-04", null),
 * a schemat jest typowany. Tu jest cała robota z rzutowaniem.
 */

export function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Zachowuje pusty string jako pusty string - dla pól, gdzie "" znaczy "wyczyszczone". */
export function rawStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return null;
  return String(value);
}

export function int(value: unknown): number | null {
  const text = str(value);
  if (text === null) return null;
  const parsed = parseInt(text, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function float(value: unknown): number | null {
  const text = str(value);
  if (text === null) return null;
  const parsed = parseFloat(text.replace(',', '.'));
  return Number.isNaN(parsed) ? null : parsed;
}

export function bool(value: unknown): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (text === '') return null;
  if (['1', 'true', 'yes', 'tak'].includes(text)) return true;
  if (['0', 'false', 'no', 'nie'].includes(text)) return false;
  return null;
}

/**
 * Daty z Hotres przychodzą jako "YYYY-MM-DD" albo "YYYY-MM-DD HH:MM:SS",
 * czasem jako zera ("0000-00-00") oznaczające brak.
 */
export function date(value: unknown): Date | null {
  const text = str(value);
  if (text === null) return null;
  if (/^0{4}-0{2}-0{2}/.test(text)) return null;

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const parsed = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "22,7,73" → ['22','7','73']; obsługuje też gotowe tablice z API. */
export function csv(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  const text = str(value);
  if (text === null) return [];
  return text.split(',').map(item => item.trim()).filter(Boolean);
}

/** Hotres bywa niekonsekwentny: raz tablica, raz pojedynczy obiekt, raz null. */
export function toArray<T = any>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') return [payload as T];
  return [];
}

/**
 * Zwraca klucze obecne w odpowiedzi, których schemat nie zna.
 *
 * Przy pełnej normalizacji to jedyny sposób, żeby zmiana po stronie Hotres
 * nie zniknęła po cichu - nieznane pola trafiają do tabeli UnmappedField.
 */
export function unknownKeys(payload: any, known: Set<string>): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return Object.keys(payload).filter(key => !known.has(key));
}

/** Skrócona próbka wartości - do zapisania obok nieznanego pola. */
export function sample(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * Normalizuje identyfikator obiektu.
 *
 * OID-y bywają wklejane z list i potrafią przyjechać ze spacją, tabulatorem
 * albo znakiem końca linii. Bez tego eksport zapisywał obiekt pod przyciętym
 * OID-em, a GUI pytało potem o wersję ze spacją i dostawało 404 - czyli
 * "pobrałem, a danych nie ma".
 */
export function normalizeOid(value: unknown): string {
  return String(value ?? '').trim();
}
