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
export interface CommissionSettings { rate_percent: number; count_from: string | null; }

export async function getCommissionSettings(propertyId: string): Promise<CommissionSettings> {
  // select('*') so a missing count_from column (migration not run yet) doesn't break the read.
  const { data } = await supabase
    .from('commission_settings').select('*').eq('property_id', propertyId).maybeSingle();
  return { rate_percent: data?.rate_percent ?? 0, count_from: data?.count_from ?? null };
}

export async function saveCommissionSettings(propertyId: string, s: CommissionSettings): Promise<void> {
  const { error } = await supabase
    .from('commission_settings')
    .upsert({ property_id: propertyId, rate_percent: s.rate_percent, count_from: s.count_from || null, updated_at: new Date().toISOString() }, { onConflict: 'property_id' });
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

/**
 * Monthly report period as a full-month range (1 → last day) derived from the
 * "licz prowizję od" date's month — e.g. count_from = 2026-06-07 → "1–30 czerwca 2026".
 * Falls back to the earliest reservation's add date, then today.
 */
export function monthPeriodLabel(countFrom: string | null, rows: CommissionReservation[]): string {
  let basis: Date | null = null;
  if (countFrom) basis = new Date(`${countFrom}T12:00:00`);
  else {
    const dates = rows.map(r => (r.addDate || '').replace(' ', 'T')).filter(Boolean).sort();
    if (dates.length) basis = new Date(dates[0]);
  }
  if (!basis || Number.isNaN(basis.getTime())) basis = new Date();
  const y = basis.getFullYear(), m = basis.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  return `${first.getDate()}–${last.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

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

// Machina brand: deep slate + indigo accent.
const INK = { indigo: [79, 70, 229] as [number, number, number], indigoDark: [67, 56, 202] as [number, number, number], indigoBg: [238, 242, 255] as [number, number, number], slate: [30, 41, 59] as [number, number, number] };

/** Runtime header banner: indigo→slate gradient + a subtle, elegant hotel skyline. */
function makeBannerDataUrl(wPx: number, hPx: number): string {
  const c = document.createElement('canvas');
  c.width = wPx; c.height = hPx;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, wPx, 0);
  g.addColorStop(0, '#1e1b4b');     // indigo-950
  g.addColorStop(0.5, '#4338ca');   // indigo-700
  g.addColorStop(1, '#0f172a');     // slate-900
  ctx.fillStyle = g; ctx.fillRect(0, 0, wPx, hPx);

  // Subtle skyline, kept to the RIGHT half so it never sits under the title/meta text.
  ctx.save();
  ctx.globalAlpha = 0.07; ctx.fillStyle = '#ffffff';
  let x = wPx * 0.60;
  const blds = [[54, 38], [38, 58], [70, 28], [46, 70], [32, 48], [62, 40], [42, 60], [80, 32], [36, 52], [58, 44], [40, 64], [66, 36]];
  for (const [bw, bh] of blds) {
    if (x > wPx) break;
    ctx.fillRect(x, hPx - bh, bw - 7, bh);
    ctx.save(); ctx.globalAlpha = 0.5;
    for (let wy = hPx - bh + 7; wy < hPx - 7; wy += 11)
      for (let wx = x + 5; wx < x + bw - 12; wx += 10) ctx.fillRect(wx, wy, 4, 5);
    ctx.restore();
    x += bw;
  }
  ctx.restore();

  // Left vignette covering the whole text column so titles + meta stay crisp.
  const og = ctx.createLinearGradient(0, 0, wPx * 0.62, 0);
  og.addColorStop(0, 'rgba(15,23,42,0.62)'); og.addColorStop(0.8, 'rgba(15,23,42,0.35)'); og.addColorStop(1, 'rgba(15,23,42,0)');
  ctx.fillStyle = og; ctx.fillRect(0, 0, wPx, hPx);
  return c.toDataURL('image/jpeg', 0.92);
}

/**
 * Real, downloadable PDF — Machina-branded. jsPDF + autotable (native pagination,
 * repeated header, no row-cutting), embedded Roboto (Polish), a gradient hotel
 * banner + Twoje Pokoje logo, KPI summary cards and grouped, readable rows.
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
  const [{ jsPDF }, autoTableMod, fontMod, logoMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('./fonts/roboto.ts'),
    import('./fonts/logo.ts'),
  ]);
  const autoTable = (autoTableMod as any).default ?? (autoTableMod as any).autoTable;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.addFileToVFS('Roboto-Regular.ttf', fontMod.ROBOTO_REGULAR_B64);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.setFont('Roboto', 'normal');

  const pageW = doc.internal.pageSize.getWidth();
  const mX = 40;
  const bannerH = 128;

  // ── Branded header band ──
  doc.addImage(makeBannerDataUrl(1123, 178), 'JPEG', 0, 0, pageW, bannerH);
  const logoH = 44, logoW = logoH * (600 / 360);
  try { doc.addImage(logoMod.TP_LOGO_PNG, 'PNG', pageW - mX - logoW, 26, logoW, logoH, undefined, 'FAST'); } catch { /* optional */ }

  const today = new Date().toLocaleDateString('pl-PL');
  doc.setTextColor(165, 180, 252); doc.setFontSize(8.5);
  doc.text('M A C H I N A   R E Z E R W A C J I', mX, 34);
  doc.setTextColor(255, 255, 255); doc.setFontSize(23);
  doc.text('Raport prowizji', mX, 62);
  doc.setTextColor(226, 232, 255); doc.setFontSize(12);
  if (property?.name) doc.text(property.name, mX, 82);
  doc.setTextColor(213, 219, 255); doc.setFontSize(9);
  const meta = `Wygenerowano: ${today}      Stawka: ${fmtPct(ratePercent)}%      Raport za okres: ${monthPeriodLabel(countFrom, rows)}`;
  doc.text(meta, mX, 100);

  // ── KPI cards ──
  const tableW = pageW - 2 * mX;
  const gap = 14, kpiW = (tableW - 2 * gap) / 3, kpiY = bannerH + 16, kpiH = 50;
  const card = (x: number, label: string, value: string, accent: boolean) => {
    if (accent) { doc.setFillColor(79, 70, 229); doc.setDrawColor(79, 70, 229); }
    else { doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240); }
    doc.setLineWidth(0.8);
    doc.roundedRect(x, kpiY, kpiW, kpiH, 6, 6, 'FD');
    doc.setFontSize(7.5);
    doc.setTextColor(accent ? 199 : 100, accent ? 210 : 116, accent ? 254 : 139);
    doc.text(label.toUpperCase(), x + 12, kpiY + 18);
    doc.setFontSize(15);
    doc.setTextColor(accent ? 255 : 30, accent ? 255 : 41, accent ? 255 : 59);
    doc.text(value, x + 12, kpiY + 38);
  };
  card(mX, 'Rezerwacje', String(rows.length), false);
  card(mX + kpiW + gap, 'Suma sprzedaży', `${fmtPLN(totalPrice)} ${currency}`, false);
  card(mX + 2 * (kpiW + gap), 'Suma prowizji', `${fmtPLN(totalCommission)} ${currency}`, true);

  const body = rows.map((r, i) => {
    const showRoom = i === 0 || r.room !== rows[i - 1].room;
    return [
      showRoom ? r.room : '',
      r.reservation,
      `${r.arrival} – ${r.departure}`,
      (r.addDate || '').split(' ')[0],
      `${r.firstName} ${r.lastName}`.trim(),
      r.source,
      String(r.adults),
      String(r.children),
      fmtPLN(r.price),
      fmtPLN(r.commission),
    ];
  });

  autoTable(doc, {
    startY: kpiY + kpiH + 18,
    theme: 'striped',
    head: [['Kwatera', 'Nr rez.', 'Pobyt', 'Dodano', 'Gość', 'Źródło', 'Doro.', 'Dzieci', `Cena (${currency})`, `Prowizja (${currency})`]],
    body,
    foot: [[
      { content: `SUMA · ${rows.length} rezerwacji`, colSpan: 8, styles: { halign: 'right' } },
      `${fmtPLN(totalPrice)}`,
      `${fmtPLN(totalCommission)}`,
    ]],
    styles: { font: 'Roboto', fontStyle: 'normal', fontSize: 8.5, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 }, textColor: INK.slate, valign: 'middle', lineWidth: 0 },
    headStyles: { font: 'Roboto', fontStyle: 'normal', fillColor: INK.indigo, textColor: 255, fontSize: 8.5, cellPadding: { top: 7, bottom: 7, left: 6, right: 6 } },
    footStyles: { font: 'Roboto', fontStyle: 'normal', fillColor: INK.indigoBg, textColor: INK.indigoDark, fontSize: 10, cellPadding: { top: 8, bottom: 8, left: 6, right: 6 } },
    alternateRowStyles: { fillColor: [246, 247, 251] },
    columnStyles: {
      0: { textColor: INK.indigoDark, cellWidth: 86 },
      6: { halign: 'center' }, 7: { halign: 'center' },
      8: { halign: 'right' }, 9: { halign: 'right', textColor: INK.indigoDark },
    },
    margin: { left: mX, right: mX },
    // Clear divider line at the start of each new kwatera group.
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 0 && data.row.index > 0 && data.cell.raw) {
        doc.setDrawColor(165, 180, 252); doc.setLineWidth(1);
        doc.line(mX, data.cell.y, pageW - mX, data.cell.y);
      }
    },
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight();
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5);
      doc.line(mX, h - 26, pageW - mX, h - 26);
      doc.setFont('Roboto', 'normal'); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
      doc.text('Twoje Pokoje · Machina Rezerwacji', mX, h - 14);
      doc.text(`Strona ${(doc as any).internal.getNumberOfPages()}`, pageW - mX, h - 14, { align: 'right' });
    },
  });

  doc.save(`Prowizje_${sanitize(property?.name ?? '')}_${today.replace(/\./g, '-')}.pdf`);
}
