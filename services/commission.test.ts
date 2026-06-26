// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseAmount, buildReport, parseSaleReport, type RawReservation } from './commission.ts';

describe('parseAmount (PL number formats)', () => {
  it('handles comma decimals and thousand separators', () => {
    expect(parseAmount('765,00')).toBe(765);
    expect(parseAmount('1 234,56')).toBeCloseTo(1234.56);
    expect(parseAmount('1.234,56')).toBeCloseTo(1234.56);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('abc')).toBe(0);
  });
});

const raw = (room: string, price: number, addDate: string): RawReservation => ({
  room, reservation: 'X', arrival: '2026-06-01', departure: '2026-06-03',
  firstName: 'A', lastName: 'B', source: 'airbnb', price, amount: price, currency: 'PLN', addDate,
});

describe('buildReport', () => {
  it('computes commission = price × rate and totals', () => {
    const r = buildReport([raw('R1', 765, '2026-06-02 10:00:00'), raw('R1', 450, '2026-06-03 10:00:00')], 15, null);
    expect(r.count).toBe(2);
    expect(r.rows[0].commission).toBeCloseTo(114.75);
    expect(r.totalPrice).toBeCloseTo(1215);
    expect(r.totalCommission).toBeCloseTo(182.25);
  });

  it('hides reservations added before countFrom', () => {
    const r = buildReport([
      raw('R1', 930, '2026-05-10 10:00:00'),  // before cutoff → hidden
      raw('R1', 765, '2026-06-02 10:00:00'),
    ], 15, '2026-06-01');
    expect(r.count).toBe(1);
    expect(r.totalPrice).toBe(765);
  });

  it('sorts by room so the report groups by kwatera', () => {
    const r = buildReport([raw('Pokój 5A', 100, '2026-06-02 10:00:00'), raw('Pokój 1A', 100, '2026-06-02 11:00:00')], 10, null);
    expect(r.rows.map(x => x.room)).toEqual(['Pokój 1A', 'Pokój 5A']);
  });
});

describe('parseSaleReport (HTML-table .xls)', () => {
  it('maps columns by header and parses prices', async () => {
    const html = `<table>
      <tr><th>room</th><th>reservation</th><th>ota commission</th><th>price</th><th>add date</th></tr>
      <tr></tr>
      <tr><td>Pokój 1A</td><td>426</td><td>118,58</td><td>765,00</td><td>2026-06-02 12:12:01</td></tr>
    </table>`;
    const file = { arrayBuffer: async () => new TextEncoder().encode(html).buffer } as unknown as File;
    const rows = await parseSaleReport(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].room).toBe('Pokój 1A');
    expect(rows[0].price).toBe(765);
    expect(rows[0].reservation).toBe('426');
  });
});
