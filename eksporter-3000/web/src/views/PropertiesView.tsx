import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Clock, Download, Loader2, Plus, X, Zap,
} from 'lucide-react';
import { Card, Empty, PageHeader, SearchBox } from '../ui';
import { streamExport, type Catalogue, type PropertyRow } from '../api';
import { matches } from '../helpers';

/** 1 obiekt / 2 obiekty / 5 obiektów - inaczej przycisk czyta się koślawo. */
export function obiekty(count: number): string {
  if (count === 1) return '1 obiekt';
  const rest = count % 100;
  const last = count % 10;
  const few = last >= 2 && last <= 4 && !(rest >= 12 && rest <= 14);
  return `${count} ${few ? 'obiekty' : 'obiektów'}`;
}

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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const filtered = useMemo(
    () =>
      properties.filter(
        property =>
          matches(property.label, query) ||
          matches(property.oid, query) ||
          matches(property.city, query) ||
          matches(property.companyName, query),
      ),
    [properties, query],
  );

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
              <button
                key={property.id}
                type="button"
                onClick={() => onOpen(property.oid)}
                className={`w-full text-left bg-slate-900 border rounded-lg p-3.5 transition-colors flex items-center gap-4 flex-wrap ${
                  active
                    ? 'border-indigo-500/50 bg-slate-800/60'
                    : 'border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                }`}
              >
                <div className="min-w-0 flex-1">
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
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <Stat label="standardy" value={property._count.roomTypes} />
                  <Stat label="pokoje" value={property._count.rooms} />
                  <Stat label="cenniki" value={property._count.ratePlans} />
                  <Stat label="dodatki" value={property._count.addons} />
                </div>

                <ChevronRight size={16} className="text-slate-600 flex-shrink-0" />
              </button>
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
