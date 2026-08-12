import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Ban, CheckCircle2, Download, History, Loader2, Timer, XCircle, Zap,
} from 'lucide-react';
import { Card, Empty, PageHeader } from '../ui';
import { exportJsonUrl, getRuns, streamExport, type Catalogue, type ProgressLevel, type RunSummary } from '../api';
import { formatDuration } from '../helpers';

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

export const ExportView: React.FC<{
  catalogue: Catalogue;
  oid: string;
  onOidChange: (oid: string) => void;
  onFinished: (oid: string) => void;
}> = ({ catalogue, oid, onOidChange, onFinished }) => {
  const [langs, setLangs] = useState<string[]>(['pl']);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(catalogue.groups.map(group => group.key)),
  );
  const [withDetails, setWithDetails] = useState(true);
  const [delayMs, setDelayMs] = useState(350);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [log, setLog] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (oid) getRuns(oid).then(setRuns).catch(() => setRuns([]));
  }, [oid]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [log]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const estimated = useMemo(
    () =>
      catalogue.groups
        .filter(group => selected.has(group.key))
        .reduce((sum, group) => sum + (group.lang ? langs.length : 1), 0),
    [catalogue.groups, selected, langs],
  );

  const percent = progress.total > 0
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : 0;

  const hardErrors = summary?.errors.filter(item => !item.soft) ?? [];
  const softErrors = summary?.errors.filter(item => item.soft) ?? [];

  const run = async () => {
    if (!oid.trim()) return setError('Podaj OID obiektu w Hotres.');
    if (langs.length === 0) return setError('Wybierz co najmniej jeden język.');
    if (selected.size === 0) return setError('Zaznacz co najmniej jedną grupę danych.');

    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setError(null);
    setSummary(null);
    setLog([]);
    setProgress({ completed: 0, total: 0 });

    const append = (message: string, level: ProgressLevel) =>
      setLog(prev => [...prev, { message, level, time: new Date().toLocaleTimeString('pl-PL') }]);

    try {
      for await (const event of streamExport(
        { oid: oid.trim(), langs, groups: [...selected], withDetails, delayMs },
        controller.signal,
      )) {
        if (event.type === 'progress') {
          if (event.total > 0) setProgress({ completed: event.completed, total: event.total });
          append(event.message, event.level);
        } else if (event.type === 'done') {
          setSummary(event.summary);
          append('Dane są w bazie - przejdź do widoków po lewej.', 'ok');
        } else {
          setError(event.message);
          append(event.message, 'error');
        }
      }
      getRuns(oid.trim()).then(setRuns).catch(() => {});
      // Oddajemy OID, na którym faktycznie poszedł eksport - stan w App mógłby
      // być inny, gdyby ktoś w międzyczasie ruszył pole.
      onFinished(oid.trim());
    } catch (err: any) {
      if (err?.name === 'AbortError') append('Przerwano przez użytkownika.', 'warn');
      else setError(err.message ?? String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div>
      <PageHeader
        title="Pobieranie z Hotres"
        subtitle="Tu ściągasz dane obiektu do lokalnej bazy. Potem czytasz je z widoków po lewej i przepisujesz do nowego PMS-a. Ponowne pobranie aktualizuje dane, nie duplikuje ich."
      >
        {oid && (
          <a
            href={exportJsonUrl(oid)}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors"
          >
            <Download size={15} /> Pobierz JSON
          </a>
        )}
      </PageHeader>

      <Card title="Czego NIE pobieramy">
        <div className="flex flex-wrap gap-1.5">
          {catalogue.excluded.map(item => (
            <span
              key={item.action}
              className="inline-flex items-center gap-1.5 bg-slate-900 border border-slate-800 text-slate-500 text-[11px] px-2.5 py-1.5 rounded"
            >
              <Ban size={11} />
              <span className="font-mono">{item.action}</span>
              <span className="text-slate-600">— {item.reason}</span>
            </span>
          ))}
        </div>
      </Card>

      <Card title="Ustawienia">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
              OID obiektu w Hotres
            </label>
            <input
              type="text"
              value={oid}
              onChange={event => onOidChange(event.target.value.trim())}
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
            <p className="text-[10px] text-slate-500 mt-1">Hotres limituje zapytania na godzinę.</p>
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
              <span>{withDetails ? 'Z opisami i galeriami' : 'Tylko listy'}</span>
              <span
                className={`w-9 h-5 rounded-full flex items-center px-0.5 transition-colors ${
                  withDetails ? 'bg-indigo-600 justify-end' : 'bg-slate-700 justify-start'
                }`}
              >
                <span className="w-4 h-4 bg-white rounded-full" />
              </span>
            </button>
          </div>
        </div>

        <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Języki</label>
        <div className="flex flex-wrap gap-1.5 mb-1">
          {catalogue.langs.map(lang => (
            <button
              key={lang}
              type="button"
              onClick={() =>
                setLangs(prev =>
                  prev.includes(lang) ? prev.filter(item => item !== lang) : [...prev, lang],
                )
              }
              disabled={running}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase border transition-colors disabled:opacity-50 ${
                langs.includes(lang)
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              {lang}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          Pierwszy wybrany język jest główny - z niego biorą się wartości podstawowe. Reszta trafia
          do zakładek językowych przy opisach.
        </p>
      </Card>

      <Card
        title="Zakres danych"
        right={
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
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {catalogue.groups.map(group => {
            const active = selected.has(group.key);
            const stat = summary?.stats.find(item => item.group === group.key);
            return (
              <button
                key={group.key}
                type="button"
                onClick={() =>
                  setSelected(prev => {
                    const next = new Set(prev);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })
                }
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
                      {stat && (
                        <span className="text-[10px] font-bold text-emerald-400">
                          {stat.written} zapisanych
                          {stat.removed > 0 && (
                            <span className="text-amber-400"> · {stat.removed} usuniętych</span>
                          )}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                      {group.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-400 text-white py-3 rounded-xl font-medium shadow-lg shadow-indigo-900/20 transition-all active:scale-[0.99] flex items-center justify-center gap-2"
          >
            {running ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
            {running ? 'Pobieram i zapisuję…' : 'Pobierz z Hotres'}
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
          <div className="text-xs text-slate-500 sm:text-right sm:min-w-[160px] flex items-center gap-1.5 sm:justify-end">
            <Timer size={12} /> ok. {estimated} zapytań
          </div>
        </div>

        {(running || progress.total > 0) && (
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-slate-400 mb-1">
              <span>{progress.completed} / {progress.total} zapytań</span>
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
          <div className="mt-4 bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-[11px] space-y-0.5">
            {log.map((entry, index) => (
              <div key={index} className="flex gap-2">
                <span className="text-slate-600 flex-shrink-0">{entry.time}</span>
                <span className={`${LEVEL_STYLES[entry.level]} break-words`}>{entry.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
            <XCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}
      </Card>

      {summary && (
        <Card
          title={`Przebieg #${summary.runId}`}
          right={
            <span
              className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                STATUS_STYLES[summary.status] ?? STATUS_STYLES.running
              }`}
            >
              {summary.status}
            </span>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {[
              { label: 'Zapytania', value: summary.requests },
              { label: 'Czas', value: formatDuration(summary.durationMs) },
              { label: 'Zapisane', value: summary.stats.reduce((sum, s) => sum + s.written, 0) },
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
            <div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-3 mb-3">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-bold uppercase mb-2">
                <AlertTriangle size={14} /> Hotres zwrócił pola, których nie znamy ({summary.unmapped.length})
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {summary.unmapped.map((item, index) => (
                  <div key={index} className="text-[11px] flex gap-2">
                    <span className="font-mono text-amber-400 flex-shrink-0">
                      {item.group}.{item.field}
                    </span>
                    <span className="text-slate-500 truncate">{item.sample}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                Tych wartości nie ma w widokach - trzeba dodać je do schematu bazy i opisów pól.
              </p>
            </div>
          )}

          {summary.errors.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase mb-2">
                <AlertTriangle size={14} /> Błędy ({summary.errors.length})
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {summary.errors.map((item, index) => (
                  <div key={index} className="text-[11px] flex gap-2">
                    <span className={`font-mono flex-shrink-0 ${item.soft ? 'text-slate-500' : 'text-red-400'}`}>
                      {item.action}{item.hotresId ? `/${item.hotresId}` : ''}
                    </span>
                    <span className="text-slate-400 break-words">{item.message}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                Szare są nieblokujące. Po twardym błędzie grupy nic nie jest kasowane z bazy.
              </p>
            </div>
          )}
        </Card>
      )}

      <Card title="Historia pobrań">
        {runs.length === 0 ? (
          <Empty text="Ten obiekt nie był jeszcze pobierany" />
        ) : (
          <div className="space-y-1.5">
            {runs.map(entry => (
              <div
                key={entry.id}
                className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-center gap-3 flex-wrap text-[11px]"
              >
                <History size={13} className="text-slate-600" />
                <span className="font-mono text-slate-500">#{entry.id}</span>
                <span
                  className={`uppercase font-bold px-2 py-0.5 rounded border ${
                    STATUS_STYLES[entry.status] ?? STATUS_STYLES.running
                  }`}
                >
                  {entry.status}
                </span>
                <span className="text-slate-400">
                  {new Date(entry.startedAt).toLocaleString('pl-PL')}
                </span>
                <span className="text-slate-500">
                  {entry.requests} zapytań · {formatDuration(entry.durationMs)} · {entry.langs}
                </span>
                <span className="ml-auto text-slate-400">
                  {(entry.stats ?? []).reduce((sum: number, stat: any) => sum + stat.written, 0)} rekordów
                  {entry._count?.errors > 0 && (
                    <span className="text-amber-400"> · {entry._count.errors} błędów</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
