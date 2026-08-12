import React, { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Card, CopyRecordButton, Empty, Expandable, FieldTable, PageHeader, SearchBox, SimpleTable,
} from '../ui';
import { ADDON_GROUPS } from '../fields';
import { matches, titleOf } from '../helpers';

export const AddonsView: React.FC<{ data: any }> = ({ data }) => {
  const [query, setQuery] = useState('');
  const addons: any[] = data.addons ?? [];
  const allFields = ADDON_GROUPS.flatMap(group => group.fields);

  const names = useMemo(() => {
    const rates = new Map<string, string>();
    for (const rate of data.ratePlans ?? []) rates.set(rate.hotresId, titleOf(rate));
    const types = new Map<string, string>();
    for (const type of data.roomTypes ?? []) types.set(type.hotresId, titleOf(type));
    return { rates, types };
  }, [data.ratePlans, data.roomTypes]);

  const filtered = addons.filter(
    addon => matches(addon.code, query) || matches(addon.hotresId, query),
  );

  return (
    <div>
      <PageHeader
        title="Dodatki"
        count={addons.length}
        source="api_addons"
        subtitle="Usługi dodatkowe i upselling: ceny, stawki VAT, stany magazynowe oraz reguły, kiedy i do czego dodatek można sprzedać."
      >
        <SearchBox value={query} onChange={setQuery} placeholder="Szukaj dodatku…" />
      </PageHeader>

      {addons.length === 0 ? (
        <Empty text="Brak dodatków - uruchom eksport z grupą „Dodatki / upselling”" />
      ) : (
        <>
          <Card title="Zestawienie">
            <SimpleTable
              columns={[
                { key: 'code', label: 'Kod / nazwa' },
                { key: 'hotresId', label: 'addon_id', mono: true },
                { key: 'mode', label: 'Naliczanie' },
                { key: 'price', label: 'Cena' },
                { key: 'tax', label: 'VAT' },
                { key: 'stock', label: 'Stan' },
                { key: 'included', label: 'W cenie', kind: 'bool' },
                { key: 'active', label: 'Aktywny', kind: 'bool' },
              ]}
              rows={filtered}
            />
          </Card>

          <div className="space-y-2">
            {filtered.map(addon => (
              <Expandable
                key={addon.id}
                header={
                  <div>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-base font-semibold text-white">
                        {addon.code || `dodatek ${addon.hotresId}`}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        addon_id {addon.hotresId}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {[
                        addon.price !== null && `${addon.price} (VAT ${addon.tax ?? '?'})`,
                        addon.mode,
                        addon.included ? 'wliczony w cenę' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                }
              >
                <div className="flex justify-end">
                  <CopyRecordButton fields={allFields} row={addon} />
                </div>

                {ADDON_GROUPS.map(group => (
                  <div key={group.title}>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                      {group.title}
                    </h3>
                    <FieldTable fields={group.fields} row={addon} />
                  </div>
                ))}

                <LinkList
                  title="Przypisane cenniki"
                  hotresField="rates_ids"
                  links={addon.ratePlanLinks ?? []}
                  idKey="rateHotresId"
                  relationKey="ratePlanId"
                  names={names.rates}
                  emptyText="Brak ograniczenia - dodatek działa z każdym cennikiem."
                />

                <LinkList
                  title="Przypisane standardy"
                  hotresField="rooms_types_ids"
                  links={addon.roomTypeLinks ?? []}
                  idKey="typeHotresId"
                  relationKey="roomTypeId"
                  names={names.types}
                  emptyText="Brak ograniczenia - dodatek działa z każdym standardem."
                />
              </Expandable>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Powiązania dodatku. Jeśli Hotres wskazuje na coś, czego nie ma już
 * w obiekcie, pokazujemy to wprost - identyfikator nie ginie.
 */
const LinkList: React.FC<{
  title: string;
  hotresField: string;
  links: any[];
  idKey: string;
  relationKey: string;
  names: Map<string, string>;
  emptyText: string;
}> = ({ title, hotresField, links, idKey, relationKey, names, emptyText }) => (
  <div>
    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
      {title} ({links.length})
      <span className="ml-2 font-mono normal-case text-slate-600">{hotresField}</span>
    </h3>
    {links.length === 0 ? (
      <p className="text-slate-600 text-sm italic">{emptyText}</p>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {links.map(link => {
          const id = link[idKey];
          const orphan = link[relationKey] === null;
          return (
            <span
              key={link.id}
              className={`text-xs px-2.5 py-1 rounded-lg border ${
                orphan
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              {orphan && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
              {names.get(id) ?? 'nie istnieje w tym obiekcie'}
              <span className="ml-1.5 text-slate-500 font-mono text-[10px]">{id}</span>
            </span>
          );
        })}
      </div>
    )}
  </div>
);
