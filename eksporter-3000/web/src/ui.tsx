/**
 * Klocki GUI.
 *
 * Reguła nadrzędna: użytkownik przepisuje te dane ręcznie do nowego PMS-a,
 * więc każda wartość musi być widoczna, opisana i kopiowalna jednym kliknięciem.
 * Puste pole pokazujemy wprost jako „puste" - nigdy go nie chowamy, bo wtedy
 * nie wiadomo, czy dane nie istnieją, czy tylko ich nie wyświetliliśmy.
 */

import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Inbox } from 'lucide-react';

// ---------------------------------------------------------------------------
// kopiowanie
// ---------------------------------------------------------------------------

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback dla przeglądarek bez clipboard API (np. strona po czystym HTTP).
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
  }
}

export const CopyButton: React.FC<{ value: string; label?: string; className?: string }> = ({
  value,
  label,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await copyText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title="Kopiuj do schowka"
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
        copied
          ? 'text-emerald-400 bg-emerald-500/10'
          : 'text-slate-500 hover:text-indigo-300 hover:bg-slate-800'
      } ${className}`}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {label && <span>{copied ? 'skopiowane' : label}</span>}
    </button>
  );
};

// ---------------------------------------------------------------------------
// pola
// ---------------------------------------------------------------------------

export type FieldKind = 'text' | 'number' | 'bool' | 'date' | 'datetime' | 'url' | 'html' | 'long';

export interface Field {
  key: string;
  label: string;
  /** Oryginalna nazwa pola w API Hotres - żeby dało się porównać z panelem. */
  hotres?: string;
  kind?: FieldKind;
  hint?: string;
}

export function formatDate(value: unknown, withTime = false): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return withTime ? date.toLocaleString('pl-PL') : date.toLocaleDateString('pl-PL');
}

/** Surowa wartość do schowka - to, co użytkownik faktycznie chce wkleić. */
export function rawValue(value: unknown, kind: FieldKind = 'text'): string {
  if (value === null || value === undefined || value === '') return '';
  if (kind === 'bool') return value ? 'tak' : 'nie';
  if (kind === 'date') return formatDate(value);
  if (kind === 'datetime') return formatDate(value, true);
  return String(value);
}

const EmptyValue: React.FC = () => (
  <span className="text-slate-600 italic text-sm">puste</span>
);

export const FieldValue: React.FC<{ value: unknown; kind?: FieldKind }> = ({
  value,
  kind = 'text',
}) => {
  if (value === null || value === undefined || value === '') return <EmptyValue />;

  if (kind === 'bool') {
    return (
      <span
        className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold ${
          value ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'
        }`}
      >
        {value ? 'TAK' : 'NIE'}
      </span>
    );
  }

  if (kind === 'date' || kind === 'datetime') {
    return <span className="text-slate-100 text-sm">{formatDate(value, kind === 'datetime')}</span>;
  }

  if (kind === 'url') {
    return (
      <a
        href={String(value)}
        target="_blank"
        rel="noreferrer"
        className="text-indigo-300 hover:text-indigo-200 underline break-all inline-flex items-start gap-1 text-sm"
      >
        {String(value)}
        <ExternalLink size={11} className="mt-1 flex-shrink-0" />
      </a>
    );
  }

  if (kind === 'html') return <HtmlBlock html={String(value)} />;

  if (kind === 'long') {
    return (
      <span className="text-slate-100 text-sm whitespace-pre-wrap break-words">{String(value)}</span>
    );
  }

  return <span className="text-slate-100 text-sm break-words">{String(value)}</span>;
};

/**
 * Tabela pól rekordu. Lewa kolumna: po polsku + oryginalna nazwa z Hotresa.
 * Prawa: wartość i przycisk kopiowania.
 */
export const FieldTable: React.FC<{
  fields: Field[];
  row: Record<string, any>;
  /** Pokaż także pola puste (domyślnie tak - nic nie chowamy). */
  hideEmpty?: boolean;
}> = ({ fields, row, hideEmpty = false }) => {
  const visible = hideEmpty
    ? fields.filter(field => {
        const value = row?.[field.key];
        return value !== null && value !== undefined && value !== '';
      })
    : fields;

  if (visible.length === 0) {
    return <p className="text-slate-500 text-sm italic">Brak wypełnionych pól.</p>;
  }

  return (
    <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
      {visible.map(field => {
        const value = row?.[field.key];
        const copyable = rawValue(value, field.kind);
        return (
          <div
            key={field.key}
            className="grid grid-cols-1 sm:grid-cols-[minmax(200px,260px)_1fr] gap-1 sm:gap-4 px-4 py-3 odd:bg-slate-900/40 hover:bg-slate-900/70 transition-colors group"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-300">{field.label}</div>
              {field.hotres && (
                <div className="text-[11px] font-mono text-slate-600 truncate">{field.hotres}</div>
              )}
              {field.hint && <div className="text-[11px] text-slate-500 mt-0.5">{field.hint}</div>}
            </div>
            <div className="flex items-start gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <FieldValue value={value} kind={field.kind} />
              </div>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <CopyButton value={copyable} />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Kopiuje cały rekord jako czytelny tekst „Etykieta: wartość". */
export const CopyRecordButton: React.FC<{ fields: Field[]; row: Record<string, any> }> = ({
  fields,
  row,
}) => {
  const text = fields
    .map(field => `${field.label}: ${rawValue(row?.[field.key], field.kind) || '-'}`)
    .join('\n');

  return (
    <CopyButton
      value={text}
      label="Kopiuj wszystkie pola"
      className="border border-slate-700 !px-2 !py-1 !text-xs"
    />
  );
};

// ---------------------------------------------------------------------------
// bloki treści
// ---------------------------------------------------------------------------

/** Opis z Hotresa bywa HTML-em - pokazujemy i wersję złożoną, i źródło. */
export const HtmlBlock: React.FC<{ html: string }> = ({ html }) => {
  const [showSource, setShowSource] = useState(false);
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(html);

  if (!html?.trim()) return <EmptyValue />;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 mb-2">
        {looksLikeHtml && (
          <button
            type="button"
            onClick={() => setShowSource(value => !value)}
            className="text-[11px] text-slate-500 hover:text-indigo-300 border border-slate-700 rounded px-1.5 py-0.5"
          >
            {showSource ? 'Pokaż złożone' : 'Pokaż kod HTML'}
          </button>
        )}
        <CopyButton value={html} label="Kopiuj treść" />
      </div>
      {showSource || !looksLikeHtml ? (
        <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[12px] text-slate-300 whitespace-pre-wrap break-words max-h-96 overflow-auto">
          {html}
        </pre>
      ) : (
        <div
          className="prose bg-slate-950/60 border border-slate-800 rounded-lg p-4 max-h-96 overflow-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
};

export const PhotoGrid: React.FC<{ photos: { src: string; url?: string | null }[] }> = ({
  photos,
}) => {
  if (!photos?.length) return <Empty text="Brak zdjęć" />;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {photos.map((photo, index) => (
        <div key={photo.src} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          {photo.url ? (
            <a href={photo.url} target="_blank" rel="noreferrer">
              <img
                src={photo.url}
                alt={`Zdjęcie ${index + 1}`}
                loading="lazy"
                className="w-full h-36 object-cover hover:opacity-80 transition-opacity"
              />
            </a>
          ) : (
            <div className="w-full h-36 flex items-center justify-center text-slate-600 text-xs">
              brak podglądu
            </div>
          )}
          <div className="p-2 space-y-1">
            <div className="text-[10px] font-mono text-slate-500 truncate" title={photo.src}>
              {photo.src}
            </div>
            <div className="flex gap-1">
              <CopyButton value={photo.url ?? photo.src} label="URL" />
              <CopyButton value={photo.src} label="ścieżka" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export const Empty: React.FC<{ text?: string }> = ({ text = 'Brak danych' }) => (
  <div className="flex flex-col items-center justify-center py-10 text-slate-600">
    <Inbox size={28} className="mb-2 opacity-60" />
    <p className="text-sm">{text}</p>
  </div>
);

// ---------------------------------------------------------------------------
// układ
// ---------------------------------------------------------------------------

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  source?: string;
  count?: number;
  children?: React.ReactNode;
}> = ({ title, subtitle, source, count, children }) => (
  <div className="mb-6">
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      {count !== undefined && (
        <span className="bg-slate-800 text-slate-300 text-sm font-bold px-2.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
      {source && (
        <span className="text-[11px] font-mono text-slate-500 bg-slate-900 border border-slate-800 px-2 py-1 rounded">
          {source}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
    {subtitle && <p className="text-slate-400 text-sm mt-1.5 max-w-3xl">{subtitle}</p>}
  </div>
);

export const Card: React.FC<{ title?: string; children: React.ReactNode; right?: React.ReactNode }> = ({
  title,
  children,
  right,
}) => (
  <section className="bg-surface border border-border rounded-xl p-4 sm:p-5 mb-5">
    {(title || right) && (
      <div className="flex items-center justify-between gap-3 mb-4">
        {title && (
          <h2 className="text-sm font-bold text-white uppercase tracking-wide">{title}</h2>
        )}
        {right}
      </div>
    )}
    {children}
  </section>
);

/** Rozwijana pozycja listy - lista jest skrótem, środek ma komplet pól. */
export const Expandable: React.FC<{
  header: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ header, badge, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-left hover:bg-slate-800/50 transition-colors"
      >
        {open ? (
          <ChevronDown size={16} className="text-indigo-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-slate-500 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">{header}</div>
        {badge}
      </button>
      {open && <div className="border-t border-slate-800 p-3 sm:p-4 space-y-5">{children}</div>}
    </div>
  );
};

export const LangTabs: React.FC<{
  langs: string[];
  active: string;
  onChange: (lang: string) => void;
}> = ({ langs, active, onChange }) => {
  if (langs.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-1 mb-3">
      {langs.map(lang => (
        <button
          key={lang}
          type="button"
          onClick={() => onChange(lang)}
          className={`px-3 py-1 rounded-lg text-xs font-bold uppercase border transition-colors ${
            lang === active
              ? 'bg-indigo-600 border-indigo-500 text-white'
              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
          }`}
        >
          {lang}
        </button>
      ))}
    </div>
  );
};

/** Pasek wyszukiwania nad listami - przy 40 standardach to konieczność. */
export const SearchBox: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder = 'Szukaj…' }) => (
  <input
    type="text"
    value={value}
    onChange={event => onChange(event.target.value)}
    placeholder={placeholder}
    className="w-full sm:w-72 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-indigo-500"
  />
);

/** Prosta tabela dla danych, które w całości mieszczą się w wierszu. */
export const SimpleTable: React.FC<{
  columns: { key: string; label: string; kind?: FieldKind; mono?: boolean }[];
  rows: Record<string, any>[];
}> = ({ columns, rows }) => {
  if (!rows.length) return <Empty />;

  return (
    <div className="overflow-x-auto border border-slate-800 rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-900/80">
            {columns.map(column => (
              <th
                key={column.key}
                className="text-left text-[11px] uppercase font-bold text-slate-400 px-3 py-2.5 whitespace-nowrap"
              >
                {column.label}
              </th>
            ))}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((row, index) => (
            <tr key={index} className="odd:bg-slate-900/30 hover:bg-slate-900/70 transition-colors group">
              {columns.map(column => (
                <td
                  key={column.key}
                  className={`px-3 py-2.5 align-top ${column.mono ? 'font-mono text-xs' : ''}`}
                >
                  <FieldValue value={row[column.key]} kind={column.kind} />
                </td>
              ))}
              <td className="px-2 align-top">
                <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <CopyButton
                    value={columns
                      .map(column => `${column.label}: ${rawValue(row[column.key], column.kind) || '-'}`)
                      .join('\n')}
                  />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
