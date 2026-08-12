import React, { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BedDouble, Boxes, Database, DoorClosed, Gift, Info, LogOut, Loader2, MessageSquareQuote,
  RefreshCw, Settings2, Sparkles, Tag, Ticket, Users, Warehouse,
} from 'lucide-react';

import {
  NotAuthorized, getCatalogue, getProperties, getPropertyData, logout, me,
  type Catalogue, type PropertyRow,
} from './api';
import { Login } from './views/Login';
import { ExportView } from './views/ExportView';
import { ObjectView } from './views/ObjectView';
import { RoomTypesView, RoomsView } from './views/RoomTypesView';
import { RatesView } from './views/RatesView';
import { AddonsView } from './views/AddonsView';
import {
  DefinitionsView, InformatorView, ParamsView, ReviewsView, TicketsView, UsersView, VouchersView,
} from './views/CatalogViews';

type SectionKey =
  | 'export' | 'object' | 'roomTypes' | 'rooms' | 'rates' | 'addons' | 'vouchers'
  | 'tickets' | 'reviews' | 'informator' | 'users' | 'params' | 'facilities';

interface Section {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
  /** Skąd wziąć licznik z danych obiektu. */
  count?: (data: any) => number;
}

const SECTIONS: Section[] = [
  { key: 'export', label: 'Pobieranie', icon: Database },
  { key: 'object', label: 'Obiekt', icon: Warehouse },
  { key: 'roomTypes', label: 'Standardy', icon: BedDouble, count: data => data.roomTypes?.length ?? 0 },
  { key: 'rooms', label: 'Pokoje fizyczne', icon: DoorClosed, count: data => data.rooms?.length ?? 0 },
  { key: 'rates', label: 'Cenniki', icon: Tag, count: data => data.ratePlans?.length ?? 0 },
  { key: 'addons', label: 'Dodatki', icon: Boxes, count: data => data.addons?.length ?? 0 },
  { key: 'vouchers', label: 'Vouchery', icon: Gift, count: data => data.vouchers?.length ?? 0 },
  { key: 'tickets', label: 'Bilety', icon: Ticket, count: data => data.tickets?.length ?? 0 },
  { key: 'reviews', label: 'Opinie', icon: MessageSquareQuote, count: data => data.reviews?.length ?? 0 },
  { key: 'informator', label: 'Informator', icon: Info, count: data => data.informator?.length ?? 0 },
  { key: 'users', label: 'Użytkownicy', icon: Users, count: data => data.users?.length ?? 0 },
  { key: 'params', label: 'Parametry', icon: Settings2, count: data => data.params?.length ?? 0 },
  { key: 'facilities', label: 'Słowniki (legendy)', icon: Sparkles, count: data => data.definitions?.length ?? 0 },
];

const OID_STORAGE_KEY = 'eksporter3000.oid';

export const App: React.FC = () => {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [properties, setProperties] = useState<PropertyRow[]>([]);

  const [oid, setOid] = useState(() => localStorage.getItem(OID_STORAGE_KEY) ?? '');
  const [section, setSection] = useState<SectionKey>('export');
  const [data, setData] = useState<any>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- sesja ---------------------------------------------------------------

  useEffect(() => {
    me()
      .then(() => setAuthorized(true))
      .catch(err => setAuthorized(err instanceof NotAuthorized ? false : false));
  }, []);

  const handleUnauthorized = useCallback((err: unknown) => {
    if (err instanceof NotAuthorized) {
      setAuthorized(false);
      return true;
    }
    return false;
  }, []);

  // --- dane ----------------------------------------------------------------

  const loadProperties = useCallback(() => {
    getProperties().then(setProperties).catch(handleUnauthorized);
  }, [handleUnauthorized]);

  useEffect(() => {
    if (!authorized) return;
    getCatalogue().then(setCatalogue).catch(handleUnauthorized);
    loadProperties();
  }, [authorized, handleUnauthorized, loadProperties]);

  const loadData = useCallback(
    (targetOid: string) => {
      if (!targetOid) {
        setData(null);
        return;
      }
      setLoadingData(true);
      setError(null);
      getPropertyData(targetOid)
        .then(setData)
        .catch(err => {
          if (handleUnauthorized(err)) return;
          setData(null);
          // 404 to normalna sytuacja: obiekt jeszcze nie był pobierany.
          setError(err.message ?? String(err));
        })
        .finally(() => setLoadingData(false));
    },
    [handleUnauthorized],
  );

  useEffect(() => {
    if (!authorized) return;
    localStorage.setItem(OID_STORAGE_KEY, oid);
    loadData(oid);
  }, [authorized, oid, loadData]);

  // --- ekrany --------------------------------------------------------------

  if (authorized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 gap-2">
        <Loader2 className="animate-spin" size={20} /> Sprawdzam sesję…
      </div>
    );
  }

  if (!authorized) return <Login onDone={() => setAuthorized(true)} />;

  if (!catalogue) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 gap-2">
        <Loader2 className="animate-spin" size={20} /> Wczytuję…
      </div>
    );
  }

  const hasData = Boolean(data);

  return (
    <div className="min-h-screen flex">
      {/* Nawigacja */}
      <aside className="w-64 flex-shrink-0 bg-surface border-r border-border flex flex-col h-screen sticky top-0">
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <Database size={18} className="text-indigo-400" />
            </div>
            <div>
              <div className="font-bold text-white leading-tight">Eksporter 3000</div>
              <div className="text-[10px] text-slate-500">dane z Hotres → nowy PMS</div>
            </div>
          </div>

          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
            Obiekt (OID)
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={oid}
              onChange={event => setOid(event.target.value.trim())}
              placeholder="np. 4268"
              list="known-oids"
              className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-sm text-white font-mono outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <datalist id="known-oids">
              {properties.map(property => (
                <option key={property.id} value={property.oid}>
                  {property.city ?? ''}
                </option>
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => loadData(oid)}
              title="Odśwież dane z bazy"
              className="px-2 border border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
            >
              <RefreshCw size={14} className={loadingData ? 'animate-spin' : ''} />
            </button>
          </div>

          {properties.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {properties.map(property => (
                <button
                  key={property.id}
                  type="button"
                  onClick={() => setOid(property.oid)}
                  className={`text-[11px] font-mono px-2 py-1 rounded border transition-colors ${
                    property.oid === oid
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                  }`}
                  title={`${property.city ?? ''} · ${property._count.roomTypes} standardów`}
                >
                  {property.oid}
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {SECTIONS.map(item => {
            const Icon = item.icon;
            const count = hasData && item.count ? item.count(data) : null;
            const active = section === item.key;
            const dimmed = item.key !== 'export' && !hasData;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                disabled={dimmed}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-indigo-600 text-white font-medium'
                    : dimmed
                      ? 'text-slate-700 cursor-not-allowed'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon size={15} className="flex-shrink-0" />
                <span className="flex-1 text-left truncate">{item.label}</span>
                {count !== null && (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      active ? 'bg-indigo-500' : count === 0 ? 'text-slate-600' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border">
          <button
            type="button"
            onClick={() => logout().finally(() => setAuthorized(false))}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <LogOut size={14} /> Wyloguj
          </button>
        </div>
      </aside>

      {/* Treść */}
      <main className="flex-1 min-w-0 p-5 sm:p-8 max-w-6xl">
        {section === 'export' ? (
          <ExportView
            catalogue={catalogue}
            oid={oid}
            onOidChange={setOid}
            onFinished={() => {
              loadData(oid);
              loadProperties();
            }}
          />
        ) : loadingData ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="animate-spin" size={18} /> Wczytuję dane obiektu…
          </div>
        ) : !hasData ? (
          <div className="bg-surface border border-border rounded-xl p-6">
            <h2 className="text-lg font-bold text-white mb-2">Brak danych dla tego obiektu</h2>
            <p className="text-slate-400 text-sm mb-4">
              {oid
                ? `Obiekt ${oid} nie był jeszcze pobierany z Hotresa.`
                : 'Wpisz OID obiektu w polu po lewej.'}
              {error && <span className="block text-slate-600 text-xs mt-2">{error}</span>}
            </p>
            <button
              type="button"
              onClick={() => setSection('export')}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Przejdź do pobierania
            </button>
          </div>
        ) : (
          <>
            {section === 'object' && <ObjectView data={data} />}
            {section === 'roomTypes' && <RoomTypesView data={data} />}
            {section === 'rooms' && <RoomsView data={data} />}
            {section === 'rates' && <RatesView data={data} />}
            {section === 'addons' && <AddonsView data={data} />}
            {section === 'vouchers' && <VouchersView data={data} />}
            {section === 'tickets' && <TicketsView data={data} />}
            {section === 'reviews' && <ReviewsView data={data} />}
            {section === 'informator' && <InformatorView data={data} />}
            {section === 'users' && <UsersView data={data} />}
            {section === 'params' && <ParamsView data={data} />}
            {section === 'facilities' && <DefinitionsView data={data} />}
          </>
        )}
      </main>
    </div>
  );
};
