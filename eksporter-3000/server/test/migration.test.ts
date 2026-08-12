import { describe, it, expect } from 'vitest';
import { MIGRATION_STEPS, resolveSteps } from '../src/migration.js';

describe('kumulatywny postęp przepisywania', () => {
  const counts = { roomTypes: 40, rooms: 40, ratePlans: 8, addons: 9, vouchers: 0, tickets: 0, informator: 0 };

  it('sekcje bez danych liczą się jako zrobione automatycznie', () => {
    const { steps, percent } = resolveSteps(counts, {});

    const vouchers = steps.find(step => step.key === 'vouchers')!;
    expect(vouchers.auto).toBe(true);
    expect(vouchers.done).toBe(true);

    const roomTypes = steps.find(step => step.key === 'roomTypes')!;
    expect(roomTypes.auto).toBe(false);
    expect(roomTypes.done).toBe(false);

    // 3 puste sekcje z 8 = 38%
    expect(percent).toBe(38);
  });

  it('odhaczenie sekcji podbija procent', () => {
    const { percent } = resolveSteps(counts, { roomTypes: true, rooms: true });
    expect(percent).toBe(63);
  });

  it('komplet odhaczeń to 100%', () => {
    const all = Object.fromEntries(MIGRATION_STEPS.map(step => [step.key, true]));
    const { percent, doneCount } = resolveSteps(counts, all);
    expect(percent).toBe(100);
    expect(doneCount).toBe(MIGRATION_STEPS.length);
  });

  it('gdy sekcja dostanie dane, przestaje być zaliczona automatycznie', () => {
    const pusty = resolveSteps({ ...counts, vouchers: 0 }, {});
    expect(pusty.steps.find(step => step.key === 'vouchers')!.done).toBe(true);

    const zDanymi = resolveSteps({ ...counts, vouchers: 3 }, {});
    expect(zDanymi.steps.find(step => step.key === 'vouchers')!.done).toBe(false);
    expect(zDanymi.percent).toBeLessThan(pusty.percent);
  });

  it('obiekt jest krokiem bez licznika - nigdy nie zalicza się sam', () => {
    const { steps } = resolveSteps(counts, {});
    const object = steps.find(step => step.key === 'object')!;
    expect(object.total).toBeNull();
    expect(object.auto).toBe(false);
    expect(object.done).toBe(false);
  });
});
