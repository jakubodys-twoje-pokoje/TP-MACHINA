import { describe, it, expect } from 'vitest';
import { computeGapRestrictions } from './gapEngine.ts';
import { addDays } from './dates.ts';
import type { Gap, GapEngineConfig } from './types.ts';

const DEFAULT_CFG: GapEngineConfig = {
  standardMinLos: 3,
  minAcceptableGap: 3,
  emergencyAcceptableGap: 3,
  maxLos: null,
  lastMinuteLeadDays: 0,
  emergencyMode: false,
  allowShortenMinLos: false,
};

const START = '2026-07-01';
const gap = (length: number, leadDays = 90): Gap => ({ gapId: 'G', unitId: 'U1', startDate: START, length, leadDays });
const sig = (rows: { cta: number; ctd: number; minLos: number | null }[]) =>
  rows.map(r => `${r.cta}/${r.ctd}/${r.minLos ?? '-'}`).join(' ');

describe('Gap Protection Engine — 10 mandatory cases', () => {
  it('T1  L=5, minLOS=3, minGap=3 → forced full 5', () => {
    expect(sig(computeGapRestrictions(gap(5), DEFAULT_CFG))).toBe('0/0/5 1/1/3 1/1/3 1/1/3 1/1/3');
  });

  it('T2  L=7, minLOS=3, minGap=3 → rich split', () => {
    expect(sig(computeGapRestrictions(gap(7), DEFAULT_CFG))).toBe('0/0/3 1/1/3 1/1/3 0/0/4 0/0/3 1/1/3 1/1/3');
  });

  it('T3  L=3, minLOS=6, emergency → shorten to single 3-night', () => {
    const rows = computeGapRestrictions(gap(3), {
      ...DEFAULT_CFG, standardMinLos: 6, emergencyAcceptableGap: 3, emergencyMode: true, allowShortenMinLos: true,
    });
    expect(sig(rows)).toBe('0/0/3 1/1/3 1/1/3');
    expect(rows[0].confidence).toBe(0.6);
  });

  it('T3b L=3, minLOS=6, NO emergency → unsellable closed', () => {
    const rows = computeGapRestrictions(gap(3), { ...DEFAULT_CFG, standardMinLos: 6 });
    expect(sig(rows)).toBe('1/0/6 1/1/6 1/1/6');
    expect(rows.every(r => r.confidence === 0.3)).toBe(true);
    expect(rows[0].reason).toBe('gap_unsellable_below_min_los');
  });

  it('T4  L=6 → reservation leaving 1 night on the RIGHT is blocked', () => {
    const rows = computeGapRestrictions(gap(6), DEFAULT_CFG);
    expect(sig(rows)).toBe('0/0/3 1/1/3 1/1/3 0/0/3 1/1/3 1/1/3');
    expect(rows[5].ctd).toBe(1); // right leftover 1
    expect(rows[4].ctd).toBe(1); // right leftover 2
  });

  it('T5  L=6 → reservation leaving 1 night on the LEFT is blocked', () => {
    const rows = computeGapRestrictions(gap(6), DEFAULT_CFG);
    expect(rows[1].cta).toBe(1); // left leftover 1
    expect(rows[2].cta).toBe(1); // left leftover 2
    expect(rows[3].cta).toBe(0); // leaves sellable 3 on the left
  });

  it('T6  L=4, minLOS=4 → fills whole gap', () => {
    expect(sig(computeGapRestrictions(gap(4), { ...DEFAULT_CFG, standardMinLos: 4 }))).toBe('0/0/4 1/1/4 1/1/4 1/1/4');
  });

  it('T7  L=8, minLOS=4, minGap=4 → valid 4+4 split', () => {
    const rows = computeGapRestrictions(gap(8), { ...DEFAULT_CFG, standardMinLos: 4, minAcceptableGap: 4, emergencyAcceptableGap: 4 });
    expect(sig(rows)).toBe('0/0/4 1/1/4 1/1/4 1/1/4 0/0/4 1/1/4 1/1/4 1/1/4');
    expect(rows[0].cta).toBe(0);
    expect(rows[4].cta).toBe(0);
  });

  it('T8  L=5, minLOS=2, minGap=3 → invalid split refused', () => {
    const rows = computeGapRestrictions(gap(5), { ...DEFAULT_CFG, standardMinLos: 2 });
    expect(sig(rows)).toBe('0/0/2 1/1/2 1/0/2 0/1/2 1/1/2');
    expect(rows[2].cta).toBe(1); // arrival here strands 1 night left
    expect(rows[1].ctd).toBe(1); // checkout here strands < gapFloor right
    expect(rows[0].minLos).toBe(2);
  });

  it('T9  manual override wins on a date, rest stays auto', () => {
    const rows = computeGapRestrictions(gap(7), DEFAULT_CFG, [
      { date: addDays(START, 5), cta: 0, ctd: 0, minLos: 2, reason: 'operator_last_minute' },
    ]);
    expect(rows[5].cta).toBe(0);
    expect(rows[5].ctd).toBe(0);
    expect(rows[5].minLos).toBe(2);
    expect(rows[5].source).toBe('manual');
    expect(rows[5].confidence).toBe(1);
    expect(rows[5].reason).toBe('operator_last_minute');
    expect(rows[1].source).toBe('auto');
  });

  it('T10 season high vs low on the SAME gap differs', () => {
    const high = computeGapRestrictions(gap(6), { ...DEFAULT_CFG, standardMinLos: 4, minAcceptableGap: 3, emergencyAcceptableGap: 3 });
    const low = computeGapRestrictions(gap(6), { ...DEFAULT_CFG, standardMinLos: 2, minAcceptableGap: 2, emergencyAcceptableGap: 2 });
    expect(sig(high)).toBe('0/0/6 1/1/4 1/1/4 1/1/4 1/1/4 1/1/4');
    expect(sig(low)).toBe('0/0/2 1/1/2 0/0/2 0/0/3 0/0/2 1/1/2');
    expect(sig(high)).not.toBe(sig(low));
  });
});

describe('Gap Protection Engine — invariants', () => {
  it('every output row maps to a date inside the gap', () => {
    const rows = computeGapRestrictions(gap(7), DEFAULT_CFG);
    expect(rows.length).toBe(7);
    expect(rows[0].date).toBe(START);
    expect(rows[6].date).toBe(addDays(START, 6));
  });

  it('zero-length gap yields no rows', () => {
    expect(computeGapRestrictions(gap(0), DEFAULT_CFG)).toEqual([]);
  });

  it('day 0 CTD is always open (prior guest checkout boundary)', () => {
    expect(computeGapRestrictions(gap(5), DEFAULT_CFG)[0].ctd).toBe(0);
  });
});
