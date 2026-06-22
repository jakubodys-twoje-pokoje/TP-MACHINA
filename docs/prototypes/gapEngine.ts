/**
 * Gap Protection Engine — PURE CORE PROTOTYPE (NOT integrated).
 * =============================================================
 * This file is intentionally standalone:
 *   - no imports from the application
 *   - no I/O (no Supabase, no fetch, no DB)
 *   - not wired into the Vite build
 *
 * It exists only to (a) pin down the deterministic algorithm and
 * (b) prove the 10 mandatory test cases. Run it directly:
 *
 *     npx tsx docs/prototypes/gapEngine.ts
 *
 * Convention (see docs/GAP_PROTECTION_ENGINE.md, "Model luki"):
 *   A gap is a maximal run of `available` NIGHTS bounded by booked/blocked
 *   days or by today / horizon end.
 *
 *   We use the BOUNDARY model that matches the spec's arithmetic exactly:
 *     - gap_start = earliest possible ARRIVAL date (= first free night)
 *     - gap_end   = latest possible DEPARTURE date (= morning after the last
 *                   free night = next booking's check-in, or horizon+1)
 *     - L (gap length, nights) = gap_end - gap_start
 *
 *   A stay is (arrival, departure) with departure - arrival = nights.
 *   Offsets from gap_start: arrival offset a in [0..L-1], departure offset
 *   d in [a+minLos .. L]. The night row written for offset p is
 *   addDays(gap_start, p), p in [0..L-1].
 *
 *   Spec invariant (verbatim mapping):
 *     left_remaining_gap  = arrival   - gap_start = a
 *     right_remaining_gap = gap_end   - departure = L - d
 *     A stay is acceptable iff:
 *       a === 0           OR a >= minimal_acceptable_gap   (left flush or sellable)
 *       (L - d) === 0     OR (L - d) >= minimal_acceptable_gap (right flush or sellable)
 *       (d - a) >= effective_min_los
 */

// ───────────────────────────────────────────────────────────── Types ──

export type Bool01 = 0 | 1;

/** One gap to evaluate. Pure positional data — no dependency on availability rows. */
export interface Gap {
  gapId: string;
  unitId: string;
  /** ISO date (YYYY-MM-DD) of the first free night = earliest arrival. */
  startDate: string;
  /** Gap length in nights (= gap_end - gap_start). */
  length: number;
  /** Nights between "today" and startDate. Drives last-minute mode. */
  leadDays: number;
}

/** Resolved config for ONE gap (season/channel/date-range already resolved upstream). */
export interface GapEngineConfig {
  /** Standard minimum length of stay (nights). */
  standardMinLos: number;
  /** Smallest empty remainder we may leave after a booking (nights). */
  minAcceptableGap: number;
  /** Relaxed remainder allowed in emergency/last-minute (nights). */
  emergencyAcceptableGap: number;
  /** Optional channel cap on stay length. null = no cap. */
  maxLos: number | null;
  /** leadDays <= this => last-minute mode is eligible. */
  lastMinuteLeadDays: number;
  /** Operator-forced emergency mode for this gap. */
  emergencyMode: boolean;
  /** Permit lowering min LOS to fill a gap shorter than standardMinLos. */
  allowShortenMinLos: boolean;
}

/** Operator override for a single date. Provided fields win over auto output. */
export interface Override {
  date: string;
  cta?: Bool01;
  ctd?: Bool01;
  minLos?: number | null;
  reason?: string;
}

/** Engine output, one row per night in the gap. Maps 1:1 to gap_restrictions. */
export interface DayRestriction {
  date: string;
  cta: Bool01;
  ctd: Bool01;
  minLos: number | null;
  maxLos: number | null;
  reason: string;
  gapId: string;
  source: 'auto' | 'manual';
  /** 0..1. 1 = deterministic certainty; lower = emergency/needs review. */
  confidence: number;
}

interface Stay { a: number; d: number; len: number; }

// ─────────────────────────────────────────────────────────── Helpers ──

export function addDays(iso: string, days: number): string {
  // Date-only arithmetic at noon to avoid TZ/DST drift (mirrors CalendarView.isNextDay).
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ───────────────────────────────────────────────────── effective LOS ──

interface EffectiveParams {
  effMinLos: number;
  gapFloor: number;
  emergency: boolean;
  shortened: boolean;
  unsellable: boolean;
}

export function resolveEffectiveParams(gap: Gap, cfg: GapEngineConfig): EffectiveParams {
  const lastMinute = gap.leadDays <= cfg.lastMinuteLeadDays;
  const emergency = cfg.emergencyMode || lastMinute;
  const gapFloor = emergency ? cfg.emergencyAcceptableGap : cfg.minAcceptableGap;

  let effMinLos = cfg.standardMinLos;
  let shortened = false;
  let unsellable = false;

  if (cfg.standardMinLos > gap.length) {
    // Standard stay does not fit the gap at all.
    if (emergency && cfg.allowShortenMinLos) {
      effMinLos = gap.length;   // collapse to a single full-fill stay
      shortened = true;
    } else {
      unsellable = true;        // priority (5): never leave an unsellable fragment silently
    }
  }
  return { effMinLos, gapFloor, emergency, shortened, unsellable };
}

// ──────────────────────────────────────────────────── enumerate stays ──

/** All acceptable single reservations for the gap as it exists NOW (empty). */
export function enumerateAcceptableStays(L: number, effMinLos: number, gapFloor: number, maxLos: number | null): Stay[] {
  const stays: Stay[] = [];
  const leftOk = (a: number) => a === 0 || a >= gapFloor;
  const rightOk = (d: number) => (L - d) === 0 || (L - d) >= gapFloor;
  for (let a = 0; a <= L - effMinLos; a++) {
    if (!leftOk(a)) continue;
    for (let d = a + effMinLos; d <= L; d++) {
      if (!rightOk(d)) continue;
      const len = d - a;
      if (maxLos !== null && len > maxLos) continue;
      stays.push({ a, d, len });
    }
  }
  return stays;
}

// ──────────────────────────────────────────────────────── core engine ──

/**
 * Deterministic, stateless core. Input: one gap + resolved config (+ overrides).
 * Output: per-night CTA/CTD/MIN/MAX restrictions. No I/O.
 *
 * Operating assumption: restrictions are RECOMPUTED on every availability sync.
 * They shape the NEXT single reservation; adjacent multi-bookings emerge by
 * iteration (each booking splits the gap, the next sync re-derives fresh gaps).
 */
export function computeGapRestrictions(
  gap: Gap,
  cfg: GapEngineConfig,
  overrides: Override[] = [],
): DayRestriction[] {
  const L = gap.length;
  const out: DayRestriction[] = [];
  if (L <= 0) return out;

  const p = resolveEffectiveParams(gap, cfg);
  const overrideByDate = new Map(overrides.map(o => [o.date, o]));

  // Unsellable gap: close every arrival, flag for manual override. (priority 5)
  if (p.unsellable) {
    for (let i = 0; i < L; i++) {
      out.push(applyOverride({
        date: addDays(gap.startDate, i),
        cta: 1,
        ctd: i === 0 ? 0 : 1,            // keep prior guest's checkout open on day 0
        minLos: cfg.standardMinLos,
        maxLos: null,
        reason: 'gap_unsellable_below_min_los',
        gapId: gap.gapId,
        source: 'auto',
        confidence: 0.3,
      }, overrideByDate));
    }
    return out;
  }

  const stays = enumerateAcceptableStays(L, p.effMinLos, p.gapFloor, cfg.maxLos);
  const baseConfidence = (p.emergency || p.shortened) ? 0.6 : 1.0;

  for (let i = 0; i < L; i++) {
    const date = addDays(gap.startDate, i);

    const arrivals = stays.filter(s => s.a === i);
    const departures = stays.filter(s => s.d === i);   // d===L lands on gap_end (no row)

    const cta: Bool01 = arrivals.length > 0 ? 0 : 1;
    // Day 0 (gap_start) is the PRIOR reservation's checkout day — never block CTD there.
    const ctd: Bool01 = i === 0 ? 0 : (departures.length > 0 ? 0 : 1);

    const minLos = arrivals.length > 0 ? Math.min(...arrivals.map(s => s.len)) : p.effMinLos;
    const maxLosFromStay = arrivals.length > 0 ? Math.max(...arrivals.map(s => s.len)) : null;
    const maxLos = maxLosFromStay === null
      ? null
      : (cfg.maxLos !== null ? Math.min(cfg.maxLos, maxLosFromStay) : maxLosFromStay);

    out.push(applyOverride({
      date,
      cta,
      ctd,
      minLos: cta === 1 ? p.effMinLos : minLos,
      maxLos,
      reason: reasonFor(i, L, cta, ctd, p.effMinLos, p.gapFloor, arrivals.length > 0),
      gapId: gap.gapId,
      source: 'auto',
      confidence: baseConfidence,
    }, overrideByDate));
  }
  return out;
}

function reasonFor(
  i: number, L: number, cta: Bool01, ctd: Bool01,
  effMinLos: number, gapFloor: number, hasArrival: boolean,
): string {
  if (cta === 1) {
    const leftBlocked = i >= 1 && i < gapFloor;          // would leave 1..gapFloor-1 on the left
    const tailBlocked = i > L - effMinLos;               // not enough nights left for min LOS
    if (leftBlocked && tailBlocked) return 'cta_left_gap_and_min_los_tail';
    if (leftBlocked) return 'cta_protect_left_gap';
    if (tailBlocked) return 'cta_min_los_tail';
    return 'cta_no_valid_stay';
  }
  if (ctd === 1) {
    const rightBlocked = (L - i) >= 1 && (L - i) < gapFloor;  // would leave 1..gapFloor-1 on the right
    const headBlocked = i < effMinLos;                        // too early for any min LOS checkout
    if (rightBlocked && headBlocked) return 'ctd_right_gap_and_min_los_head';
    if (rightBlocked) return 'ctd_protect_right_gap';
    if (headBlocked) return 'ctd_min_los_head';
    return 'ctd_no_valid_departure';
  }
  return hasArrival ? 'arrival_open' : 'open';
}

function applyOverride(row: DayRestriction, overrideByDate: Map<string, Override>): DayRestriction {
  const ov = overrideByDate.get(row.date);
  if (!ov) return row;
  return {
    ...row,
    cta: ov.cta !== undefined ? ov.cta : row.cta,
    ctd: ov.ctd !== undefined ? ov.ctd : row.ctd,
    minLos: ov.minLos !== undefined ? ov.minLos : row.minLos,
    reason: ov.reason ?? 'manual_override',
    source: 'manual',
    confidence: 1.0,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// TEST HARNESS (the 10 mandatory cases). Pure assertions, no framework.
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_CFG: GapEngineConfig = {
  standardMinLos: 3,
  minAcceptableGap: 3,
  emergencyAcceptableGap: 3,
  maxLos: null,
  lastMinuteLeadDays: 0,   // not last-minute unless explicitly set
  emergencyMode: false,
  allowShortenMinLos: false,
};

const START = '2026-07-01';
let passed = 0;
let failed = 0;

function gap(length: number, leadDays = 90, gapId = 'G'): Gap {
  return { gapId, unitId: 'U1', startDate: START, length, leadDays };
}

/** Compact per-day signature: "cta/ctd/min" per night, e.g. "0/0/3 1/1/3 ...". */
function sig(rows: DayRestriction[]): string {
  return rows.map(r => `${r.cta}/${r.ctd}/${r.minLos ?? '-'}`).join(' ');
}

function check(name: string, rows: DayRestriction[], expected: string) {
  const got = sig(rows);
  const ok = got === expected;
  if (ok) passed++; else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  console.log(`     expected: ${expected}`);
  console.log(`     got:      ${got}`);
  if (!ok) console.log('     FULL:', JSON.stringify(rows.map(r => ({ d: r.date.slice(8), cta: r.cta, ctd: r.ctd, min: r.minLos, max: r.maxLos, reason: r.reason })), null, 0));
}

// ── Test 1: Luka 5 nocy, Min LOS 3, min. luka 3 ──
// Any partial leaves <3 on a side => only the full 5-night stay survives.
check('T1  L=5, minLOS=3, minGap=3 → forced full 5',
  computeGapRestrictions(gap(5), { ...DEFAULT_CFG }),
  '0/0/5 1/1/3 1/1/3 1/1/3 1/1/3');

// ── Test 2: Luka 7 nocy, Min LOS 3, min. luka 3 ──
// Acceptable stays: (0,3)(0,4)(0,7)(3,7)(4,7). Splits 3+4 / 4+3 / full.
check('T2  L=7, minLOS=3, minGap=3 → rich split',
  computeGapRestrictions(gap(7), { ...DEFAULT_CFG }),
  '0/0/3 1/1/3 1/1/3 0/0/4 0/0/3 1/1/3 1/1/3');

// ── Test 3: Luka 3 noce, Min LOS 6, awaryjna min. luka 3 (emergency ON) ──
// Standard LOS 6 > 3, emergency shortens to 3 → single full-fill stay.
check('T3  L=3, minLOS=6, emergency → shorten to single 3-night',
  computeGapRestrictions(gap(3), {
    ...DEFAULT_CFG, standardMinLos: 6, emergencyAcceptableGap: 3,
    emergencyMode: true, allowShortenMinLos: true,
  }),
  '0/0/3 1/1/3 1/1/3');

// ── Test 3b: same gap WITHOUT emergency → unsellable, all CTA, needs override ──
check('T3b L=3, minLOS=6, NO emergency → unsellable closed',
  computeGapRestrictions(gap(3), { ...DEFAULT_CFG, standardMinLos: 6 }),
  '1/0/6 1/1/6 1/1/6');

// ── Test 4: Reservation that would leave 1 night on the RIGHT is blocked ──
// L=6: acceptable (0,3)(0,6)(3,6). Departing at offset 5 (right leftover 1) => CTD=1.
{
  const rows = computeGapRestrictions(gap(6), { ...DEFAULT_CFG });
  check('T4  L=6 → right leftover of 1 night blocked (ctd@5=1)', rows,
    '0/0/3 1/1/3 1/1/3 0/0/3 1/1/3 1/1/3');
  assert('T4 ctd@offset5 == 1 (would leave 1 night right)', rows[5].ctd === 1);
  assert('T4 ctd@offset4 == 1 (would leave 2 nights right)', rows[4].ctd === 1);
}

// ── Test 5: Reservation that would leave 1 night on the LEFT is blocked ──
// Same L=6 gap: arriving at offset 1 (left leftover 1) or 2 (left leftover 2) => CTA=1.
{
  const rows = computeGapRestrictions(gap(6), { ...DEFAULT_CFG });
  assert('T5 cta@offset1 == 1 (would leave 1 night left)', rows[1].cta === 1);
  assert('T5 cta@offset2 == 1 (would leave 2 nights left)', rows[2].cta === 1);
  assert('T5 cta@offset3 == 0 (leaves a sellable 3-night left)', rows[3].cta === 0);
  console.log('✅ T5  L=6 → left leftover of 1-2 nights blocked (cta@1,@2=1; @3 open)');
  passed++;
}

// ── Test 6: Reservation fills the whole gap ──
// L=4, minLOS=4 → the only acceptable stay is the full 4-night booking.
check('T6  L=4, minLOS=4 → fills whole gap',
  computeGapRestrictions(gap(4), { ...DEFAULT_CFG, standardMinLos: 4 }),
  '0/0/4 1/1/4 1/1/4 1/1/4');

// ── Test 7: Split into two valid parts ──
// L=8, minLOS=4, minGap=4 → (0,4)(0,8)(4,8): clean 4+4 split or full.
{
  const rows = computeGapRestrictions(gap(8), {
    ...DEFAULT_CFG, standardMinLos: 4, minAcceptableGap: 4, emergencyAcceptableGap: 4,
  });
  check('T7  L=8, minLOS=4, minGap=4 → valid 4+4 split', rows,
    '0/0/4 1/1/4 1/1/4 1/1/4 0/0/4 1/1/4 1/1/4 1/1/4');
  assert('T7 arrival@0 open, min 4', rows[0].cta === 0 && rows[0].minLos === 4);
  assert('T7 arrival@4 open, min 4 (second part)', rows[4].cta === 0 && rows[4].minLos === 4);
}

// ── Test 8: Split into one valid + one invalid part ──
// L=5, minLOS=2, minGap=3 → (0,2)(0,5)(3,5). A 2-night at the start is allowed ONLY
// because it leaves a sellable 3-night remainder; arrival@2 (leaving 1 dead night) is blocked.
{
  const rows = computeGapRestrictions(gap(5), {
    ...DEFAULT_CFG, standardMinLos: 2,
  });
  // (0,2) sells 2 leaving a sellable 3; checkout@2 stays open (ends that valid stay),
  // arrival@3 open (leaves sellable 3 left) but checkout@3 blocked (would strand 2<3 right).
  check('T8  L=5, minLOS=2, minGap=3 → invalid split refused', rows,
    '0/0/2 1/1/2 1/0/2 0/1/2 1/1/2');
  assert('T8 cta@2 == 1 (a 2-night here would strand 1 night left)', rows[2].cta === 1);
  assert('T8 ctd@1 == 1 (checkout here would strand 1 night right of gapFloor)', rows[1].ctd === 1);
  assert('T8 arrival@0 min 2 (sell 2, leaves sellable 3)', rows[0].cta === 0 && rows[0].minLos === 2);
}

// ── Test 9: Manual operator override ──
// Take T2 gap, force-open the normally-closed night at offset 5 with min LOS 2.
{
  const rows = computeGapRestrictions(gap(7), { ...DEFAULT_CFG }, [
    { date: addDays(START, 5), cta: 0, ctd: 0, minLos: 2, reason: 'operator_last_minute' },
  ]);
  assert('T9 override cta@5 == 0', rows[5].cta === 0);
  assert('T9 override ctd@5 == 0', rows[5].ctd === 0);
  assert('T9 override minLos@5 == 2', rows[5].minLos === 2);
  assert('T9 override source == manual', rows[5].source === 'manual');
  assert('T9 override confidence == 1', rows[5].confidence === 1);
  assert('T9 override reason preserved', rows[5].reason === 'operator_last_minute');
  assert('T9 untouched day still auto', rows[1].source === 'auto');
  console.log('✅ T9  manual override wins on offset 5, rest stays auto');
  passed++;
}

// ── Test 10: Season high vs low on the SAME gap ──
{
  const high = computeGapRestrictions(gap(6), {
    ...DEFAULT_CFG, standardMinLos: 4, minAcceptableGap: 3, emergencyAcceptableGap: 3,
  });
  const low = computeGapRestrictions(gap(6), {
    ...DEFAULT_CFG, standardMinLos: 2, minAcceptableGap: 2, emergencyAcceptableGap: 2,
  });
  // Closed days carry effMinLos (=4) as their MIN; only the open arrival@0 shows 6.
  check('T10a L=6 HIGH season (minLOS=4,minGap=3) → forced full 6', high,
    '0/0/6 1/1/4 1/1/4 1/1/4 1/1/4 1/1/4');
  // arrival@3 must run to the end (min 3); other arrivals min 2.
  check('T10b L=6 LOW season (minLOS=2,minGap=2) → flexible', low,
    '0/0/2 1/1/2 0/0/2 0/0/3 0/0/2 1/1/2');
  assert('T10 season changes output', sig(high) !== sig(low));
}

function assert(name: string, cond: boolean) {
  if (cond) passed++; else { failed++; console.log(`❌ ASSERT FAILED: ${name}`); }
}

console.log(`\n──────────────────────────────────────────`);
console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0 && typeof process !== 'undefined') process.exit(1);
