import React, { useMemo, useRef, useState } from 'react';
import {
  Check, ChevronRight, Clock, Loader2, Plus, StickyNote, Zap,
} from 'lucide-react';
import { Card, Empty, PageHeader, SearchBox } from '../ui';
import {
  MIGRATION_LABELS, setMigration, setMigrationStep, streamExport,
  type Catalogue, type MigrationStatus, type PropertyRow,
} from '../api';
import { matches, plural } from '../helpers';

/** 1 obiekt / 2 obiekty / 5 obiektów - inaczej przycisk czyta się koślawo. */
export const obiekty = (count: number) => plural(count, ['obiekt', 'obiekty', 'obiektów']);

type QueueStatus = 'czeka' | 'pobieram' | 'gotowe' | 'błąd';

interface QueueItem {
  oid: string;
  status: QueueStatus;
  message?: string;
  written?: number;
}

const STATUS_STYLES: Record<QueueStatus, string> = {
  czeka: 'bg-slate-800 text-slate-400',
  pobieram: 'bg-indigo-500/10 text-indigo-300',
  gotowe: 'bg-emerald-500/10 text-emerald-400',
  'błąd': 'bg-red-500/10 text-red-400',
};

const MIGRATION_STYLES: Record<MigrationStatus, string> = {
  todo: 'bg-slate-800 text-slate-400 border-slate-700',
  in_progress: 'bg-amber-500/10 text-amber-300 border-amber-500/40',
  done: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40',
  skipped: 'bg-slate-900 text-slate-600 border-slate-800',
};

const MIGRATION_ORDER: MigrationStatus[] = ['todo', 'in_progress', 'done', 'skipped'];

const RUN_STATUS_STYLES: Record<string, string> = {
  ok: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  error: 'text-red-400 bg-red-500/10 border-red-500/30',
  aborted: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
};

/** Rozbija wklejoną listę OID-ów: przecinki, spacje, nowe linie, średniki. */
export function parseOids(input: string): string[] {
  const found = input
    .split(/[\s,;]+/)
    .map(token => token.trim())
    .filter(token => /^\d+$/.test(token));
  return [...new Set(found)];
}

export const PropertiesView: React.FC<{
  properties: PropertyRow[];
  catalogue: Catalogue;
  activeOid: string;
  onOpen: (oid: string) => void;
  onRefresh: () => void;
}> = ({ properties, catalogue, activeOid, onOpen, onRefresh }) => {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<MigrationStatus | 'all'>('all');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const filtered = useMemo(
    () =>
      properties.filter(property => {
        if (statusFilter !== 'all' && property.migrationStatus !== statusFilter) return false;
        return (
          matches(property.label, query) ||
          matches(property.oid, query) ||
          matches(property.city, query) ||
          matches(property.companyName, query) ||
          matches(property.migrationNote, query)
        );
      }),
    [properties, query, statusFilter],
  );

  const { totalSteps, totalDoneSteps, overallPercent, fullyDone } = useMemo(() => {
    let steps = 0;
    let done = 0;
    let complete = 0;
    for (const property of properties) {
      steps += property.migrationStepCount;
      done += property.migrationDoneCount;
      if (property.migrationPercent === 100) complete++;
    }
    return {
      totalSteps: steps,
      totalDoneSteps: done,
      overallPercent: steps === 0 ? 0 : Math.round((done / steps) * 100),
      fullyDone: complete,
    };
  }, [properties]);

  const byStatus = useMemo(() => {
    const counts: Record<string, number> = { todo: 0, in_progress: 0, done: 0, skipped: 0 };
    for (const property of properties) counts[property.migrationStatus] = (counts[property.migrationStatus] ?? 0) + 1;
    return counts;
  }, [properties]);

  const changeStatus = async (oid: string, status: MigrationStatus) => {
    await setMigration(oid, { status });
    onRefresh();
  };

  const toggleStep = async (oid: string, step: string, done: boolean) => {
    await setMigrationStep(oid, step, done);
    onRefresh();
  };

  const saveNote = async (oid: string) => {
    await setMigration(oid, { note: noteDraft });
    setNoteFor(null);
    onRefresh();
  };

  const parsed = parseOids(bulkInput);
  const fresh = parsed.filter(oid => !properties.some(property => property.oid === oid));

  const runQueue = async () => {
    if (parsed.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setQueue(parsed.map(oid => ({ oid, status: 'czeka' })));

    // Obiekty lecą po kolei, nie równolegle - Hotres limituje zapytania
    // na godzinę i równoległość tylko przyspieszyłaby trafienie w limit.
    for (const [index, oid] of parsed.entries()) {
      if (controller.signal.aborted) break;

      setQueue(prev =>
        prev.map((item, position) => (position === index ? { ...item, status: 'pobieram' } : item)),
      );

      try {
        let written = 0;
        let failure: string | null = null;

        for await (const event of streamExport(
          { oid, langs: ['pl'], groups: catalogue.groups.map(group => group.key), withDetails: true, delayMs: 350 },
          controller.signal,
        )) {
          if (event.type === 'done') {
            written = event.summary.stats.reduce((sum, stat) => sum + stat.written, 0);
            const hard = event.summary.errors.filter(error => !error.soft);
            if (hard.length > 0) failure = hard[0].message;
          } else if (event.type === 'error') {
            failure = event.message;
          }
        }

        setQueue(prev =>
          prev.map((item, position) =>
            position === index
              ? failure
                ? { ...item, status: 'błąd', message: failure }
                : { ...item, status: 'gotowe', written }
              : item,
          ),
        );
      } catch (error: any) {
        if (error?.name === 'AbortError') break;
        setQueue(prev =>
          prev.map((item, position) =>
            position === index ? { ...item, status: 'błąd', message: error.message } : item,
          ),
        );
      }

      onRefresh();
    }

    setRunning(false);
    abortRef.current = null;
    onRefresh();
  };

  const done = queue.filter(item => item.status === 'gotowe').length;
  const failed = queue.filter(item => item.status === 'błąd').length;

  return (
    <div>
      <PageHeader
        title="Obiekty"
        count={properties.length}
        subtitle="Wszystko, co jest już pobrane do lokalnej bazy. Kliknij obiekt, żeby przeglądać jego dane - to czyta z bazy, nie z Hotresa."
      >
        <SearchBox value={query} onChange={setQuery} placeholder="Szukaj po nazwie, OID, mieście…" />
        <button
          type="button"
          onClick={() => setBulkOpen(value => !value)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
        >
          <Plus size={15} /> Dodaj obiekty
        </button>
      </PageHeader>

      {properties.length > 0 && (
        <div className="bg-surface border border-border rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="text-sm text-slate-300">
              Przepisane sekcje:{' '}
              <strong className="text-emerald-400">{overallPercent}%</strong>
              <span className="text-slate-500">
                {' '}({totalDoneSteps} z {totalSteps}) · obiekty gotowe w całości:{' '}
                {fullyDone} z {properties.length}
              </span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                  statusFilter === 'all'
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                wszystkie {properties.length}
              </button>
              {MIGRATION_ORDER.map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                    statusFilter === status
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : `${MIGRATION_STYLES[status]} hover:brightness-125`
                  }`}
                >
                  {MIGRATION_LABELS[status]} {byStatus[status] ?? 0}
                </button>
              ))}
            </div>
          </div>
          <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${overallPercent}%` }}
            />
          </div>
        </div>
      )}

      {bulkOpen && (
        <Card title="Pobierz wiele obiektów naraz">
          <p className="text-sm text-slate-400 mb-3">
            Wklej OID-y klientów - po przecinku, spacjami albo w kolumnie. Obiekty lecą jeden po
            drugim, bo Hotres limituje liczbę zapytań na godzinę.
          </p>
          <textarea
            value={bulkInput}
            onChange={event => setBulkInput(event.target.value)}
            disabled={running}
            rows={4}
            placeholder={'5279, 4268, 3311\nalbo każdy w nowej linii'}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-white font-mono outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          />

          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button
              type="button"
              onClick={runQueue}
              disabled={running || parsed.length === 0}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              {running ? `Pobieram ${done + failed + 1} z ${queue.length}…` : `Pobierz ${obiekty(parsed.length)}`}
            </button>

            {running && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="px-4 py-2.5 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-sm transition-colors"
              >
                Przerwij
              </button>
            )}

            <span className="text-xs text-slate-500">
              rozpoznane OID-y: <strong className="text-slate-300">{parsed.length}</strong>
              {fresh.length > 0 && <span className="text-indigo-400"> · nowych: {fresh.length}</span>}
            </span>
          </div>

          {queue.length > 0 && (
            <div className="mt-4 space-y-1">
              {queue.map(item => (
                <div
                  key={item.oid}
                  className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm"
                >
                  <span className="font-mono text-slate-300 w-16">{item.oid}</span>
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${STATUS_STYLES[item.status]}`}
                  >
                    {item.status}
                  </span>
                  {item.written !== undefined && (
                    <span className="text-xs text-slate-500">{item.written} rekordów</span>
                  )}
                  {item.message && (
                    <span className="text-xs text-red-400 truncate flex-1">{item.message}</span>
                  )}
                  {item.status === 'gotowe' && (
                    <button
                      type="button"
                      onClick={() => onOpen(item.oid)}
                      className="ml-auto text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      Otwórz <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {properties.length === 0 ? (
        <Empty text="Baza jest pusta - dodaj pierwsze obiekty przyciskiem powyżej" />
      ) : filtered.length === 0 ? (
        <Empty text={`Nic nie pasuje do „${query}”`} />
      ) : (
        <div className="space-y-1.5">
          {filtered.map(property => {
            const active = property.oid === activeOid;
            return (
              <div
                key={property.id}
                className={`w-full text-left bg-slate-900 border rounded-lg p-3.5 transition-colors flex items-center gap-4 flex-wrap ${
                  active
                    ? 'border-indigo-500/50 bg-slate-800/60'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onOpen(property.oid)}
                  className="min-w-0 flex-1 text-left">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-base font-semibold text-white truncate">
                      {property.label}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">OID {property.oid}</span>
                    {property.lastRun && (
                      <span
                        className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                          RUN_STATUS_STYLES[property.lastRun.status] ?? RUN_STATUS_STYLES.aborted
                        }`}
                      >
                        {property.lastRun.status}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                    {property.city && <span>{property.city}</span>}
                    {property.email && <span className="truncate">{property.email}</span>}
                    {property.lastRun && (
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {new Date(property.lastRun.startedAt).toLocaleString('pl-PL')}
                      </span>
                    )}
                  </div>
                  {property.migrationNote && (
                    <div className="text-xs text-amber-300/80 mt-1.5 flex items-start gap-1.5">
                      <StickyNote size={11} className="mt-0.5 flex-shrink-0" />
                      <span className="break-words">{property.migrationNote}</span>
                    </div>
                  )}
                </button>

                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <Stat label="standardy" value={property._count.roomTypes} />
                  <Stat label="pokoje" value={property._count.rooms} />
                  <Stat label="cenniki" value={property._count.ratePlans} />
                  <Stat label="dodatki" value={property._count.addons} />
                </div>

                <div className="text-right min-w-[64px]">
                  <div
                    className={`text-lg font-bold ${
                      property.migrationPercent === 100
                        ? 'text-emerald-400'
                        : property.migrationPercent > 0
                          ? 'text-amber-400'
                          : 'text-slate-600'
                    }`}
                  >
                    {property.migrationPercent}%
                  </div>
                  <div className="text-[9px] uppercase text-slate-600">przepisane</div>
                </div>

                <div className="flex items-center gap-1.5">
                  <select
                    value={property.migrationStatus}
                    onChange={event => changeStatus(property.oid, event.target.value as MigrationStatus)}
                    className={`text-xs font-medium rounded-lg border px-2 py-1.5 outline-none cursor-pointer ${
                      MIGRATION_STYLES[property.migrationStatus]
                    }`}
                    title={
                      property.migrationUpdatedAt
                        ? `zmienił ${property.migrationUpdatedBy ?? '?'}, ${new Date(property.migrationUpdatedAt).toLocaleString('pl-PL')}`
                        : 'status przepisywania do nowego PMS'
                    }
                  >
                    {MIGRATION_ORDER.map(status => (
                      <option key={status} value={status} className="bg-slate-900 text-white">
                        {MIGRATION_LABELS[status]}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setNoteFor(noteFor === property.oid ? null : property.oid);
                      setNoteDraft(property.migrationNote ?? '');
                    }}
                    title="Notatka"
                    className={`p-1.5 rounded-lg border transition-colors ${
                      property.migrationNote
                        ? 'border-amber-500/40 text-amber-300'
                        : 'border-slate-700 text-slate-500 hover:text-white'
                    }`}
                  >
                    <StickyNote size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpen(property.oid)}
                    className="p-1.5 text-slate-600 hover:text-white transition-colors"
                    title="Otwórz dane"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>

                <div className="w-full flex flex-wrap gap-1.5 pt-2 border-t border-slate-800">
                  {property.migrationSteps.map(step => (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => toggleStep(property.oid, step.key, !step.checked)}
                      disabled={step.auto}
                      title={
                        step.auto
                          ? 'Nie ma czego przepisywać - zaliczone automatycznie'
                          : `${step.total ?? ''} do przepisania`
                      }
                      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border transition-colors ${
                        step.auto
                          ? 'border-slate-800 text-slate-600 cursor-default'
                          : step.done
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                      }`}
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${
                          step.done ? 'bg-emerald-500/80 border-emerald-400' : 'border-slate-600'
                        }`}
                      >
                        {step.done && <Check size={9} className="text-slate-950" />}
                      </span>
                      {step.label}
                      {step.total !== null && (
                        <span className="text-slate-600">{step.auto ? '—' : step.total}</span>
                      )}
                    </button>
                  ))}
                </div>

                {noteFor === property.oid && (
                  <div className="w-full flex gap-2 mt-1">
                    <input
                      autoFocus
                      value={noteDraft}
                      onChange={event => setNoteDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') saveNote(property.oid);
                        if (event.key === 'Escape') setNoteFor(null);
                      }}
                      placeholder="np. czeka na dane z recepcji, cenniki już przepisane…"
                      className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => saveNote(property.oid)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg text-sm"
                    >
                      Zapisz
                    </button>
                    <button
                      type="button"
                      onClick={() => setNoteFor(null)}
                      className="border border-slate-700 text-slate-400 px-3 py-2 rounded-lg text-sm"
                    >
                      Anuluj
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="text-center min-w-[52px]">
    <div className={`text-sm font-bold ${value > 0 ? 'text-white' : 'text-slate-600'}`}>{value}</div>
    <div className="text-[9px] uppercase text-slate-600">{label}</div>
  </div>
);
