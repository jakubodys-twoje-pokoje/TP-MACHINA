/**
 * Kroki przepisywania obiektu do nowego PMS.
 *
 * Kolejność = kolejność pracy człowieka, a nie kolejność importu. Świadomie nie
 * ma tu opinii, użytkowników, parametrów ani słowników - to dane referencyjne,
 * których się nie przepisuje ręcznie.
 */

export interface MigrationStepSpec {
  key: string;
  label: string;
  /** Pole z licznika rekordów, po którym poznajemy, czy jest co przepisywać. */
  countKey: string | null;
}

export const MIGRATION_STEPS: MigrationStepSpec[] = [
  { key: 'object', label: 'Dane i opisy obiektu', countKey: null },
  { key: 'roomTypes', label: 'Standardy', countKey: 'roomTypes' },
  { key: 'rooms', label: 'Pokoje', countKey: 'rooms' },
  { key: 'rates', label: 'Cenniki', countKey: 'ratePlans' },
  { key: 'addons', label: 'Dodatki', countKey: 'addons' },
  { key: 'vouchers', label: 'Vouchery', countKey: 'vouchers' },
  { key: 'tickets', label: 'Bilety', countKey: 'tickets' },
  { key: 'informator', label: 'Informator', countKey: 'informator' },
];

export const MIGRATION_STEP_KEYS = MIGRATION_STEPS.map(step => step.key);

export interface ResolvedStep {
  key: string;
  label: string;
  /** Ile rekordów jest do przepisania (null = krok bezilościowy, np. obiekt). */
  total: number | null;
  /** Odhaczone ręcznie. */
  checked: boolean;
  /** Zrobione: odhaczone albo pusta sekcja (nie ma czego przepisywać). */
  done: boolean;
  /** Zaliczone automatycznie, bo sekcja jest pusta. */
  auto: boolean;
}

/**
 * Składa stan kroków z tego, co odhaczył człowiek, i z tego, ile danych
 * faktycznie jest w bazie.
 */
export function resolveSteps(
  counts: Record<string, number>,
  checked: Record<string, boolean>,
): { steps: ResolvedStep[]; percent: number; doneCount: number } {
  const steps = MIGRATION_STEPS.map(spec => {
    const total = spec.countKey ? counts[spec.countKey] ?? 0 : null;
    const auto = total === 0;
    const isChecked = Boolean(checked[spec.key]);
    return {
      key: spec.key,
      label: spec.label,
      total,
      checked: isChecked,
      done: isChecked || auto,
      auto,
    };
  });

  const doneCount = steps.filter(step => step.done).length;
  return {
    steps,
    doneCount,
    percent: steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100),
  };
}
