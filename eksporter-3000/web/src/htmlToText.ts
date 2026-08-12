/**
 * HTML → czysty tekst do wklejenia.
 *
 * Opisy w Hotresie są pisane przez właścicieli obiektów w edytorze WYSIWYG,
 * więc bywają naszpikowane stylami, pustymi akapitami i twardymi spacjami.
 * Przy przepisywaniu do nowego PMS-a prawie zawsze chodzi o sam tekst.
 */
export function htmlToText(html: string): string {
  if (!html) return '';

  let text = html;

  // Wytnij to, czego nigdy nie chcemy w tekście.
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');

  // Elementy, które w tekście oznaczają nową linię lub punkt listy.
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|tr|blockquote)>/gi, '\n\n');
  // Nową linię daje otwarcie <li>; zamknięcie już nie, bo wychodziłaby pusta.
  text = text.replace(/<li[^>]*>/gi, '\n• ');
  text = text.replace(/<\/(ul|ol)>/gi, '\n');
  text = text.replace(/<\/li>/gi, '');
  text = text.replace(/<\/t[dh]>/gi, '\t');

  // Reszta znaczników znika.
  text = text.replace(/<[^>]+>/g, '');

  // Encje - najczęstsze wprost, resztę przez przeglądarkę.
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'");
  if (/&[a-z]+;|&#\d+;/i.test(text) && typeof document !== 'undefined') {
    const area = document.createElement('textarea');
    area.innerHTML = text;
    text = area.value;
  }

  return text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
