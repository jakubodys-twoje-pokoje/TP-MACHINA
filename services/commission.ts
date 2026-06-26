// Commission calculator service: parse the sale-report file, compute commission,
// persist per-property rate + historical reports, and export a print-ready PDF.
import { supabase } from './supabaseClient';
import type { CommissionReservation, CommissionReport, Property } from '../types';

export type RawReservation = Omit<CommissionReservation, 'commission'>;

// ── Parsing ────────────────────────────────────────────────────────────────
// The "sale report .xls" is actually an HTML <table> (often UTF-16). Decode by
// BOM, parse the table, map columns by header name (order-independent).
function decodeBuffer(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  return new TextDecoder('utf-8').decode(buf);
}

// "765,00" → 765.00 ; "1 234,56" → 1234.56 ; "1.234,56" → 1234.56
export function parseAmount(s: string): number {
  if (!s) return 0;
  let t = s.replace(/[\s ]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t);
  return Number.isNaN(n) ? 0 : n;
}

export async function parseSaleReport(file: File): Promise<RawReservation[]> {
  const text = decodeBuffer(await file.arrayBuffer());
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const trs = Array.from(doc.querySelectorAll('tr'));
  let headers: string[] = [];
  const out: RawReservation[] = [];

  for (const tr of trs) {
    const ths = Array.from(tr.querySelectorAll('th')).map(c => (c.textContent || '').trim().toLowerCase());
    if (ths.length > 0) { headers = ths; continue; }
    const tds = Array.from(tr.querySelectorAll('td')).map(c => (c.textContent || '').trim());
    if (tds.length < 2) continue;                       // empty separator rows
    const get = (name: string) => { const i = headers.indexOf(name); return i >= 0 ? (tds[i] ?? '') : ''; };
    out.push({
      room: get('room'),
      reservation: get('reservation'),
      arrival: get('arrival'),
      departure: get('departure'),
      firstName: get('first name'),
      lastName: get('last name'),
      source: get('source'),
      adults: parseInt(get('adults'), 10) || 0,
      children: (parseInt(get('child 1'), 10) || 0) + (parseInt(get('child 2'), 10) || 0) + (parseInt(get('child 3'), 10) || 0),
      price: parseAmount(get('price')),
      amount: get('amount') ? parseAmount(get('amount')) : null,
      currency: get('currency') || 'PLN',
      addDate: get('add date'),
    });
  }
  if (out.length === 0) throw new Error('Nie znaleziono rezerwacji w pliku. Sprawdź, czy to raport sprzedaży (.xls).');
  return out;
}

// ── Commission computation ──────────────────────────────────────────────────
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BuiltReport {
  rows: CommissionReservation[];
  totalPrice: number;
  totalCommission: number;
  count: number;
}

/**
 * Commission = price × rate%. Reservations added before `countFrom` are HIDDEN.
 * Rows are sorted by room then add date so the report groups by kwatera.
 */
export function buildReport(raw: RawReservation[], ratePercent: number, countFrom: string | null): BuiltReport {
  const rate = ratePercent / 100;
  const cutoff = countFrom ? new Date(`${countFrom}T00:00:00`).getTime() : null;

  const kept = raw.filter(r => {
    if (cutoff === null) return true;
    const t = new Date((r.addDate || '').replace(' ', 'T')).getTime();
    return Number.isNaN(t) ? true : t >= cutoff;        // keep add_date >= cutoff (unknown kept)
  });

  kept.sort((a, b) => a.room.localeCompare(b.room, 'pl') || a.addDate.localeCompare(b.addDate));

  const rows: CommissionReservation[] = kept.map(r => ({ ...r, commission: round2(r.price * rate) }));
  const totalPrice = round2(rows.reduce((s, r) => s + r.price, 0));
  const totalCommission = round2(rows.reduce((s, r) => s + r.commission, 0));
  return { rows, totalPrice, totalCommission, count: rows.length };
}

// ── Persistence ──────────────────────────────────────────────────────────────
export async function getCommissionRate(propertyId: string): Promise<number> {
  const { data } = await supabase.from('commission_settings').select('rate_percent').eq('property_id', propertyId).maybeSingle();
  return data?.rate_percent ?? 0;
}

export async function saveCommissionRate(propertyId: string, ratePercent: number): Promise<void> {
  const { error } = await supabase
    .from('commission_settings')
    .upsert({ property_id: propertyId, rate_percent: ratePercent, updated_at: new Date().toISOString() }, { onConflict: 'property_id' });
  if (error) throw new Error(error.message);
}

export async function listReports(propertyId: string): Promise<CommissionReport[]> {
  const { data } = await supabase
    .from('commission_reports').select('*').eq('property_id', propertyId).order('created_at', { ascending: false });
  return (data ?? []) as CommissionReport[];
}

export async function saveReport(report: Omit<CommissionReport, 'id' | 'created_at'>): Promise<void> {
  const { error } = await supabase.from('commission_reports').insert(report);
  if (error) throw new Error(error.message);
}

export async function deleteReport(id: string): Promise<void> {
  const { error } = await supabase.from('commission_reports').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Formatting + PDF export ──────────────────────────────────────────────────
export const fmtPLN = (n: number) =>
  new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// Rate with PL decimal comma, up to 3 places (e.g. 4,75). Trailing zeros trimmed.
export const fmtPct = (n: number) =>
  new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(n);

const esc = (s: string) => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Build a self-contained, print-ready HTML document for the report. */
export function buildReportHtml(opts: {
  property: Pick<Property, 'name'> | null;
  rows: CommissionReservation[];
  totalPrice: number;
  totalCommission: number;
  ratePercent: number;
  countFrom: string | null;
  currency: string;
}): string {
  const { property, rows, totalPrice, totalCommission, ratePercent, countFrom, currency } = opts;
  const body = rows.map((r, i) => {
    const showRoom = i === 0 || r.room !== rows[i - 1].room;
    return `<tr class="${showRoom && i > 0 ? 'grp' : ''}">
      <td class="room">${showRoom ? esc(r.room) : ''}</td>
      <td>${esc(r.reservation)}</td>
      <td>${esc(r.arrival)} – ${esc(r.departure)}</td>
      <td>${esc(`${r.firstName} ${r.lastName}`.trim())}</td>
      <td>${esc(r.source)}</td>
      <td class="num">${r.adults}</td>
      <td class="num">${r.children}</td>
      <td class="num">${fmtPLN(r.price)}</td>
      <td class="num com">${fmtPLN(r.commission)}</td>
    </tr>`;
  }).join('');

  const today = new Date().toLocaleDateString('pl-PL');
  const periodNote = countFrom ? `Liczone od (add date): <b>${esc(countFrom)}</b>` : 'Cały zakres pliku';

  return `<!doctype html><html lang="pl"><head><meta charset="utf-8">
  <title>Raport prowizji${property ? ' – ' + esc(property.name) : ''}</title>
  <style>
    *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1e293b;margin:32px}
    .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0d9488;padding-bottom:12px;margin-bottom:18px}
    h1{font-size:20px;margin:0;color:#0f766e} .sub{color:#64748b;font-size:12px;margin-top:4px}
    .meta{text-align:right;font-size:12px;color:#475569}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#0d9488;color:#fff;text-align:left;padding:7px 9px;font-weight:600}
    th.num,td.num{text-align:right}
    td{padding:6px 9px;border-bottom:1px solid #e2e8f0}
    td.room{font-weight:700;color:#0f766e}
    tr.grp td{border-top:2px solid #94a3b8}
    td.com{font-weight:700;color:#0f766e}
    tfoot td{padding:10px 9px;font-weight:800;font-size:13px;border-top:2px solid #0d9488;background:#f0fdfa}
    .totlbl{text-align:right}
    @media print{body{margin:12mm}@page{size:A4}}
  </style></head><body>
  <div class="head">
    <div><h1>Raport prowizji</h1><div class="sub">${property ? esc(property.name) : ''}</div></div>
    <div class="meta">Wygenerowano: ${today}<br>Stawka prowizji: <b>${fmtPct(ratePercent)}%</b><br>${periodNote}</div>
  </div>
  <table>
    <thead><tr>
      <th>Kwatera</th><th>Nr rez.</th><th>Pobyt</th><th>Gość</th><th>Źródło</th>
      <th class="num">Doro.</th><th class="num">Dzieci</th>
      <th class="num">Cena (${esc(currency)})</th><th class="num">Prowizja (${esc(currency)})</th>
    </tr></thead>
    <tbody>${body}</tbody>
    <tfoot>
      <tr><td colspan="7" class="totlbl">SUMA rezerwacji (${rows.length}):</td>
          <td class="num">${fmtPLN(totalPrice)}</td><td class="num com">${fmtPLN(totalCommission)}</td></tr>
    </tfoot>
  </table>
  </body></html>`;
}

/** Open the report in a new window and trigger the print/save-as-PDF dialog (fallback). */
export function exportReportPdf(html: string): void {
  const w = window.open('', '_blank');
  if (!w) { alert('Zezwól na wyskakujące okna, aby wyeksportować PDF.'); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

const sanitize = (s: string) => (s || 'raport').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60);

/**
 * Build a real, downloadable PDF with jsPDF + autotable (native pagination,
 * repeated header, no row-cutting) and an embedded Roboto font for Polish.
 * Libraries are imported on demand to keep the main bundle small.
 */
export async function downloadReportPdf(opts: {
  property: Pick<Property, 'name'> | null;
  rows: CommissionReservation[];
  totalPrice: number;
  totalCommission: number;
  ratePercent: number;
  countFrom: string | null;
  currency: string;
}): Promise<void> {
  const { property, rows, totalPrice, totalCommission, ratePercent, countFrom, currency } = opts;
  const [{ jsPDF }, autoTableMod, fontMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('./fonts/roboto.ts'),
  ]);
  const autoTable = (autoTableMod as any).default ?? (autoTableMod as any).autoTable;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.addFileToVFS('Roboto-Regular.ttf', fontMod.ROBOTO_REGULAR_B64);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.setFont('Roboto', 'normal');

  const today = new Date().toLocaleDateString('pl-PL');
  doc.setFontSize(16); doc.setTextColor(15, 118, 110);
  doc.text('Raport prowizji', 40, 40);
  doc.setFontSize(10); doc.setTextColor(71, 85, 105);
  if (property?.name) doc.text(property.name, 40, 58);
  const meta = `Wygenerowano: ${today}    Stawka: ${fmtPct(ratePercent)}%    ${countFrom ? 'Liczone od (add date): ' + countFrom : 'Caly zakres pliku'}`;
  doc.text(meta, 40, 74);

  const body = rows.map((r, i) => {
    const showRoom = i === 0 || r.room !== rows[i - 1].room;
    return [
      showRoom ? r.room : '',
      r.reservation,
      `${r.arrival} – ${r.departure}`,
      `${r.firstName} ${r.lastName}`.trim(),
      r.source,
      String(r.adults),
      String(r.children),
      fmtPLN(r.price),
      fmtPLN(r.commission),
    ];
  });

  autoTable(doc, {
    startY: 88,
    head: [['Kwatera', 'Nr rez.', 'Pobyt', 'Gość', 'Źródło', 'Doro.', 'Dzieci', `Cena (${currency})`, `Prowizja (${currency})`]],
    body,
    foot: [[
      { content: `SUMA · ${rows.length} rezerwacji`, colSpan: 7, styles: { halign: 'right' } },
      fmtPLN(totalPrice),
      fmtPLN(totalCommission),
    ]],
    styles: { font: 'Roboto', fontStyle: 'normal', fontSize: 8, cellPadding: 3, textColor: [30, 41, 59] },
    headStyles: { font: 'Roboto', fontStyle: 'normal', fillColor: [13, 148, 136], textColor: 255 },
    footStyles: { font: 'Roboto', fontStyle: 'normal', fillColor: [240, 253, 250], textColor: [15, 118, 110], fontSize: 9 },
    columnStyles: {
      0: { textColor: [15, 118, 110] },
      5: { halign: 'center' }, 6: { halign: 'center' },
      7: { halign: 'right' }, 8: { halign: 'right', textColor: [15, 118, 110] },
    },
    margin: { left: 40, right: 40 },
  });

  doc.save(`Prowizje_${sanitize(property?.name ?? '')}_${today.replace(/\./g, '-')}.pdf`);
}
