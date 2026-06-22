import { describe, it, expect } from 'vitest';
import { resolveConfig, DEFAULT_CONFIG } from './resolveConfig.ts';
import type { GapConfigRow } from './types.ts';

const base: Omit<GapConfigRow, 'standard_min_los'> = {
  property_id: null, unit_id: null, unit_type: null, season: null, channel: null,
  date_from: null, date_to: null,
  min_acceptable_gap: 3, emergency_acceptable_gap: 2, max_los: null,
  last_minute_lead_days: 7, emergency_mode: false, allow_shorten_min_los: true,
  horizon_days: 365, priority: 0,
};
const row = (over: Partial<GapConfigRow> & { standard_min_los: number }): GapConfigRow => ({ ...base, ...over });

describe('resolveConfig', () => {
  it('returns DEFAULT_CONFIG when nothing matches', () => {
    expect(resolveConfig({ propertyId: 'P1' }, [])).toEqual(DEFAULT_CONFIG);
  });

  it('global default row applies to any context', () => {
    const cfg = resolveConfig({ propertyId: 'P1' }, [row({ standard_min_los: 4 })]);
    expect(cfg.standardMinLos).toBe(4);
  });

  it('most specific scope wins (unit over property over global)', () => {
    const cfgs = [
      row({ standard_min_los: 2 }),                               // global
      row({ standard_min_los: 3, property_id: 'P1' }),            // property
      row({ standard_min_los: 5, property_id: 'P1', unit_id: 'U1' }), // unit
    ];
    expect(resolveConfig({ propertyId: 'P1', unitId: 'U1' }, cfgs).standardMinLos).toBe(5);
    expect(resolveConfig({ propertyId: 'P1', unitId: 'U2' }, cfgs).standardMinLos).toBe(3);
    expect(resolveConfig({ propertyId: 'P9', unitId: 'U9' }, cfgs).standardMinLos).toBe(2);
  });

  it('season scope is honored', () => {
    const cfgs = [
      row({ standard_min_los: 2 }),
      row({ standard_min_los: 4, season: 'high' }),
    ];
    expect(resolveConfig({ season: 'high' }, cfgs).standardMinLos).toBe(4);
    expect(resolveConfig({ season: 'low' }, cfgs).standardMinLos).toBe(2);
  });

  it('date range scope is honored', () => {
    const cfgs = [
      row({ standard_min_los: 2 }),
      row({ standard_min_los: 7, date_from: '2026-07-01', date_to: '2026-08-31' }),
    ];
    expect(resolveConfig({ date: '2026-07-15' }, cfgs).standardMinLos).toBe(7);
    expect(resolveConfig({ date: '2026-09-15' }, cfgs).standardMinLos).toBe(2);
  });

  it('ties break by priority', () => {
    const cfgs = [
      row({ standard_min_los: 3, season: 'high', priority: 1 }),
      row({ standard_min_los: 9, channel: 'direct', priority: 5 }),
    ];
    // both equally specific (1 scope field); higher priority wins
    expect(resolveConfig({ season: 'high', channel: 'direct' }, cfgs).standardMinLos).toBe(9);
  });
});
