import { describe, it, expect } from 'vitest';
import { htmlToText } from './htmlToText';

describe('htmlToText', () => {
  it('zamienia akapity na puste linie', () => {
    expect(htmlToText('<p>Pierwszy</p><p>Drugi</p>')).toBe('Pierwszy\n\nDrugi');
  });

  it('robi z listy punkty', () => {
    expect(htmlToText('<ul><li>Parking</li><li>Śniadanie</li></ul>')).toBe('• Parking\n• Śniadanie');
  });

  it('zdejmuje style i atrybuty, zostawia treść', () => {
    const html = '<p><span style="color:rgb(0,0,0);font-size:14px">Zadatek bezzwrotny</span></p>';
    expect(htmlToText(html)).toBe('Zadatek bezzwrotny');
  });

  it('rozwija encje i twarde spacje', () => {
    expect(htmlToText('<p>Doba&nbsp;hotelowa &amp; zasady</p>')).toBe('Doba hotelowa & zasady');
  });

  it('usuwa nadmiarowe puste linie z edytora WYSIWYG', () => {
    expect(htmlToText('<p>A</p><p>&nbsp;</p><p></p><p>B</p>')).toBe('A\n\nB');
  });

  it('wycina skrypty i style', () => {
    expect(htmlToText('<style>.x{color:red}</style><p>Tekst</p>')).toBe('Tekst');
  });

  it('radzi sobie z <br> i pustym wejściem', () => {
    expect(htmlToText('Linia<br>Druga')).toBe('Linia\nDruga');
    expect(htmlToText('')).toBe('');
  });
});

describe('odmiana liczebnika', () => {
  it('dobiera formę dla zdjęć', async () => {
    const { plural } = await import('./helpers');
    const zdj = (n: number) => plural(n, ['zdjęcie', 'zdjęcia', 'zdjęć']);
    expect(zdj(1)).toBe('1 zdjęcie');
    expect(zdj(3)).toBe('3 zdjęcia');
    expect(zdj(7)).toBe('7 zdjęć');
    expect(zdj(13)).toBe('13 zdjęć');
    expect(zdj(24)).toBe('24 zdjęcia');
  });
});
