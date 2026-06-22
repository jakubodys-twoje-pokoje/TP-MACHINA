import { describe, it, expect } from 'vitest';
import { buildGaps } from './buildGaps.ts';
import type { AvailabilityRow } from './types.ts';

const rows = (entries: [string, string][]): AvailabilityRow[] =>
  entries.map(([date, status]) => ({ date, status }));

describe('buildGaps', () => {
  it('finds a single gap bounded by booked days', () => {
    const gaps = buildGaps({
      unitId: 'U1',
      todayISO: '2026-07-01',
      horizonISO: '2026-07-10',
      rows: rows([
        ['2026-07-01', 'booked'],
        ['2026-07-02', 'available'],
        ['2026-07-03', 'available'],
        ['2026-07-04', 'available'],
        ['2026-07-05', 'booked'],
      ]),
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ startDate: '2026-07-02', length: 3, gapId: 'U1:2026-07-02' });
    expect(gaps[0].leadDays).toBe(1);
  });

  it('a gap starting today has leadDays 0', () => {
    const gaps = buildGaps({
      unitId: 'U1', todayISO: '2026-07-01', horizonISO: '2026-07-03',
      rows: rows([['2026-07-01', 'available'], ['2026-07-02', 'available'], ['2026-07-03', 'booked']]),
    });
    expect(gaps[0].leadDays).toBe(0);
    expect(gaps[0].length).toBe(2);
  });

  it('splits two gaps separated by a single booked night', () => {
    const gaps = buildGaps({
      unitId: 'U1', todayISO: '2026-07-01', horizonISO: '2026-07-06',
      rows: rows([
        ['2026-07-01', 'available'], ['2026-07-02', 'available'],
        ['2026-07-03', 'booked'],
        ['2026-07-04', 'available'], ['2026-07-05', 'available'], ['2026-07-06', 'available'],
      ]),
    });
    expect(gaps.map(g => [g.startDate, g.length])).toEqual([['2026-07-01', 2], ['2026-07-04', 3]]);
  });

  it('blocked and missing dates are both boundaries', () => {
    const gaps = buildGaps({
      unitId: 'U1', todayISO: '2026-07-01', horizonISO: '2026-07-05',
      rows: rows([
        ['2026-07-01', 'available'],
        ['2026-07-02', 'blocked'],
        // 2026-07-03 missing
        ['2026-07-04', 'available'], ['2026-07-05', 'available'],
      ]),
    });
    expect(gaps.map(g => [g.startDate, g.length])).toEqual([['2026-07-01', 1], ['2026-07-04', 2]]);
  });

  it('a gap open at the horizon end is included up to horizon', () => {
    const gaps = buildGaps({
      unitId: 'U1', todayISO: '2026-07-01', horizonISO: '2026-07-03',
      rows: rows([['2026-07-01', 'booked'], ['2026-07-02', 'available'], ['2026-07-03', 'available']]),
    });
    expect(gaps).toEqual([{ gapId: 'U1:2026-07-02', unitId: 'U1', startDate: '2026-07-02', length: 2, leadDays: 1 }]);
  });

  it('no availability yields no gaps', () => {
    expect(buildGaps({ unitId: 'U1', todayISO: '2026-07-01', horizonISO: '2026-07-03', rows: rows([['2026-07-01', 'booked']]) })).toEqual([]);
  });
});
