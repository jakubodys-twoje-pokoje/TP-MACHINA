import { describe, it, expect } from 'vitest';
import { bool, csv, date, float, int, normalizeOid, str, toArray, unknownKeys } from '../src/coerce.js';

describe('coerce', () => {
  it('str: puste stringi to null', () => {
    expect(str('  Willa  ')).toBe('Willa');
    expect(str('')).toBeNull();
    expect(str('   ')).toBeNull();
    expect(str(null)).toBeNull();
    expect(str(undefined)).toBeNull();
  });

  it('int / float: obsługuje stringi Hotresa i odrzuca śmieci', () => {
    expect(int('25')).toBe(25);
    expect(int('')).toBeNull();
    expect(int('abc')).toBeNull();
    expect(int(0)).toBe(0);
    expect(float('179.50')).toBe(179.5);
    expect(float('179,50')).toBe(179.5);
    expect(float(null)).toBeNull();
  });

  it('bool: "0" to false, nie null', () => {
    expect(bool('1')).toBe(true);
    expect(bool('0')).toBe(false);
    expect(bool(true)).toBe(true);
    expect(bool('')).toBeNull();
    expect(bool(null)).toBeNull();
  });

  it('date: rozumie oba formaty i odrzuca zera', () => {
    expect(date('2025-12-04')?.toISOString()).toBe('2025-12-04T00:00:00.000Z');
    expect(date('2025-05-13 16:59:39')?.toISOString()).toBe('2025-05-13T16:59:39.000Z');
    expect(date('0000-00-00')).toBeNull();
    expect(date('')).toBeNull();
    expect(date('nonsens')).toBeNull();
  });

  it('csv: rozbija listę udogodnień i przepuszcza gotowe tablice', () => {
    expect(csv('22,7,73')).toEqual(['22', '7', '73']);
    expect(csv('22, 7 ,')).toEqual(['22', '7']);
    expect(csv(['1973', '2038'])).toEqual(['1973', '2038']);
    expect(csv(null)).toEqual([]);
  });

  it('toArray: normalizuje niekonsekwencje Hotresa', () => {
    expect(toArray([1, 2])).toEqual([1, 2]);
    expect(toArray({ a: 1 })).toEqual([{ a: 1 }]);
    expect(toArray(null)).toEqual([]);
  });

  it('unknownKeys: wyłapuje pola spoza schematu', () => {
    expect(unknownKeys({ a: 1, b: 2, nowosc: 3 }, new Set(['a', 'b']))).toEqual(['nowosc']);
    expect(unknownKeys([1, 2], new Set())).toEqual([]);
  });
});

describe('normalizeOid', () => {
  it('obcina białe znaki - OID-y wklejane z list mają je nagminnie', () => {
    expect(normalizeOid('4573 ')).toBe('4573');
    expect(normalizeOid(' 4573')).toBe('4573');
    expect(normalizeOid('4573\n')).toBe('4573');
    expect(normalizeOid('\t4573\r\n')).toBe('4573');
    expect(normalizeOid(4573)).toBe('4573');
    expect(normalizeOid(null)).toBe('');
  });
});
