import React, { useState } from 'react';
import {
  Card, CopyRecordButton, Empty, Expandable, FieldTable, LangTabs, PageHeader, PhotoGrid,
  SearchBox, SimpleTable,
} from '../ui';
import { RATE_DISCOUNT_FIELDS, RATE_FIELDS, RATE_TEXTS } from '../fields';
import { matches, titleOf } from '../helpers';
import { photosZipUrl } from '../api';

export const RatesView: React.FC<{ data: any }> = ({ data }) => {
  const [query, setQuery] = useState('');
  const rates: any[] = data.ratePlans ?? [];

  const filtered = rates.filter(
    rate => matches(titleOf(rate), query) || matches(rate.hotresId, query),
  );

  return (
    <div>
      <PageHeader
        title="Cenniki"
        count={rates.length}
        source="api_rates + api_rate"
        subtitle="Definicje planów cenowych: wyżywienie, długość pobytu, opisy i galerie. Uwaga: to są same definicje - kalendarz cen i dostępności celowo NIE jest pobierany."
      >
        <SearchBox value={query} onChange={setQuery} placeholder="Szukaj cennika…" />
      </PageHeader>

      {rates.length === 0 ? (
        <Empty text="Brak cenników - uruchom eksport z grupą „Plany cenowe”" />
      ) : (
        <>
          <Card title="Zestawienie">
            <SimpleTable
              columns={[
                { key: 'title', label: 'Nazwa' },
                { key: 'hotresId', label: 'rate_id', mono: true },
                { key: 'board', label: 'Wyżywienie' },
                { key: 'isPackage', label: 'Pakiet', kind: 'bool' },
                { key: 'minimumStay', label: 'Min. nocy' },
                { key: 'maximumStay', label: 'Maks. nocy' },
                { key: 'currency', label: 'Waluta' },
              ]}
              rows={filtered.map(rate => ({ ...rate, title: titleOf(rate) }))}
            />
          </Card>

          <div className="space-y-2">
            {filtered.map(rate => (
              <RateCard key={rate.id} oid={data.oid} rate={rate} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const RateCard: React.FC<{ oid: string; rate: any }> = ({ oid, rate }) => {
  const langs: string[] = (rate.translations ?? []).map((item: any) => item.lang);
  const [lang, setLang] = useState(langs[0] ?? 'pl');
  const translation = (rate.translations ?? []).find((item: any) => item.lang === lang);

  return (
    <Expandable
      header={
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-base font-semibold text-white">{titleOf(rate)}</span>
            <span className="text-[11px] font-mono text-slate-500">rate_id {rate.hotresId}</span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {[
              rate.board && `wyżywienie ${rate.board}`,
              rate.minimumStay && `min. ${rate.minimumStay} nocy`,
              rate.isPackage ? 'pakiet' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'brak parametrów'}
          </div>
        </div>
      }
    >
      <div className="flex justify-end">
        <CopyRecordButton fields={RATE_FIELDS} row={rate} />
      </div>

      <FieldTable fields={RATE_FIELDS} row={rate} />

      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Treści i opisy</h3>
          <LangTabs langs={langs} active={lang} onChange={setLang} />
        </div>
        {langs.length === 0 ? (
          <p className="text-slate-600 text-sm italic">Brak treści w żadnym języku.</p>
        ) : (
          <FieldTable fields={RATE_TEXTS} row={translation ?? {}} />
        )}
      </div>

      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
          Rabaty ({rate.discounts?.length ?? 0})
          <span className="ml-2 font-mono normal-case text-slate-600">discounts</span>
        </h3>
        {(rate.discounts?.length ?? 0) === 0 ? (
          <p className="text-slate-600 text-sm italic">Brak rabatów w tym cenniku.</p>
        ) : (
          <div className="space-y-2">
            {rate.discounts.map((discount: any) => (
              <div key={discount.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="text-sm font-semibold text-white">
                    {discount.name || `rabat #${discount.position + 1}`}
                  </span>
                  <span className="bg-indigo-500/10 text-indigo-300 text-xs font-bold px-2 py-0.5 rounded">
                    {discount.discount}
                    {discount.mode === 'percent' ? '%' : ''}
                  </span>
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                      discount.active
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {discount.active ? 'aktywny' : 'nieaktywny'}
                  </span>
                </div>
                <FieldTable fields={RATE_DISCOUNT_FIELDS} row={discount} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
          Galeria ({rate.photos?.length ?? 0})
        </h3>
        <PhotoGrid
          photos={rate.photos ?? []}
          zipUrl={photosZipUrl(oid, { ratePlan: rate.hotresId })}
        />
      </div>
    </Expandable>
  );
};
