import { describe, it, expect } from 'vitest';
import { parseOids } from './PropertiesView';

describe('parseOids', () => {
  it('rozbija listę po przecinkach, spacjach i nowych liniach', () => {
    expect(parseOids('5279, 4268 3311\n1234;5555')).toEqual(['5279', '4268', '3311', '1234', '5555']);
  });

  it('usuwa duplikaty - ten sam obiekt nie poleci dwa razy', () => {
    expect(parseOids('5279, 5279\n5279')).toEqual(['5279']);
  });

  it('ignoruje śmieci, zostawia same numery', () => {
    expect(parseOids('OID: 5279, willa-morska, 4268, ---')).toEqual(['5279', '4268']);
  });

  it('pusty tekst to pusta lista', () => {
    expect(parseOids('   \n  ')).toEqual([]);
  });
});

describe('odmiana liczebnika', () => {
  it('dobiera formę do liczby', async () => {
    const { obiekty } = await import('./PropertiesView');
    expect(obiekty(1)).toBe('1 obiekt');
    expect(obiekty(3)).toBe('3 obiekty');
    expect(obiekty(5)).toBe('5 obiektów');
    expect(obiekty(12)).toBe('12 obiektów');
    expect(obiekty(22)).toBe('22 obiekty');
    expect(obiekty(50)).toBe('50 obiektów');
  });
});
