import React, { useState } from 'react';
import {
  Card, CopyButton, CopyRecordButton, Empty, Expandable, FieldTable, LangTabs, PageHeader,
  SearchBox, SimpleTable,
} from '../ui';
import {
  INFORMATOR_FIELDS, REVIEW_FIELDS, TICKET_FIELDS, TICKET_TEXTS, USER_FIELDS,
  VOUCHER_FIELDS, VOUCHER_TEXTS,
} from '../fields';
import { dictionaryNames, matches, titleOf } from '../helpers';

/** Nazwy słowników po polsku; nieznane pokazujemy pod oryginalnym kluczem. */
const DICTIONARY_LABELS: Record<string, string> = {
  facilities: 'Wyposażenie / udogodnienia',
  currencies: 'Waluty',
  countries: 'Kraje',
};

/** Wspólny szkielet dla list z tłumaczeniami (vouchery, bilety). */
const TranslatedList: React.FC<{
  items: any[];
  fields: any[];
  texts: any[];
  idLabel: string;
  subtitle: (item: any) => string;
}> = ({ items, fields, texts, idLabel, subtitle }) => (
  <div className="space-y-2">
    {items.map(item => (
      <TranslatedCard
        key={item.id}
        item={item}
        fields={fields}
        texts={texts}
        idLabel={idLabel}
        subtitle={subtitle}
      />
    ))}
  </div>
);

const TranslatedCard: React.FC<{
  item: any;
  fields: any[];
  texts: any[];
  idLabel: string;
  subtitle: (item: any) => string;
}> = ({ item, fields, texts, idLabel, subtitle }) => {
  const langs: string[] = (item.translations ?? []).map((entry: any) => entry.lang);
  const [lang, setLang] = useState(langs[0] ?? 'pl');
  const translation = (item.translations ?? []).find((entry: any) => entry.lang === lang);

  return (
    <Expandable
      header={
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-base font-semibold text-white">{titleOf(item)}</span>
            <span className="text-[11px] font-mono text-slate-500">
              {idLabel} {item.hotresId}
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{subtitle(item)}</div>
        </div>
      }
    >
      <div className="flex justify-end">
        <CopyRecordButton fields={fields} row={item} />
      </div>
      <FieldTable fields={fields} row={item} />
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wide">Treści</h3>
          <LangTabs langs={langs} active={lang} onChange={setLang} />
        </div>
        {langs.length === 0 ? (
          <p className="text-slate-600 text-sm italic">Brak treści w żadnym języku.</p>
        ) : (
          <FieldTable fields={texts} row={translation ?? {}} />
        )}
      </div>
    </Expandable>
  );
};

// ---------------------------------------------------------------------------

export const VouchersView: React.FC<{ data: any }> = ({ data }) => {
  const vouchers: any[] = data.vouchers ?? [];
  return (
    <div>
      <PageHeader
        title="Vouchery"
        count={vouchers.length}
        source="api_vouchers + api_voucher"
        subtitle="Vouchery prezentowe: wartość, waluta, okres ważności i opisy sprzedażowe."
      />
      {vouchers.length === 0 ? (
        <Empty text="Brak voucherów w bazie" />
      ) : (
        <TranslatedList
          items={vouchers}
          fields={VOUCHER_FIELDS}
          texts={VOUCHER_TEXTS}
          idLabel="voucher_id"
          subtitle={item =>
            [item.amount && `${item.amount} ${item.currency ?? ''}`, item.validDays && `ważny ${item.validDays} dni`]
              .filter(Boolean)
              .join(' · ')
          }
        />
      )}
    </div>
  );
};

export const TicketsView: React.FC<{ data: any }> = ({ data }) => {
  const tickets: any[] = data.tickets ?? [];
  return (
    <div>
      <PageHeader
        title="Bilety"
        count={tickets.length}
        source="api_tickets + api_ticket"
        subtitle="Bilety i wydarzenia: cena, termin, dostępna pula i limit na rezerwację."
      />
      {tickets.length === 0 ? (
        <Empty text="Brak biletów w bazie" />
      ) : (
        <TranslatedList
          items={tickets}
          fields={TICKET_FIELDS}
          texts={TICKET_TEXTS}
          idLabel="ticket_id"
          subtitle={item =>
            [item.price && `${item.price} ${item.currency ?? ''}`, item.stock && `pula ${item.stock}`]
              .filter(Boolean)
              .join(' · ')
          }
        />
      )}
    </div>
  );
};

export const ReviewsView: React.FC<{ data: any }> = ({ data }) => {
  const [query, setQuery] = useState('');
  const reviews: any[] = data.reviews ?? [];
  const filtered = reviews.filter(
    review =>
      matches(review.author, query) ||
      matches(review.description, query) ||
      matches(review.source, query),
  );

  return (
    <div>
      <PageHeader
        title="Opinie gości"
        count={reviews.length}
        source="api_reviews"
        subtitle="Publiczne opinie zebrane przez Hotres z kanałów sprzedaży. Maksymalnie 300 najnowszych."
      >
        <SearchBox value={query} onChange={setQuery} placeholder="Szukaj w opiniach…" />
      </PageHeader>

      {reviews.length === 0 ? (
        <Empty text="Brak opinii w bazie" />
      ) : (
        <Card>
          <div className="space-y-2">
            {filtered.map(review => (
              <div
                key={review.id}
                className="bg-slate-900 border border-slate-800 rounded-lg p-4 group"
              >
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <span className="text-sm font-semibold text-white">
                    {review.author || 'anonim'}
                  </span>
                  {review.rate !== null && (
                    <span className="bg-emerald-500/10 text-emerald-400 text-xs font-bold px-2 py-0.5 rounded">
                      {review.rate}
                    </span>
                  )}
                  <span className="text-xs text-slate-500">{review.source}</span>
                  <span className="text-xs text-slate-600">
                    {review.addDate ? new Date(review.addDate).toLocaleDateString('pl-PL') : review.addDateRaw}
                  </span>
                  <span className="text-[10px] uppercase text-slate-600">{review.lang}</span>
                  <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyButton value={review.description ?? ''} label="Kopiuj treść" />
                  </span>
                </div>
                {review.description?.trim() ? (
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">{review.description}</p>
                ) : (
                  <p className="text-sm text-slate-600 italic">Ocena bez komentarza.</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export const InformatorView: React.FC<{ data: any }> = ({ data }) => {
  const items: any[] = data.informator ?? [];
  const langs = [...new Set(items.map(item => item.lang))];
  const [lang, setLang] = useState(langs[0] ?? 'pl');
  const visible = items.filter(item => item.lang === lang);

  return (
    <div>
      <PageHeader
        title="Informator"
        count={items.length}
        source="api_informator"
        subtitle="Kafle informacyjne dla gości: wifi, okolica, zasady obiektu. Treści bywają obszernym HTML-em."
      >
        <LangTabs langs={langs} active={lang} onChange={setLang} />
      </PageHeader>

      {items.length === 0 ? (
        <Empty text="Brak informatora w bazie" />
      ) : (
        <div className="space-y-2">
          {visible.map(item => (
            <Expandable
              key={item.id}
              header={
                <div>
                  <span className="text-base font-semibold text-white">{item.title}</span>
                  {item.advert && (
                    <div className="text-xs text-slate-400 mt-0.5">{item.advert}</div>
                  )}
                </div>
              }
            >
              <div className="flex justify-end">
                <CopyRecordButton fields={INFORMATOR_FIELDS} row={item} />
              </div>
              <FieldTable fields={INFORMATOR_FIELDS} row={item} />
            </Expandable>
          ))}
        </div>
      )}
    </div>
  );
};

export const UsersView: React.FC<{ data: any }> = ({ data }) => {
  const users: any[] = data.users ?? [];
  return (
    <div>
      <PageHeader
        title="Użytkownicy"
        count={users.length}
        source="api_users"
        subtitle="Konta z dostępem do obiektu w panelu Hotres - przydatne, żeby wiedzieć, komu założyć dostęp w nowym systemie."
      />
      {users.length === 0 ? (
        <Empty text="Brak użytkowników w bazie" />
      ) : (
        <Card>
          <SimpleTable
            columns={[
              { key: 'name', label: 'Nazwa' },
              { key: 'email', label: 'E-mail' },
              { key: 'uid', label: 'uid', mono: true },
              { key: 'active', label: 'Aktywny', kind: 'bool' },
              { key: 'loginCount', label: 'Logowań' },
              { key: 'loginDate', label: 'Ostatnie logowanie', kind: 'datetime' },
              { key: 'addDate', label: 'Założone', kind: 'datetime' },
            ]}
            rows={users}
          />
          <p className="text-[11px] text-slate-600 mt-3">
            Pełny zestaw pól: {USER_FIELDS.map(field => field.label).join(', ')}.
          </p>
        </Card>
      )}
    </div>
  );
};

export const ParamsView: React.FC<{ data: any }> = ({ data }) => {
  const [query, setQuery] = useState('');
  const params: any[] = data.params ?? [];
  const filtered = params.filter(
    param => matches(param.key, query) || matches(param.value, query),
  );

  return (
    <div>
      <PageHeader
        title="Parametry"
        count={params.length}
        source="api_params"
        subtitle="Surowa konfiguracja obiektu w Hotresie (klucze be_*). Sterują silnikiem rezerwacji: waluty, limity, wygląd, włączone moduły."
      >
        <SearchBox value={query} onChange={setQuery} placeholder="Szukaj parametru…" />
      </PageHeader>

      {params.length === 0 ? (
        <Empty text="Brak parametrów w bazie" />
      ) : (
        <Card>
          <SimpleTable
            columns={[
              { key: 'key', label: 'Klucz', mono: true },
              { key: 'value', label: 'Wartość' },
            ]}
            rows={filtered}
          />
        </Card>
      )}
    </div>
  );
};

export const DefinitionsView: React.FC<{ data: any }> = ({ data }) => {
  const [query, setQuery] = useState('');
  const definitions: any[] = data.definitions ?? [];
  const dictionaries = dictionaryNames(definitions);

  return (
    <div>
      <PageHeader
        title="Słowniki (legendy)"
        count={definitions.length}
        source="api_definitions"
        subtitle="Tłumaczenie numerów na nazwy. Bez tego pola typu facilities: „22,7,73” przy standardach są nie do odczytania - tu sprawdzisz, co znaczy każdy numer."
      >
        <SearchBox value={query} onChange={setQuery} placeholder="Szukaj po nazwie lub numerze…" />
      </PageHeader>

      {definitions.length === 0 ? (
        <Empty text="Brak słowników - uruchom eksport z grupą „Słowniki”" />
      ) : (
        dictionaries.map(dictionary => {
          const entries = definitions.filter(
            entry =>
              entry.dictionary === dictionary &&
              (matches(entry.code, query) || matches(entry.hotresId, query)),
          );
          if (entries.length === 0) return null;

          return (
            <Card
              key={dictionary}
              title={DICTIONARY_LABELS[dictionary] ?? dictionary}
              right={
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-600">{dictionary}</span>
                  <CopyButton
                    value={entries
                      .map(entry => `${entry.hotresId} = ${entry.name || entry.code || ''}`)
                      .join('\n')}
                    label="Kopiuj całą legendę"
                    className="border border-slate-700 !px-2 !py-1"
                  />
                </div>
              }
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {entries.map(entry => (
                  <div
                    key={entry.id}
                    className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-center gap-3 group"
                  >
                    {entry.icon && (
                      <img src={entry.icon} alt="" className="w-6 h-6 opacity-70" loading="lazy" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-200 truncate">
                        {entry.name || entry.code || '—'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-600">
                        id {entry.hotresId}
                        {entry.name && entry.code && ` · ${entry.code}`}
                        {entry.phone && ` · tel. +${entry.phone}`}
                        {entry.ratio && ` · kurs ${entry.ratio}`}
                        {(entry.symbolLeft || entry.symbolRight) &&
                          ` · ${entry.symbolLeft ?? ''}${entry.symbolRight ?? ''}`}
                      </div>
                    </div>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <CopyButton value={entry.code ?? ''} />
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
};
