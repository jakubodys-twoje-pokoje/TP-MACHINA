/**
 * Faza pobierania: ściąga wszystkie wybrane endpointy do pamięci.
 *
 * Rozdzielenie pobierania od zapisu jest celowe - dopiero mając komplet danych
 * da się poukładać relacje (dodatek → cennik, pokój → standard) w jednym przebiegu.
 */

import { orderGroups, type GroupSpec } from './catalogue.js';
import { HotresError, type HotresClient } from './hotres.js';
import { toArray } from './coerce.js';

export interface RunError {
  group: string;
  action: string;
  hotresId?: string;
  lang?: string | null;
  message: string;
  soft: boolean;
}

export interface FetchedGroup {
  /** Payload listy per język; klucz '_' dla endpointów bez tłumaczeń. */
  byLang: Record<string, any>;
  /** Szczegóły: język → id → payload. */
  details: Record<string, Record<string, any>>;
  /** Czy lista pobrała się bez twardego błędu - warunek czyszczenia sierot. */
  ok: boolean;
}

export interface FetchOutcome {
  groups: Record<string, FetchedGroup>;
  errors: RunError[];
}

export type ProgressLevel = 'info' | 'ok' | 'warn' | 'error';

export interface ProgressEvent {
  completed: number;
  total: number;
  message: string;
  level: ProgressLevel;
}

export interface FetchOptions {
  client: HotresClient;
  langs: string[];
  groups: string[];
  withDetails: boolean;
  onProgress?: (event: ProgressEvent) => void;
  signal?: { aborted: boolean };
}

export async function fetchAll(options: FetchOptions): Promise<FetchOutcome> {
  const { client, langs, groups, withDetails, onProgress, signal } = options;

  const selected: GroupSpec[] = orderGroups(groups);
  const result: Record<string, FetchedGroup> = {};
  const errors: RunError[] = [];

  let completed = 0;
  let total = selected.reduce((sum, group) => sum + (group.lang ? langs.length : 1), 0);

  const report = (message: string, level: ProgressLevel = 'info') =>
    onProgress?.({ completed, total, message, level });

  const ensureAlive = () => {
    if (signal?.aborted) throw new Error('Eksport przerwany');
  };

  for (const group of selected) {
    ensureAlive();

    const entry: FetchedGroup = { byLang: {}, details: {}, ok: true };
    result[group.key] = entry;

    const groupLangs: (string | null)[] = group.lang ? langs : [null];
    const detailIds = new Set<string>();

    for (const lang of groupLangs) {
      const params = { ...(group.params ?? {}) };
      if (lang) params.lang = lang;

      try {
        const payload = await client.get(group.action, params);
        entry.byLang[lang ?? '_'] = payload;

        if (group.detail) {
          for (const item of toArray(payload)) {
            const id = item?.[group.detail.idField];
            if (id !== undefined && id !== null) detailIds.add(String(id));
          }
        }

        completed++;
        report(`${group.label}${lang ? ` [${lang}]` : ''}: ${toArray(payload).length} poz.`, 'ok');
      } catch (error: any) {
        ensureAlive();
        completed++;
        entry.ok = false;
        const soft = Boolean(group.optional);
        errors.push({
          group: group.key,
          action: group.action,
          lang,
          message: error.message ?? String(error),
          soft,
        });
        report(
          `${group.label}${lang ? ` [${lang}]` : ''}: ${error.message}`,
          soft ? 'warn' : 'error',
        );
      }
    }

    if (!group.detail || !withDetails || detailIds.size === 0) continue;

    const detail = group.detail;
    const detailLangs: (string | null)[] = detail.lang ? langs : [null];
    total += detailIds.size * detailLangs.length;
    report(`${detail.label}: ${detailIds.size} × ${detailLangs.length} jęz.`);

    for (const lang of detailLangs) {
      const langKey = lang ?? '_';
      entry.details[langKey] ??= {};

      for (const id of detailIds) {
        ensureAlive();
        const params: Record<string, string | number> = { [detail.param]: id };
        if (lang) params.lang = lang;

        try {
          entry.details[langKey][id] = await client.get(detail.action, params);
          completed++;
          report(`${detail.label} ${id}${lang ? ` [${lang}]` : ''}`, 'ok');
        } catch (error: any) {
          ensureAlive();
          completed++;
          // 404 na pojedynczym elemencie zdarza się normalnie - Hotres potrafi
          // trzymać na liście pozycję, której szczegóły już nie istnieją.
          const soft =
            error instanceof HotresError ? error.status === 404 : false;
          errors.push({
            group: detail.key,
            action: detail.action,
            hotresId: id,
            lang,
            message: error.message ?? String(error),
            soft,
          });
          report(`${detail.label} ${id}: ${error.message}`, soft ? 'warn' : 'error');
        }
      }
    }
  }

  return { groups: result, errors };
}

/** Payload listy dla danego języka, z fallbackiem na pierwszy dostępny. */
export function pickLang(group: FetchedGroup | undefined, lang: string | null): any {
  if (!group) return undefined;
  if (lang === null) return group.byLang._;
  if (group.byLang[lang] !== undefined) return group.byLang[lang];
  const first = Object.keys(group.byLang)[0];
  return first === undefined ? undefined : group.byLang[first];
}

/** Szczegóły elementu dla danego języka, z fallbackiem na pierwszy dostępny. */
export function pickDetail(
  group: FetchedGroup | undefined,
  lang: string | null,
  id: string,
): any {
  if (!group) return undefined;
  const langKey = lang ?? '_';
  if (group.details[langKey]?.[id] !== undefined) return group.details[langKey][id];
  for (const key of Object.keys(group.details)) {
    if (group.details[key][id] !== undefined) return group.details[key][id];
  }
  return undefined;
}
