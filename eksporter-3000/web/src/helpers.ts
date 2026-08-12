/** Drobiazgi wspólne dla widoków. */

/** Nazwa rekordu z tłumaczeń - bierzemy pierwszą niepustą. */
export function titleOf(entity: any, fallbackPrefix = '#'): string {
  const translations: any[] = entity?.translations ?? [];
  for (const translation of translations) {
    if (translation?.title) return translation.title;
  }
  return `${fallbackPrefix}${entity?.hotresId ?? '?'}`;
}

/** Wyszukiwanie odporne na polskie znaki: „sloneczny" znajdzie „Słoneczny". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

export function matches(value: unknown, query: string): boolean {
  if (!query.trim()) return true;
  if (value === null || value === undefined) return false;
  return normalize(String(value)).includes(normalize(query.trim()));
}

/**
 * Legenda id → nazwa dla wskazanego słownika.
 *
 * Bez niej pole `facilities: "22,7,73"` przy standardzie jest nie do odczytania,
 * a to jest dokładnie to, co użytkownik musi przepisać do nowego PMS-a.
 */
export function buildDefinitionMap(
  definitions: any[],
  dictionary = 'facilities',
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of definitions ?? []) {
    if (entry?.dictionary === dictionary && entry?.hotresId) {
      // Kraje trzymają nazwę w `name`, a w `code` skrót typu POL.
      map.set(String(entry.hotresId), entry.name || entry.code || '');
    }
  }
  return map;
}

/** Nazwy słowników obecnych w danych, np. ['facilities']. */
export function dictionaryNames(definitions: any[]): string[] {
  return [...new Set((definitions ?? []).map(entry => entry.dictionary))].sort();
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
