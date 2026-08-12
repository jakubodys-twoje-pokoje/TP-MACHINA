import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle, Ban, CheckCircle2, Database, Download, FileJson, HardDrive, History,
  Loader2, PlugZap, RefreshCw, Timer, XCircle, Zap,
} from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import type { Property } from '../types';
import {
  API_BASE, COUNT_LABELS, ServiceOfflineError, exportJsonUrl, fetchCatalogue, fetchRuns,
  fetchSnapshot, formatDuration, pingService, streamExport,
  type Catalogue, type ProgressLevel, type RunRow, type RunSummary, type SnapshotCounts,
} from '../services/hotresExport';

interface LogEntry {
  message: string;
  level: ProgressLevel;
  time: string;
}

const LEVEL_STYLES: Record<ProgressLevel, string> = {
  info: 'text-slate-400',
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const STATUS_STYLES: Record<string, string> = {
  ok: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  error: 'text-red-400 bg-red-500/10 border-red-500/30',
  aborted: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  running: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
};

export const HotresExportView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();

  const [property, setProperty] = useState<Property | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [serviceUp, setServiceUp] = useState<boolean | null>(null);

  const [oid, setOid] = useState('');
  const [langs, setLangs] = useState<string[]>(['pl']);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [withDetails, setWithDetails] = useState(true);
  const [delayMs, setDelayMs] = useState(350);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [log, setLog] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [counts, setCounts] = useState<SnapshotCounts | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // --- ładowanie kontekstu -------------------------------------------------

  useEffect(() => {
    if (!propertyId) return;
    supabase.from('properties').select('*').eq('id', propertyId).single()
      .then(({ data }) => {
        setProperty(data as Property | null);
        if (data?.hotres_id) setOid(String(data.hotres_id));
      });
  }, [propertyId]);

  useEffect(() => {
    let alive = true;
    pingService().then(up => {
      if (!alive) return;
      setServiceUp(up);
      if (!up) return;
      fetchCatalogue()
        .then(loaded => {
          if (!alive) return;
          setCatalogue(loaded);
          setSelected(new Set(loaded.groups.map(group => group.key)));
        })
        .catch(error => alive && setFatalError(error.message));
    });
    return () => {
      alive = false;
    };
  }, []);

  const refreshDbState = useCallback(async (targetOid: string) => {
    if (!targetOid) return;
    try {
      const [snapshot, history] = await Promise.all([
        fetchSnapshot(targetOid),
        fetchRuns(targetOid),
      ]);
      setCounts(snapshot?.counts ?? null);
      setRuns(history);
    } catch (error: any) {
      if (error instanceof ServiceOfflineError) setServiceUp(false);
    }
  }, []);

  useEffect(() => {
    if (serviceUp && oid) void refreshDbState(oid);
  }, [serviceUp, oid, refreshDbState]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // --- pochodne ------------------------------------------------------------

  const estimatedRequests = useMemo(() => {
    if (!catalogue) return 0;
    return catalogue.groups
      .filter(group => selected.has(group.key))
      .reduce((sum, group) => sum + (group.lang ? langs.length : 1), 0);
  }, [catalogue, selected, langs]);

  const hasDetailGroups = useMemo(
    () =>
      Boolean(catalogue?.groups.some(group => group.detailAction && selected.has(group.key))),
    [catalogue, selected],
  );

  const percent = progress.total > 0
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : 0;

  const hardErrors = summary?.errors.filter(error => !error.soft) ?? [];
  const softErrors = summary?.errors.filter(error => error.soft) ?? [];

  // --- akcje ---------------------------------------------------------------

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleLang = (lang: string) =>
    setLangs(prev => (prev.includes(lang) ? prev.filter(item => item !== lang) : [...prev, lang]));

  const handleRun = async () => {
    if (!oid.trim()) return setFatalError('Podaj OID obiektu w Hotres.');
    if (langs.length === 0) return setFatalError('Wybierz co najmniej jeden język.');
    if (selected.size === 0) return setFatalError('Zaznacz co najmniej jedną grupę danych.');

    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setFatalError(null);
    setSummary(null);
    setLog([]);
    setProgress({ completed: 0, total: 0 });

    const append = (message: string, level: ProgressLevel) =>
      setLog(prev => [...prev, { message, level, time: new Date().toLocaleTimeString('pl-PL') }]);

    try {
      const request = {
        oid: oid.trim(),
        langs,
        groups: [...selected],
        withDetails,
        delayMs,
      };

      for await (const event of streamExport(request, controller.signal)) {
        if (event.type === 'progress') {
          if (event.total > 0) setProgress({ completed: event.completed, total: event.total });
          append(event.message, event.level);
        } else if (event.type === 'done') {
          setSummary(event.summary);
          setCounts(event.counts);
          append(
            `Zapisano w bazie: ${event.summary.stats.reduce((sum, s) => sum + s.written, 0)} rekordów`,
            event.summary.status === 'ok' ? 'ok' : 'warn',
          );
        } else {
          setFatalError(event.message);
          append(event.message, 'error');
        }
      }

      await refreshDbState(oid.trim());
    } catch (error: any) {
      if (error?.name === 'AbortError') append('Przerwano przez użytkownika.', 'warn');
      else {
        setFatalError(error.message || String(error));
        if (error instanceof ServiceOfflineError) setServiceUp(false);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  // --- serwis offline ------------------------------------------------------

  if (serviceUp === false) {
    return (
      <div className="p-3 sm:p-4 lg:p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <Database className="text-indigo-400" size={22} />
          <h1 className="text-xl sm:text-2xl font-bold text-white">Eksport z Hotres</h1>
        </div>
        <p className="text-slate-400 text-sm mb-5">{property?.name ?? '…'}</p>

        <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-5">
          <div className="flex items-center gap-2 text-amber-300 font-semibold mb-3">
            <PlugZap size={18} /> Serwis eksportera nie odpowiada
          </div>
          <p className="text-sm text-slate-400 mb-4">
            To narzędzie zapisuje dane do lokalnej bazy Prisma (SQLite), a nie do Supabase.
            Uruchom serwis obok Machiny:
          </p>
          <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[12px] text-slate-300 font-mono overflow-x-auto">
{`cd server
npm install
npm run db:push
npm run dev`}
          </pre>
          <p className="text-xs text-slate-500 mt-3">
            Oczekiwany adres: <span className="font-mono text-slate-400">{API_BASE}</span>.
            Inny port ustawisz zmienną <span className="font-mono">VITE_EKSPORTER_API</span>.
          </p>
          <button
            type="button"
            onClick={() => {
              setServiceUp(null);
              pingService().then(setServiceUp);
            }}
            className="mt-4 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
          >
            <RefreshCw size={15} /> Sprawdź ponownie
          </button>
        </div>
      </div>
    );
  }

  if (serviceUp === null || !catalogue) {
    return (
      <div className="p-6 flex items-center justify-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={20} /> Łączę z serwisem eksportera…
      </div>
    );
  }

  // --- widok właściwy ------------------------------------------------------

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Database className="text-indigo-400" size={22} />
        <h1 className="text-xl sm:text-2xl font-bold text-white">Eksport z Hotres</h1>
        <span className="ml-1 inline-flex items-center gap-1 text-[10px] uppercase font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
          <PlugZap size={10} /> serwis działa
        </span>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        {property?.name ?? '…'}
        {oid && <span className="ml-2 font-mono text-xs text-slate-500">OID {oid}</span>}
      </p>

      {/* Zakres */}
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 mb-5">
        <div className="flex items-center gap-2 text-indigo-300 font-semibold mb-2 text-sm">
          <FileJson size={16} /> Zrzut do lokalnej bazy pod migrację na własny PMS
        </div>
        <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
          Serwis pobiera <strong className="text-slate-200">statyczne</strong> dane obiektu
          i rozkłada je na znormalizowane tabele w SQLite (Prisma). Powtórny eksport aktualizuje
          rekordy zamiast je duplikować.
        </p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {catalogue.excluded.map(item => (
            <span
              key={item.action}
              title={item.reason}
              className="inline-flex items-center gap-1 bg-slate-900/70 border border-slate-700 text-slate-500 text-[10px] font-mono px-2 py-1 rounded"
            >
              <Ban size={10} /> {item.action}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-2">
          Powyższe pomijamy świadomie - dostępność, ceny i dane transakcyjne lecą osobnym eksportem.
        </p>
      </div>

      {/* Stan bazy */}
      {counts && (
        <div className="bg-surface border border-border rounded-xl p-4 mb-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2">
              <HardDrive size={15} className="text-slate-400" /> Co siedzi w bazie
            </h2>
            <a
              href={exportJsonUrl(oid)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors self-start"
            >
              <Download size={15} /> Pobierz export.json
            </a>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {(Object.entries(counts) as [string, number][]).map(([key, value]) => (
              <div key={key} className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
                <div className="text-[10px] uppercase text-slate-500 font-bold truncate">
                  {COUNT_LABELS[key] ?? key}
                </div>
                <div className={`text-lg font-bold ${value > 0 ? 'text-white' : 'text-slate-600'}`}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Konfiguracja */}
      <div className="bg-surface border border-border rounded-xl p-4 mb-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">OID obiektu</label>
            <input
              type="text"
              value={oid}
              onChange={event => setOid(event.target.value)}
              disabled={running}
              placeholder="np. 4268"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white font-mono outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
              Odstęp między zapytaniami
            </label>
            <select
              value={delayMs}
              onChange={event => setDelayMs(Number(event.target.value))}
              disabled={running}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              <option value={150}>150 ms - szybko</option>
              <option value={350}>350 ms - bezpiecznie</option>
              <option value={800}>800 ms - wolno</option>
              <option value={1500}>1500 ms - bardzo wolno</option>
            </select>
            <p className="text-[10px] text-slate-500 mt-1">Hotres limituje liczbę zapytań na godzinę.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Szczegóły</label>
            <button
              type="button"
              onClick={() => setWithDetails(value => !value)}
              disabled={running}
              className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-lg border text-sm transition-colors disabled:opacity-50 ${
                withDetails
                  ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-300'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              <span>{withDetails ? 'Dociągaj szczegóły' : 'Tylko listy'}</span>
              <span
                className={`w-9 h-5 rounded-full flex items-center px-0.5 transition-colors ${
                  withDetails ? 'bg-indigo-600 justify-end' : 'bg-slate-700 justify-start'
                }`}
              >
                <span className="w-4 h-4 bg-white rounded-full" />
              </span>
            </button>
            <p className="text-[10px] text-slate-500 mt-1">
              Opisy, pełne galerie i meta dla standardów, cenników, voucherów i biletów.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Języki treści</label>
          <div className="flex flex-wrap gap-1.5">
            {catalogue.langs.map(lang => {
              const active = langs.includes(lang);
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={() => toggleLang(lang)}
                  disabled={running}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium uppercase border transition-colors disabled:opacity-50 ${
                    active
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  {lang}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500 mt-1.5">
            Pierwszy język jest kanoniczny - z niego biorą się wartości bazowe rekordów.
            Pozostałe lądują w tabelach tłumaczeń.
          </p>
        </div>
      </div>

      {/* Grupy */}
      <div className="bg-surface border border-border rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide">Zakres danych</h2>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setSelected(new Set(catalogue.groups.map(group => group.key)))}
              disabled={running}
              className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
            >
              Zaznacz wszystko
            </button>
            <span className="text-slate-600">|</span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={running}
              className="text-slate-400 hover:text-white disabled:opacity-50"
            >
              Wyczyść
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {catalogue.groups.map(group => {
            const active = selected.has(group.key);
            const stat = summary?.stats.find(item => item.group === group.key);
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => toggle(setSelected, group.key)}
                disabled={running}
                className={`text-left p-3 rounded-lg border transition-colors disabled:opacity-60 ${
                  active ? 'bg-slate-900 border-indigo-500/40' : 'bg-slate-900/40 border-slate-700 hover:border-slate-600'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border ${
                      active ? 'bg-indigo-600 border-indigo-500' : 'border-slate-600'
                    }`}
                  >
                    {active && <CheckCircle2 size={12} className="text-white" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${active ? 'text-white' : 'text-slate-400'}`}>
                        {group.label}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">{group.action}</span>
                      {group.lang && (
                        <span className="text-[9px] uppercase bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                          wielojęzyczne
                        </span>
                      )}
                      {stat && (
                        <span className="text-[10px] font-bold text-emerald-400">
                          {stat.written} zapisanych
                          {stat.removed > 0 && (
                            <span className="text-amber-400"> · {stat.removed} usuniętych</span>
                          )}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{group.description}</p>
                    {group.detailAction && (
                      <p className="text-[10px] text-slate-600 mt-1 font-mono">+ {group.detailAction}</p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Uruchomienie */}
      <div className="bg-surface border border-border rounded-xl p-4 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white py-3 rounded-xl font-medium shadow-lg shadow-indigo-900/20 transition-all active:scale-[0.99] flex items-center justify-center gap-2"
          >
            {running ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
            {running ? 'Pobieram i zapisuję…' : 'Pobierz z Hotres do bazy'}
          </button>
          {running && (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="px-4 py-3 rounded-xl border border-red-500/40 text-red-400 hover:bg-red-500/10 text-sm font-medium transition-colors"
            >
              Przerwij
            </button>
          )}
          <div className="text-xs text-slate-500 sm:text-right sm:min-w-[170px]">
            <div className="flex items-center gap-1.5 sm:justify-end">
              <Timer size={12} />
              ok. {estimatedRequests} zapytań{hasDetailGroups && withDetails ? ' + szczegóły' : ''}
            </div>
            <div className="sm:text-right mt-0.5">
              {selected.size} grup · {langs.length} jęz.
            </div>
          </div>
        </div>

        {(running || progress.total > 0) && (
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>{progress.completed} / {progress.total} zapytań</span>
              <span>{percent}%</span>
            </div>
            <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {log.length > 0 && (
          <div className="mt-4 bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-56 overflow-y-auto custom-scrollbar font-mono text-[11px] space-y-0.5">
            {log.map((entry, index) => (
              <div key={index} className="flex gap-2">
                <span className="text-slate-600 flex-shrink-0">{entry.time}</span>
                <span className={`${LEVEL_STYLES[entry.level]} break-words`}>{entry.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {fatalError && (
          <div className="mt-4 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
            <XCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span className="break-words">{fatalError}</span>
          </div>
        )}
      </div>

      {/* Podsumowanie przebiegu */}
      {summary && (
        <div className="bg-surface border border-border rounded-xl p-4 mb-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-bold text-white uppercase tracking-wide">
              Przebieg #{summary.runId}
            </h2>
            <span
              className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                STATUS_STYLES[summary.status] ?? STATUS_STYLES.running
              }`}
            >
              {summary.status}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Zapytania', value: summary.requests },
              { label: 'Czas', value: formatDuration(summary.durationMs) },
              {
                label: 'Zapisane',
                value: summary.stats.reduce((sum, stat) => sum + stat.written, 0),
              },
              {
                label: 'Błędy',
                value: `${hardErrors.length} / ${softErrors.length} lekkich`,
                danger: hardErrors.length > 0,
              },
            ].map(tile => (
              <div key={tile.label} className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                <div className="text-[10px] uppercase text-slate-500 font-bold">{tile.label}</div>
                <div className={`text-sm font-bold mt-1 ${tile.danger ? 'text-red-400' : 'text-white'}`}>
                  {tile.value}
                </div>
              </div>
            ))}
          </div>

          {summary.unmapped.length > 0 && (
            <div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-3">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-bold uppercase mb-2">
                <AlertTriangle size={14} /> Hotres zwrócił pola, których schemat nie zna
                ({summary.unmapped.length})
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                {summary.unmapped.map((item, index) => (
                  <div key={index} className="text-[11px] flex gap-2">
                    <span className="font-mono text-amber-400 flex-shrink-0">
                      {item.group}.{item.field}
                    </span>
                    <span className="text-slate-500 break-words truncate">{item.sample}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                Te wartości nie trafiły do żadnej kolumny. Jeśli są potrzebne, trzeba dodać je
                do schematu Prismy i mapperów.
              </p>
            </div>
          )}

          {summary.errors.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase mb-2">
                <AlertTriangle size={14} /> Błędy ({summary.errors.length})
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                {summary.errors.map((error, index) => (
                  <div key={index} className="text-[11px] flex gap-2">
                    <span className={`font-mono flex-shrink-0 ${error.soft ? 'text-slate-500' : 'text-red-400'}`}>
                      {error.action}{error.hotresId ? `/${error.hotresId}` : ''}
                      {error.lang ? ` [${error.lang}]` : ''}
                    </span>
                    <span className="text-slate-400 break-words">{error.message}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                Szare są nieblokujące (endpoint opcjonalny albo usunięty element).
                Po twardym błędzie grupy nic nie jest kasowane z bazy.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Historia */}
      {runs.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide flex items-center gap-2 mb-3">
            <History size={15} className="text-slate-400" /> Historia przebiegów
          </h2>
          <div className="space-y-1.5">
            {runs.map(entry => (
              <div
                key={entry.id}
                className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-center gap-3 flex-wrap"
              >
                <span className="text-[11px] font-mono text-slate-500">#{entry.id}</span>
                <span
                  className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                    STATUS_STYLES[entry.status] ?? STATUS_STYLES.running
                  }`}
                >
                  {entry.status}
                </span>
                <span className="text-[11px] text-slate-400">
                  {new Date(entry.startedAt).toLocaleString('pl-PL')}
                </span>
                <span className="text-[11px] text-slate-500">
                  {entry.requests} zapytań · {formatDuration(entry.durationMs)}
                </span>
                <span className="text-[11px] text-slate-500 uppercase">{entry.langs}</span>
                <span className="ml-auto text-[11px] text-slate-400">
                  {entry.stats.reduce((sum, stat) => sum + stat.written, 0)} rekordów
                  {entry._count.errors > 0 && (
                    <span className="text-amber-400"> · {entry._count.errors} błędów</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
