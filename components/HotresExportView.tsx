import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronRight, Database,
  Download, FileJson, Loader2, RefreshCw, Timer, XCircle, Zap,
} from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import type { Property } from '../types';
import {
  HOTRES_EXCLUDED, HOTRES_GROUPS, HOTRES_LANGS, downloadJson, exportFilename,
  groupAction, groupLabel, runHotresExport,
  type HotresExportResult, type HotresProgressLevel,
} from '../services/hotresExport';

interface LogEntry {
  message: string;
  level: HotresProgressLevel;
  time: string;
}

const LEVEL_STYLES: Record<HotresProgressLevel, string> = {
  info: 'text-slate-400',
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const ALL_GROUP_KEYS = HOTRES_GROUPS.map(group => group.key);

/** Liczba pozycji w danych grupy - obsługuje mapy per język i mapy szczegółów. */
function countItems(value: any, langs: string[]): number {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') {
    const first = langs.find(lang => value[lang] !== undefined);
    if (first !== undefined) return countItems(value[first], langs);
    return Object.keys(value).length;
  }
  return 1;
}

export const HotresExportView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();

  const [property, setProperty] = useState<Property | null>(null);
  const [oid, setOid] = useState('');
  const [langs, setLangs] = useState<string[]>(['pl']);
  const [selected, setSelected] = useState<Set<string>>(new Set(ALL_GROUP_KEYS));
  const [withDetails, setWithDetails] = useState(true);
  const [delayMs, setDelayMs] = useState(350);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [log, setLog] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<HotresExportResult | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    supabase.from('properties').select('*').eq('id', propertyId).single()
      .then(({ data }) => {
        setProperty(data as Property | null);
        if (data?.hotres_id) setOid(String(data.hotres_id));
      });
  }, [propertyId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log]);

  // Przerwij trwający eksport, jeśli użytkownik opuści widok.
  useEffect(() => () => abortRef.current?.abort(), []);

  const estimatedRequests = useMemo(() => {
    return HOTRES_GROUPS
      .filter(group => selected.has(group.key))
      .reduce((sum, group) => sum + (group.lang ? langs.length : 1), 0);
  }, [selected, langs]);

  const hasDetailGroups = useMemo(
    () => HOTRES_GROUPS.some(group => group.detail && selected.has(group.key)),
    [selected],
  );

  const toggleGroup = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleLang = (lang: string) => {
    setLangs(prev => (prev.includes(lang) ? prev.filter(item => item !== lang) : [...prev, lang]));
  };

  const toggleExpanded = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleRun = async () => {
    if (!oid.trim()) {
      setFatalError('Podaj OID obiektu w Hotres.');
      return;
    }
    if (langs.length === 0) {
      setFatalError('Wybierz co najmniej jeden język.');
      return;
    }
    if (selected.size === 0) {
      setFatalError('Zaznacz co najmniej jedną grupę danych.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setFatalError(null);
    setResult(null);
    setExpanded(new Set());
    setLog([]);
    setProgress({ completed: 0, total: 0 });

    try {
      const exported = await runHotresExport({
        oid: oid.trim(),
        propertyName: property?.name,
        langs,
        groups: [...selected],
        withDetails,
        delayMs,
        signal: controller.signal,
        onProgress: ({ completed, total, message, level }) => {
          setProgress({ completed, total });
          setLog(prev => [
            ...prev,
            { message, level, time: new Date().toLocaleTimeString('pl-PL') },
          ]);
        },
      });
      setResult(exported);
    } catch (error: any) {
      setFatalError(error.message || String(error));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => abortRef.current?.abort();

  const percent = progress.total > 0
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : 0;

  const dataKeys = result ? Object.keys(result.data) : [];
  const hardErrors = result?.errors.filter(error => !error.soft) ?? [];
  const softErrors = result?.errors.filter(error => error.soft) ?? [];

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-6xl mx-auto">
      {/* Nagłówek */}
      <div className="flex items-center gap-2 mb-1">
        <Database className="text-indigo-400" size={22} />
        <h1 className="text-xl sm:text-2xl font-bold text-white">Eksport z Hotres</h1>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        {property?.name ?? '…'}
        {oid && <span className="ml-2 font-mono text-xs text-slate-500">OID {oid}</span>}
      </p>

      {/* Zakres */}
      <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 mb-5 text-sm">
        <div className="flex items-center gap-2 text-indigo-300 font-semibold mb-2">
          <FileJson size={16} /> Zrzut danych obiektu do migracji na własny PMS
        </div>
        <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
          Pobiera wszystkie <strong className="text-slate-200">statyczne</strong> informacje z Hotres:
          obiekt, pokoje, standardy, dodatki, treści, słowniki. Wynik zapisujesz jako pliki JSON.
        </p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {HOTRES_EXCLUDED.map(item => (
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
              Opisy, pełne galerie i meta dla każdego standardu, cennika, vouchera i biletu.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Języki treści</label>
          <div className="flex flex-wrap gap-1.5">
            {HOTRES_LANGS.map(lang => {
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
        </div>
      </div>

      {/* Grupy danych */}
      <div className="bg-surface border border-border rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white uppercase tracking-wide">Zakres danych</h2>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setSelected(new Set(ALL_GROUP_KEYS))}
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
          {HOTRES_GROUPS.map(group => {
            const active = selected.has(group.key);
            const count = result?.counts[group.key];
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => toggleGroup(group.key)}
                disabled={running}
                className={`text-left p-3 rounded-lg border transition-colors disabled:opacity-60 ${
                  active
                    ? 'bg-slate-900 border-indigo-500/40'
                    : 'bg-slate-900/40 border-slate-700 hover:border-slate-600'
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
                      {typeof count === 'number' && (
                        <span className="text-[10px] font-bold text-emerald-400">{count} poz.</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{group.description}</p>
                    {group.detail && (
                      <p className="text-[10px] text-slate-600 mt-1 font-mono">+ {group.detail.action}</p>
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
            {running ? 'Pobieram z Hotres…' : 'Pobierz wszystko z Hotres'}
          </button>
          {running && (
            <button
              type="button"
              onClick={handleCancel}
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
              <span>{progress.completed} / {progress.total} kroków</span>
              <span>{percent}%</span>
            </div>
            <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
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

      {/* Wynik */}
      {result && (
        <div className="bg-surface border border-border rounded-xl p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wide">Wynik eksportu</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {new Date(result.exported_at).toLocaleString('pl-PL')} ·{' '}
                {(result.duration_ms / 1000).toFixed(1)} s · {result.requests} zapytań
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => downloadJson(exportFilename(result), result)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
              >
                <Download size={16} /> Pobierz all.json
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={running}
                className="border border-slate-700 hover:border-slate-600 text-slate-300 px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 transition-colors disabled:opacity-50"
                title="Pobierz ponownie"
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Grupy danych', value: dataKeys.length },
              { label: 'Zapytania', value: result.requests },
              { label: 'Języki', value: result.langs.join(', ').toUpperCase() },
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

          <div className="space-y-1.5">
            {dataKeys.map(key => {
              const value = result.data[key];
              const isOpen = expanded.has(key);
              const count = countItems(value, result.langs);
              const preview = JSON.stringify(value, null, 2);
              const truncated = preview.length > 40000;

              return (
                <div key={key} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(key)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      {isOpen
                        ? <ChevronDown size={14} className="text-slate-500 flex-shrink-0" />
                        : <ChevronRight size={14} className="text-slate-500 flex-shrink-0" />}
                      <span className="text-sm text-white font-medium truncate">{groupLabel(key)}</span>
                      <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
                        {groupAction(key)}
                      </span>
                      <span className="text-[11px] text-slate-400 ml-auto flex-shrink-0">{count} poz.</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadJson(exportFilename(result, key), value)}
                      className="text-slate-500 hover:text-indigo-400 transition-colors flex-shrink-0"
                      title={`Pobierz ${key}.json`}
                    >
                      <Download size={15} />
                    </button>
                  </div>
                  {isOpen && (
                    <pre className="border-t border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-300 font-mono overflow-auto max-h-96 custom-scrollbar">
                      {truncated ? `${preview.slice(0, 40000)}\n… (podgląd skrócony - pobierz JSON)` : preview}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>

          {result.errors.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase mb-2">
                <AlertTriangle size={14} /> Błędy ({result.errors.length})
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                {result.errors.map((error, index) => (
                  <div key={index} className="text-[11px] flex gap-2">
                    <span className={`font-mono flex-shrink-0 ${error.soft ? 'text-slate-500' : 'text-red-400'}`}>
                      {error.action}{error.id ? `/${error.id}` : ''}{error.lang ? ` [${error.lang}]` : ''}
                    </span>
                    <span className="text-slate-400 break-words">{error.message}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                Błędy oznaczone na szaro są nieblokujące (endpoint opcjonalny albo usunięty element).
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
