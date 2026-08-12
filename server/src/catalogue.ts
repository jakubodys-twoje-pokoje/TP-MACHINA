/**
 * Katalog endpointów Hotres pobieranych przez eksporter.
 *
 * Kolejność w tablicy jest kolejnością importu i ma znaczenie: standardy muszą
 * wylądować w bazie przed pokojami, a cenniki przed dodatkami, żeby dało się
 * dowiązać relacje.
 */

export interface DetailSpec {
  key: string;
  label: string;
  action: string;
  /** Pole identyfikatora w elemencie listy nadrzędnej. */
  idField: string;
  /** Nazwa parametru zapytania dla identyfikatora. */
  param: string;
  lang: boolean;
}

export interface GroupSpec {
  key: string;
  label: string;
  action: string;
  description: string;
  /** Endpoint przyjmuje `lang` - pobieramy go dla każdego wybranego języka. */
  lang: boolean;
  /** Błąd nie jest traktowany jako problem eksportu. */
  optional?: boolean;
  params?: Record<string, string | number>;
  detail?: DetailSpec;
}

export const GROUPS: GroupSpec[] = [
  {
    key: 'object',
    label: 'Obiekt',
    action: 'api_object',
    description: 'Adres, kontakt, dane firmy, galeria, opis, regulamin, godziny doby hotelowej',
    lang: true,
  },
  {
    key: 'params',
    label: 'Parametry',
    action: 'api_params',
    description: 'Pełna konfiguracja obiektu (parametry be_*)',
    lang: false,
  },
  {
    key: 'definitions',
    label: 'Słowniki',
    action: 'api_definitions',
    description: 'Definicje udogodnień wraz z ikonami',
    lang: false,
  },
  {
    key: 'roomstypes',
    label: 'Standardy / typy pokoi',
    action: 'api_roomstypes',
    description: 'Lista standardów: metraż, wyposażenie, zdjęcie główne',
    lang: true,
    detail: {
      key: 'roomtypes',
      label: 'Szczegóły standardów',
      action: 'api_roomtype',
      idField: 'type_id',
      param: 'type_id',
      lang: true,
    },
  },
  {
    key: 'rooms',
    label: 'Pokoje fizyczne',
    action: 'api_rooms',
    description: 'Numery pokoi, łóżka, piętro, stan, pola własne',
    lang: false,
  },
  {
    key: 'rates',
    label: 'Plany cenowe (definicje)',
    action: 'api_rates',
    description: 'Metadane cenników: nazwa, wyżywienie, min/max pobyt. BEZ kalendarza cen',
    lang: true,
    detail: {
      key: 'rateDetails',
      label: 'Szczegóły planów cenowych',
      action: 'api_rate',
      idField: 'rate_id',
      param: 'rate_id',
      lang: true,
    },
  },
  {
    key: 'addons',
    label: 'Dodatki / upselling',
    action: 'api_addons',
    description: 'Dodatki z cenami, stanami i regułami sprzedaży',
    lang: false,
  },
  {
    key: 'vouchers',
    label: 'Vouchery',
    action: 'api_vouchers',
    description: 'Vouchery prezentowe i ich opisy',
    lang: true,
    optional: true,
    detail: {
      key: 'voucherDetails',
      label: 'Szczegóły voucherów',
      action: 'api_voucher',
      idField: 'voucher_id',
      param: 'voucher_id',
      lang: true,
    },
  },
  {
    key: 'tickets',
    label: 'Bilety / wydarzenia',
    action: 'api_tickets',
    description: 'Bilety, wydarzenia, limity i stany',
    lang: true,
    optional: true,
    detail: {
      key: 'ticketDetails',
      label: 'Szczegóły biletów',
      action: 'api_ticket',
      idField: 'ticket_id',
      param: 'ticket_id',
      lang: true,
    },
  },
  {
    key: 'reviews',
    label: 'Opinie gości',
    action: 'api_reviews',
    description: 'Publiczne opinie (maks. 300)',
    lang: false,
    optional: true,
    params: { limit: 300 },
  },
  {
    key: 'informator',
    label: 'Informator',
    action: 'api_informator',
    description: 'Kafle informacyjne dla gości',
    lang: true,
    optional: true,
  },
  {
    key: 'users',
    label: 'Użytkownicy',
    action: 'api_users',
    description: 'Konta z dostępem do obiektu',
    lang: false,
    optional: true,
  },
];

export const EXCLUDED: { action: string; reason: string }[] = [
  { action: 'api_availability', reason: 'dostępność - dane dynamiczne' },
  { action: 'api_prices', reason: 'kalendarz cen - dane dynamiczne' },
  { action: 'api_blocks', reason: 'blokady terminów - dane dynamiczne' },
  { action: 'api_reservations', reason: 'rezerwacje - osobny eksport' },
  { action: 'api_guests', reason: 'dane gości - osobny eksport' },
  { action: 'api_payments', reason: 'płatności - osobny eksport' },
  { action: 'api_invoices', reason: 'faktury - osobny eksport' },
  { action: 'api_messages', reason: 'wiadomości - osobny eksport' },
];

export const LANGS = ['pl', 'en', 'de', 'cz', 'sk', 'ua', 'ru', 'fr', 'es', 'it'];

export const GROUP_KEYS = GROUPS.map(group => group.key);

/** Porządkuje wybrane grupy wg kolejności katalogu (wymuszonej przez relacje). */
export function orderGroups(keys: string[]): GroupSpec[] {
  const wanted = new Set(keys);
  return GROUPS.filter(group => wanted.has(group.key));
}
