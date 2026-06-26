import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import type { Property, CommissionReport } from '../types';
import {
  parseSaleReport, buildReport, getCommissionRate, saveCommissionRate,
  listReports, saveReport, deleteReport, buildReportHtml, exportReportPdf, fmtPLN,
  type RawReservation,
} from '../services/commission';
import { Loader2, Upload, FileDown, Save, Trash2, Percent, Calculator } from 'lucide-react';

export const CommissionView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [ratePercent, setRatePercent] = useState<number>(0);
  const [savingRate, setSavingRate] = useState(false);
  const [countFrom, setCountFrom] = useState<string>('');
  const [raw, setRaw] = useState<RawReservation[] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [history, setHistory] = useState<CommissionReport[]>([]);
  const [historyView, setHistoryView] = useState<CommissionReport | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    supabase.from('properties').select('*').eq('id', propertyId).single().then(({ data }) => setProperty(data));
    getCommissionRate(propertyId).then(setRatePercent).catch(() => {});
    listReports(propertyId).then(setHistory).catch(() => {});
  }, [propertyId]);

  const live = useMemo(
    () => (raw ? buildReport(raw, ratePercent, countFrom || null) : null),
    [raw, ratePercent, countFrom],
  );

  // Displayed report: a loaded historical snapshot wins, otherwise the live computation.
  const rows = historyView ? historyView.rows : (live?.rows ?? []);
  const totalPrice = historyView ? historyView.total_price : (live?.totalPrice ?? 0);
  const totalCommission = historyView ? historyView.total_commission : (live?.totalCommission ?? 0);
  const viewRate = historyView ? historyView.rate_percent : ratePercent;
  const viewCountFrom = historyView ? historyView.count_from : (countFrom || null);
  const currency = rows[0]?.currency || 'PLN';

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setHistoryView(null);
    try {
      const parsed = await parseSaleReport(file);
      setRaw(parsed);
      setFileName(file.name);
    } catch (err: any) {
      alert(`✗ ${err.message}`);
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  };

  const handleSaveRate = async () => {
    if (!propertyId) return;
    setSavingRate(true);
    try { await saveCommissionRate(propertyId, ratePercent); }
    catch (err: any) { alert(`✗ Błąd zapisu stawki: ${err.message}`); }
    finally { setSavingRate(false); }
  };

  const handleSaveReport = async () => {
    if (!propertyId || !live || live.rows.length === 0) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const label = `${fileName || 'raport'} · ${new Date().toLocaleDateString('pl-PL')}`;
      await saveReport({
        property_id: propertyId, label, count_from: countFrom || null, rate_percent: ratePercent,
        total_price: live.totalPrice, total_commission: live.totalCommission,
        reservation_count: live.count, rows: live.rows, created_by: user?.email ?? null,
      });
      setHistory(await listReports(propertyId));
      alert('✓ Raport zapisany w historii.');
    } catch (err: any) {
      alert(`✗ Błąd zapisu raportu: ${err.message}`);
    } finally { setSaving(false); }
  };

  const handleExport = () => {
    if (rows.length === 0) return;
    exportReportPdf(buildReportHtml({
      property, rows, totalPrice, totalCommission, ratePercent: viewRate, countFrom: viewCountFrom, currency,
    }));
  };

  const handleDeleteReport = async (id?: string) => {
    if (!id || !propertyId) return;
    if (!confirm('Usunąć ten zapisany raport?')) return;
    await deleteReport(id);
    setHistory(await listReports(propertyId));
    if (historyView?.id === id) setHistoryView(null);
  };

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Calculator className="text-teal-400" size={22} />
        <h1 className="text-xl sm:text-2xl font-bold text-white">Kalkulator prowizji</h1>
      </div>
      <p className="text-slate-400 text-sm mb-5">{property?.name ?? '…'}</p>

      {/* Controls */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Stawka prowizji (%)</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input type="number" min={0} step={0.5} value={ratePercent}
                onChange={(e) => { setHistoryView(null); setRatePercent(parseFloat(e.target.value) || 0); }}
                onBlur={handleSaveRate}
                className="w-full pl-2 pr-7 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-1 focus:ring-teal-500" />
              <Percent size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500" />
            </div>
            <button onClick={handleSaveRate} disabled={savingRate} title="Zapisz stawkę dla obiektu"
              className="px-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200">
              {savingRate ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            </button>
          </div>
          <p className="text-[10px] text-slate-500 mt-1">Zapamiętywana per obiekt. Prowizja = price × stawka%.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Licz prowizję od (add date)</label>
          <input type="date" value={countFrom}
            onChange={(e) => { setHistoryView(null); setCountFrom(e.target.value); }}
            className="w-full px-2 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:ring-1 focus:ring-teal-500" />
          <p className="text-[10px] text-slate-500 mt-1">Rezerwacje dodane przed tą datą są ukrywane.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">Plik raportu (.xls)</label>
          <label className="flex items-center justify-center gap-2 px-3 py-2 bg-teal-700 hover:bg-teal-600 rounded-lg text-white text-sm cursor-pointer">
            {parsing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            <span className="truncate">{fileName || 'Wgraj plik sprzedaży'}</span>
            <input type="file" accept=".xls,.html,.htm" className="hidden" onChange={handleFile} />
          </label>
          <p className="text-[10px] text-slate-500 mt-1">Format: raport sprzedaży (tabela). Kolumna „ota commission" jest pomijana.</p>
        </div>
      </div>

      {/* Actions */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg font-medium">
            <FileDown size={16} /> Eksportuj PDF
          </button>
          {!historyView && (
            <button onClick={handleSaveReport} disabled={saving}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg font-medium">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Zapisz raport
            </button>
          )}
          {historyView && (
            <span className="text-xs text-amber-300">Podgląd zapisanego raportu: {historyView.label}
              <button onClick={() => setHistoryView(null)} className="ml-2 underline">wróć do bieżącego</button>
            </span>
          )}
        </div>
      )}

      {/* Report table */}
      {rows.length > 0 ? (
        <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800 text-slate-300 text-xs">
                <th className="text-left px-3 py-2">Kwatera</th>
                <th className="text-left px-3 py-2">Nr rez.</th>
                <th className="text-left px-3 py-2">Pobyt</th>
                <th className="text-left px-3 py-2">Gość</th>
                <th className="text-left px-3 py-2">Źródło</th>
                <th className="text-right px-3 py-2">Cena</th>
                <th className="text-right px-3 py-2">Prowizja</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const showRoom = i === 0 || r.room !== rows[i - 1].room;
                return (
                  <tr key={i} className={`border-t ${showRoom && i > 0 ? 'border-slate-600' : 'border-slate-800'} hover:bg-slate-800/40`}>
                    <td className="px-3 py-1.5 font-semibold text-teal-300">{showRoom ? r.room : ''}</td>
                    <td className="px-3 py-1.5 text-slate-300">{r.reservation}</td>
                    <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{r.arrival} – {r.departure}</td>
                    <td className="px-3 py-1.5 text-slate-300">{`${r.firstName} ${r.lastName}`.trim()}</td>
                    <td className="px-3 py-1.5 text-slate-400">{r.source}</td>
                    <td className="px-3 py-1.5 text-right text-slate-200 whitespace-nowrap">{fmtPLN(r.price)}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-teal-300 whitespace-nowrap">{fmtPLN(r.commission)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-teal-900/30 border-t-2 border-teal-600 text-white font-bold">
                <td className="px-3 py-2.5" colSpan={5}>SUMA · {rows.length} rezerwacji</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">{fmtPLN(totalPrice)} {currency}</td>
                <td className="px-3 py-2.5 text-right text-teal-300 whitespace-nowrap">{fmtPLN(totalCommission)} {currency}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="text-center text-slate-500 py-10 border border-dashed border-slate-700 rounded-xl">
          Wgraj plik raportu sprzedaży, aby zobaczyć rozpisane rezerwacje i prowizję.
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-bold text-slate-300 mb-2">Historia raportów</h2>
          <div className="space-y-1.5">
            {history.map(h => (
              <div key={h.id} className="flex items-center justify-between bg-slate-800/40 border border-slate-700 rounded-lg px-3 py-2">
                <button onClick={() => setHistoryView(h)} className="text-left flex-1 min-w-0">
                  <div className="text-sm text-slate-200 truncate">{h.label}</div>
                  <div className="text-[11px] text-slate-500">
                    {h.reservation_count} rez. · stawka {h.rate_percent}% · prowizja {fmtPLN(h.total_commission)} · {h.created_at ? new Date(h.created_at).toLocaleString('pl-PL') : ''}
                  </div>
                </button>
                <button onClick={() => handleDeleteReport(h.id)} className="ml-2 text-slate-500 hover:text-red-400 p-1.5"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
