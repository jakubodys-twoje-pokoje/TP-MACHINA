/**
 * Opisy pól: polska etykieta + oryginalna nazwa z API Hotres.
 *
 * Te tablice są jedynym źródłem prawdy o tym, co widać w GUI. Każda kolumna
 * z bazy ma tu swój wpis - jeśli dodasz pole w schemacie Prismy, dopisz je
 * także tutaj, inaczej dane wpadną do bazy i nikt ich nie zobaczy.
 */

import type { Field } from './ui';

export interface FieldGroup {
  title: string;
  fields: Field[];
}

// ---------------------------------------------------------------------------
// Obiekt
// ---------------------------------------------------------------------------

export const PROPERTY_GROUPS: FieldGroup[] = [
  {
    title: 'Identyfikacja',
    fields: [
      { key: 'oid', label: 'ID obiektu w Hotres', hotres: 'oid' },
      { key: 'identifier', label: 'Identyfikator tekstowy', hotres: 'identifier' },
      { key: 'categoryId', label: 'Kategoria', hotres: 'category_id' },
      { key: 'type', label: 'Typ obiektu', hotres: 'type' },
      { key: 'active', label: 'Aktywny', hotres: 'active', kind: 'bool' },
      { key: 'test', label: 'Tryb testowy', hotres: 'test', kind: 'bool' },
      { key: 'places', label: 'Obiekt wielomiejscowy', hotres: 'places', kind: 'bool' },
    ],
  },
  {
    title: 'Kontakt',
    fields: [
      { key: 'phone', label: 'Telefon', hotres: 'phone' },
      { key: 'phonePrefix', label: 'Prefiks telefonu', hotres: 'phone_prefix' },
      { key: 'phone2', label: 'Telefon dodatkowy', hotres: 'phone2' },
      { key: 'phone2Prefix', label: 'Prefiks telefonu dodatkowego', hotres: 'phone2_prefix' },
      { key: 'email', label: 'E-mail', hotres: 'email' },
      { key: 'www', label: 'Strona WWW', hotres: 'www' },
    ],
  },
  {
    title: 'Adres i lokalizacja',
    fields: [
      { key: 'address', label: 'Ulica', hotres: 'address' },
      { key: 'city', label: 'Miejscowość', hotres: 'city' },
      { key: 'zip', label: 'Kod pocztowy', hotres: 'zip' },
      { key: 'googleX', label: 'Szerokość geograficzna', hotres: 'google_x' },
      { key: 'googleY', label: 'Długość geograficzna', hotres: 'google_y' },
    ],
  },
  {
    title: 'Dane firmy i faktury',
    fields: [
      { key: 'companyName', label: 'Nazwa firmy', hotres: 'company_name' },
      { key: 'companyNip', label: 'NIP', hotres: 'company_nip' },
      { key: 'companyAddress', label: 'Adres firmy', hotres: 'company_address' },
      { key: 'companyCity', label: 'Miejscowość firmy', hotres: 'company_city' },
      { key: 'companyZip', label: 'Kod pocztowy firmy', hotres: 'company_zip' },
      { key: 'vatTax', label: 'Stawka VAT', hotres: 'vat_tax' },
      { key: 'vatInvoice', label: 'Wystawia faktury VAT', hotres: 'vat_invoice', kind: 'bool' },
    ],
  },
  {
    title: 'Doba hotelowa',
    fields: [
      { key: 'arrivalHour', label: 'Godzina zameldowania', hotres: 'arrival_hour' },
      { key: 'departureHour', label: 'Godzina wymeldowania', hotres: 'departure_hour' },
      {
        key: 'todayArrivalHour',
        label: 'Graniczna godzina rezerwacji na dziś',
        hotres: 'today_arrival_hour',
      },
    ],
  },
  {
    title: 'Ustawienia sprzedaży',
    fields: [
      { key: 'currency', label: 'Waluta', hotres: 'currency' },
      { key: 'defaultLang', label: 'Język domyślny', hotres: 'lang' },
      { key: 'child1', label: 'Próg dziecka 1 aktywny', hotres: 'child_1', kind: 'bool' },
      { key: 'child2', label: 'Próg dziecka 2 aktywny', hotres: 'child_2', kind: 'bool' },
      { key: 'child3', label: 'Próg dziecka 3 aktywny', hotres: 'child_3', kind: 'bool' },
    ],
  },
  {
    title: 'Progi wiekowe dzieci',
    fields: [
      { key: 'child1From', label: 'Dziecko 1 - wiek od', hotres: 'child_1_from' },
      { key: 'child1To', label: 'Dziecko 1 - wiek do', hotres: 'child_1_to' },
      { key: 'child1Adult', label: 'Dziecko 1 liczone jak dorosły', hotres: 'child_1_adult', kind: 'bool' },
      { key: 'child1IsPers', label: 'Dziecko 1 liczone do limitu osób', hotres: 'child_1_ispers', kind: 'bool' },
      { key: 'child2From', label: 'Dziecko 2 - wiek od', hotres: 'child_2_from' },
      { key: 'child2To', label: 'Dziecko 2 - wiek do', hotres: 'child_2_to' },
      { key: 'child2Adult', label: 'Dziecko 2 liczone jak dorosły', hotres: 'child_2_adult', kind: 'bool' },
      { key: 'child2IsPers', label: 'Dziecko 2 liczone do limitu osób', hotres: 'child_2_ispers', kind: 'bool' },
      { key: 'child3From', label: 'Dziecko 3 - wiek od', hotres: 'child_3_from' },
      { key: 'child3To', label: 'Dziecko 3 - wiek do', hotres: 'child_3_to' },
      { key: 'child3Adult', label: 'Dziecko 3 liczone jak dorosły', hotres: 'child_3_adult', kind: 'bool' },
      { key: 'child3IsPers', label: 'Dziecko 3 liczone do limitu osób', hotres: 'child_3_ispers', kind: 'bool' },
      { key: 'roomsMaxPers', label: 'Maks. osób w obiekcie', hotres: 'rooms_max_pers' },
    ],
  },
  {
    title: 'Grafika',
    fields: [
      { key: 'logo', label: 'Logo', hotres: 'logo', kind: 'url' },
      { key: 'photo', label: 'Zdjęcie główne', hotres: 'photo', kind: 'url' },
      { key: 'photoS', label: 'Zdjęcie główne (ścieżka)', hotres: 'photo_s' },
    ],
  },
  {
    title: 'Metadane',
    fields: [
      { key: 'contractDate', label: 'Data umowy', hotres: 'contract_date', kind: 'date' },
      { key: 'hotresAddDate', label: 'Data dodania w Hotres', hotres: 'add_date', kind: 'datetime' },
      {
        key: 'updatedAt',
        label: 'Ostatnia aktualizacja w eksporterze',
        kind: 'datetime',
        hint: 'Data lokalna, nie pochodzi z Hotresa',
      },
    ],
  },
];

export const PROPERTY_TEXTS: Field[] = [
  { key: 'description', label: 'Opis obiektu', hotres: 'description', kind: 'html' },
  { key: 'terms', label: 'Regulamin', hotres: 'terms', kind: 'html' },
];

// ---------------------------------------------------------------------------
// Standardy / typy pokoi
// ---------------------------------------------------------------------------

export const ROOMTYPE_GROUPS: FieldGroup[] = [
  {
    title: 'Podstawowe',
    fields: [
      { key: 'hotresId', label: 'ID standardu', hotres: 'type_id' },
      { key: 'category', label: 'Kategoria', hotres: 'category' },
      { key: 'tags', label: 'Tagi', hotres: 'tags' },
      { key: 'priceFrom', label: 'Cena od', hotres: 'price_from' },
      { key: 'floor', label: 'Piętro', hotres: 'floor' },
    ],
  },
  {
    title: 'Miejsca noclegowe',
    fields: [
      { key: 'single', label: 'Łóżka pojedyncze', hotres: 'single' },
      { key: 'double', label: 'Łóżka podwójne', hotres: 'double' },
      { key: 'sofa', label: 'Sofy', hotres: 'sofa' },
      { key: 'bunkBed', label: 'Łóżka piętrowe', hotres: 'bunk_bed' },
      { key: 'extraBed', label: 'Dostawki', hotres: 'extra_bed' },
      { key: 'sofaSingle', label: 'Sofy jednoosobowe', hotres: 'sofa_single' },
      { key: 'armchair', label: 'Fotele', hotres: 'armchair' },
      { key: 'maxAdults', label: 'Maks. dorosłych', hotres: 'max_adults / max_persons' },
    ],
  },
  {
    title: 'Obłożenie',
    fields: [
      { key: 'defPersons', label: 'Domyślna liczba osób', hotres: 'def_persons' },
      { key: 'minPersons', label: 'Minimalna liczba osób', hotres: 'min_persons' },
      { key: 'maxChild1', label: 'Maks. dzieci w progu 1', hotres: 'max_child_1' },
      { key: 'maxChild2', label: 'Maks. dzieci w progu 2', hotres: 'max_child_2' },
      { key: 'maxChild3', label: 'Maks. dzieci w progu 3', hotres: 'max_child_3' },
      { key: 'online', label: 'Sprzedaż online', hotres: 'online', kind: 'bool' },
    ],
  },
  {
    title: 'Metraż i układ',
    fields: [
      { key: 'area', label: 'Powierzchnia (m²)', hotres: 'area' },
      { key: 'roomsCnt', label: 'Liczba pomieszczeń', hotres: 'rooms_cnt' },
      { key: 'chamberCnt', label: 'Liczba komór / aneksów', hotres: 'chamber_cnt' },
      { key: 'bedroomCnt', label: 'Liczba sypialni', hotres: 'bedroom_cnt' },
      { key: 'bathroomCnt', label: 'Liczba łazienek', hotres: 'bathroom_cnt' },
    ],
  },
  {
    title: 'Lokalizacja własna standardu',
    fields: [
      { key: 'address', label: 'Ulica', hotres: 'address' },
      { key: 'city', label: 'Miejscowość', hotres: 'city' },
      { key: 'zip', label: 'Kod pocztowy', hotres: 'zip' },
      { key: 'googleX', label: 'Szerokość geograficzna', hotres: 'google_x' },
      { key: 'googleY', label: 'Długość geograficzna', hotres: 'google_y' },
    ],
  },
  {
    title: 'Media',
    fields: [
      { key: 'ytUrl', label: 'Film YouTube', hotres: 'yt_url', kind: 'url' },
      { key: 'photo', label: 'Zdjęcie główne', hotres: 'photo', kind: 'url' },
      { key: 'photoS', label: 'Zdjęcie główne (ścieżka)', hotres: 'photo_s' },
    ],
  },
];

export const ROOMTYPE_TEXTS: Field[] = [
  { key: 'title', label: 'Nazwa', hotres: 'title' },
  { key: 'advert', label: 'Hasło reklamowe', hotres: 'advert', kind: 'long' },
  { key: 'description', label: 'Opis', hotres: 'description', kind: 'html' },
  { key: 'instructions', label: 'Instrukcje dla gościa', hotres: 'instructions', kind: 'html' },
  { key: 'extrainfo', label: 'Informacje dodatkowe', hotres: 'extrainfo', kind: 'long' },
  { key: 'promo', label: 'Promocja', hotres: 'promo', kind: 'long' },
  { key: 'niceurl', label: 'Adres przyjazny', hotres: 'niceurl' },
  { key: 'metaTitle', label: 'Meta tytuł (SEO)', hotres: 'meta_title' },
  { key: 'metaDescription', label: 'Meta opis (SEO)', hotres: 'meta_description', kind: 'long' },
];

// ---------------------------------------------------------------------------
// Pokoje fizyczne
// ---------------------------------------------------------------------------

export const ROOM_FIELDS: Field[] = [
  { key: 'hotresId', label: 'ID pokoju', hotres: 'room_id' },
  { key: 'code', label: 'Numer / nazwa', hotres: 'code' },
  { key: 'typeHotresId', label: 'ID standardu', hotres: 'type_id' },
  { key: 'state', label: 'Stan', hotres: 'state' },
  { key: 'single', label: 'Łóżka pojedyncze', hotres: 'single' },
  { key: 'double', label: 'Łóżka podwójne', hotres: 'double' },
  { key: 'sofa', label: 'Sofy', hotres: 'sofa' },
  { key: 'sofaSingle', label: 'Sofy jednoosobowe', hotres: 'sofa_single' },
  { key: 'armchair', label: 'Fotele', hotres: 'armchair' },
  { key: 'bunkBed', label: 'Łóżka piętrowe', hotres: 'bunk_bed' },
  { key: 'extraBed', label: 'Dostawki', hotres: 'extra_bed' },
  { key: 'floor', label: 'Piętro', hotres: 'floor' },
  { key: 'tags', label: 'Tagi', hotres: 'tags' },
  { key: 'online', label: 'Sprzedaż online', hotres: 'online', kind: 'bool' },
  { key: 'forchannel', label: 'Wystawiony do channel managera', hotres: 'forchannel', kind: 'bool' },
  { key: 'priority', label: 'Priorytet', hotres: 'priority' },
  { key: 'priorityAlloc', label: 'Priorytet przydziału', hotres: 'priority_alloc' },
  { key: 'custom1', label: 'Pole własne 1', hotres: 'custom1' },
  { key: 'custom2', label: 'Pole własne 2', hotres: 'custom2' },
  { key: 'custom3', label: 'Pole własne 3', hotres: 'custom3' },
  { key: 'custom4', label: 'Pole własne 4', hotres: 'custom4' },
  { key: 'custom5', label: 'Pole własne 5', hotres: 'custom5' },
  { key: 'custom6', label: 'Pole własne 6', hotres: 'custom6' },
];

// ---------------------------------------------------------------------------
// Plany cenowe
// ---------------------------------------------------------------------------

export const RATE_FIELDS: Field[] = [
  { key: 'hotresId', label: 'ID cennika', hotres: 'rate_id' },
  { key: 'board', label: 'Wyżywienie', hotres: 'board', hint: 'RO / BB / HB / FB / AI' },
  { key: 'isPackage', label: 'Pakiet / oferta specjalna', hotres: 'package', kind: 'bool' },
  { key: 'minimumStay', label: 'Minimalny pobyt (noce)', hotres: 'minimum_stay' },
  { key: 'maximumStay', label: 'Maksymalny pobyt (noce)', hotres: 'maximum_stay' },
  { key: 'currency', label: 'Waluta', hotres: 'currency' },
  { key: 'price', label: 'Cena', hotres: 'price' },
  { key: 'lastPrice', label: 'Cena poprzednia', hotres: 'last_price' },
  { key: 'categoryId', label: 'Kategoria', hotres: 'category_id' },
  { key: 'tags', label: 'Tagi', hotres: 'tags' },
  { key: 'customUrl', label: 'Własny adres', hotres: 'custom_url' },
  { key: 'photo', label: 'Zdjęcie', hotres: 'photo', kind: 'url' },
  { key: 'photoS', label: 'Zdjęcie (ścieżka)', hotres: 'photo_s' },
  { key: 'isPublic', label: 'Widoczny publicznie', hotres: 'public', kind: 'bool' },
  { key: 'forchannel', label: 'Wystawiony do channel managera', hotres: 'forchannel', kind: 'bool' },
  { key: 'validFrom', label: 'Obowiązuje od', hotres: 'valid_from', kind: 'date' },
  { key: 'validTill', label: 'Obowiązuje do', hotres: 'valid_till', kind: 'date' },
  { key: 'autocancelTime', label: 'Automatyczna anulacja', hotres: 'autocancel_time', hint: '„dis” = wyłączona' },
  { key: 'cancelRules', label: 'Reguły anulacji', hotres: 'cancel_rules' },
  { key: 'paymentTypes', label: 'Dozwolone płatności', hotres: 'payment_types' },
  { key: 'parentRateId', label: 'Cennik nadrzędny', hotres: 'parent_rate_id', hint: '0 = brak' },
  { key: 'parentPricechange', label: 'Zmiana wzgl. nadrzędnego', hotres: 'parent_pricechange' },
  { key: 'parentPriceval', label: 'Wartość zmiany', hotres: 'parent_priceval' },
  { key: 'parentPricecalc', label: 'Sposób liczenia zmiany', hotres: 'parent_pricecalc' },
];

export const RATE_DISCOUNT_FIELDS: Field[] = [
  { key: 'name', label: 'Nazwa rabatu', hotres: 'name' },
  { key: 'discount', label: 'Wartość', hotres: 'discount' },
  { key: 'mode', label: 'Typ', hotres: 'mode', hint: 'percent / amount' },
  { key: 'source', label: 'Liczony od', hotres: 'source' },
  { key: 'active', label: 'Aktywny', hotres: 'active', kind: 'bool' },
  { key: 'stayFrom', label: 'Pobyt od (nocy)', hotres: 'stay_from' },
  { key: 'stayTo', label: 'Pobyt do (nocy)', hotres: 'stay_to' },
  { key: 'minDays', label: 'Min. dni', hotres: 'min_days' },
  { key: 'minAmount', label: 'Min. kwota', hotres: 'min_amount' },
  { key: 'minDaysBefore', label: 'Min. wyprzedzenie (dni)', hotres: 'min_days_before' },
  { key: 'maxDaysBefore', label: 'Maks. wyprzedzenie (dni)', hotres: 'max_days_before' },
  { key: 'dateFrom', label: 'Obowiązuje od', hotres: 'date_from', kind: 'date' },
  { key: 'dateTo', label: 'Obowiązuje do', hotres: 'date_to', kind: 'date' },
  { key: 'arrivalFrom', label: 'Przyjazd od', hotres: 'arrival_from', kind: 'date' },
  { key: 'arrivalTo', label: 'Przyjazd do', hotres: 'arrival_to', kind: 'date' },
  { key: 'departureFrom', label: 'Wyjazd od', hotres: 'departure_from', kind: 'date' },
  { key: 'departureTo', label: 'Wyjazd do', hotres: 'departure_to', kind: 'date' },
  { key: 'roomsTypesIds', label: 'Dotyczy standardów (type_id)', hotres: 'rooms_types_ids', kind: 'long' },
];

export const RATE_TEXTS: Field[] = [
  { key: 'title', label: 'Nazwa', hotres: 'title' },
  { key: 'advert', label: 'Hasło reklamowe', hotres: 'advert', kind: 'long' },
  { key: 'description', label: 'Opis', hotres: 'description', kind: 'html' },
  { key: 'cancellation', label: 'Zasady anulacji', hotres: 'cancellation', kind: 'html' },
  { key: 'niceurl', label: 'Adres przyjazny', hotres: 'niceurl' },
  { key: 'metaTitle', label: 'Meta tytuł (SEO)', hotres: 'meta_title' },
  { key: 'metaDescription', label: 'Meta opis (SEO)', hotres: 'meta_description', kind: 'long' },
];

// ---------------------------------------------------------------------------
// Dodatki
// ---------------------------------------------------------------------------

export const ADDON_GROUPS: FieldGroup[] = [
  {
    title: 'Podstawowe',
    fields: [
      { key: 'hotresId', label: 'ID dodatku', hotres: 'addon_id' },
      { key: 'title', label: 'Nazwa', hotres: 'title' },
      { key: 'code', label: 'Kod', hotres: 'code' },
      {
        key: 'mode',
        label: 'Sposób naliczania',
        hotres: 'mode',
        hint: 'once / perperson / once_pp / perday',
      },
      { key: 'groupsId', label: 'Grupa dodatków', hotres: 'groups_id' },
      { key: 'template', label: 'Szablon prezentacji', hotres: 'template' },
      { key: 'photo', label: 'Zdjęcie', hotres: 'photo' },
    ],
  },
  {
    title: 'Ceny i stan',
    fields: [
      { key: 'price', label: 'Cena', hotres: 'price' },
      { key: 'priceChild1', label: 'Cena - dziecko 1', hotres: 'price_child1' },
      { key: 'priceChild2', label: 'Cena - dziecko 2', hotres: 'price_child2' },
      { key: 'priceChild3', label: 'Cena - dziecko 3', hotres: 'price_child3' },
      { key: 'tax', label: 'Stawka VAT', hotres: 'tax' },
      { key: 'stock', label: 'Stan magazynowy', hotres: 'stock' },
    ],
  },
  {
    title: 'Widoczność',
    fields: [
      { key: 'included', label: 'Wliczony w cenę', hotres: 'included', kind: 'bool' },
      { key: 'upselling', label: 'Upselling', hotres: 'upselling', kind: 'bool' },
      { key: 'bookingengine', label: 'W silniku rezerwacji', hotres: 'bookingengine', kind: 'bool' },
      { key: 'ondiscount', label: 'Objęty rabatami', hotres: 'ondiscount', kind: 'bool' },
      { key: 'visible', label: 'Widoczny', hotres: 'visible', kind: 'bool' },
      { key: 'active', label: 'Aktywny', hotres: 'active', kind: 'bool' },
    ],
  },
  {
    title: 'Warunki sprzedaży',
    fields: [
      { key: 'minNights', label: 'Min. nocy', hotres: 'min_nights' },
      { key: 'maxNights', label: 'Maks. nocy', hotres: 'max_nights' },
      { key: 'minAdults', label: 'Min. dorosłych', hotres: 'min_adults' },
      { key: 'maxAdults', label: 'Maks. dorosłych', hotres: 'max_adults' },
      { key: 'minAdvance', label: 'Min. wyprzedzenie (dni)', hotres: 'min_advance' },
      { key: 'maxAdvance', label: 'Maks. wyprzedzenie (dni)', hotres: 'max_advance' },
    ],
  },
  {
    title: 'Terminy',
    fields: [
      { key: 'dateFrom', label: 'Dostępny od', hotres: 'date_from', kind: 'date' },
      { key: 'dateTo', label: 'Dostępny do', hotres: 'date_to', kind: 'date' },
      { key: 'arrivalFrom', label: 'Przyjazd od', hotres: 'arrival_from', kind: 'date' },
      { key: 'arrivalTo', label: 'Przyjazd do', hotres: 'arrival_to', kind: 'date' },
      { key: 'departureFrom', label: 'Wyjazd od', hotres: 'departure_from', kind: 'date' },
      { key: 'departureTo', label: 'Wyjazd do', hotres: 'departure_to', kind: 'date' },
      { key: 'excludeFrom', label: 'Wykluczony od', hotres: 'exclude_from', kind: 'date' },
      { key: 'excludeTo', label: 'Wykluczony do', hotres: 'exclude_to', kind: 'date' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Vouchery, bilety, treści, konta
// ---------------------------------------------------------------------------

export const VOUCHER_FIELDS: Field[] = [
  { key: 'hotresId', label: 'ID vouchera', hotres: 'voucher_id' },
  { key: 'amount', label: 'Wartość', hotres: 'amount' },
  { key: 'currency', label: 'Waluta', hotres: 'currency' },
  { key: 'validDays', label: 'Ważność (dni)', hotres: 'valid_days' },
  { key: 'gift', label: 'Prezentowy', hotres: 'gift', kind: 'bool' },
  { key: 'priority', label: 'Priorytet', hotres: 'priority' },
  { key: 'photo', label: 'Zdjęcie', hotres: 'photo', kind: 'url' },
  { key: 'photoS', label: 'Zdjęcie (ścieżka)', hotres: 'photo_s' },
];

export const VOUCHER_TEXTS: Field[] = [
  { key: 'title', label: 'Nazwa', hotres: 'title' },
  { key: 'description', label: 'Opis', hotres: 'description', kind: 'html' },
  { key: 'niceurl', label: 'Adres przyjazny', hotres: 'niceurl' },
  { key: 'metaTitle', label: 'Meta tytuł (SEO)', hotres: 'meta_title' },
  { key: 'metaDescription', label: 'Meta opis (SEO)', hotres: 'meta_description', kind: 'long' },
];

export const TICKET_FIELDS: Field[] = [
  { key: 'hotresId', label: 'ID biletu', hotres: 'ticket_id' },
  { key: 'price', label: 'Cena', hotres: 'price' },
  { key: 'currency', label: 'Waluta', hotres: 'currency' },
  { key: 'stock', label: 'Dostępna pula', hotres: 'stock' },
  { key: 'maxCnt', label: 'Maks. na rezerwację', hotres: 'max_cnt' },
  { key: 'date', label: 'Termin wydarzenia', hotres: 'date', kind: 'datetime' },
  { key: 'priority', label: 'Priorytet', hotres: 'priority' },
  { key: 'photo', label: 'Zdjęcie', hotres: 'photo', kind: 'url' },
  { key: 'photoS', label: 'Zdjęcie (ścieżka)', hotres: 'photo_s' },
];

export const TICKET_TEXTS: Field[] = [
  { key: 'title', label: 'Nazwa', hotres: 'title' },
  { key: 'description', label: 'Opis', hotres: 'description', kind: 'html' },
];

export const REVIEW_FIELDS: Field[] = [
  { key: 'addDate', label: 'Data wystawienia', hotres: 'add_date', kind: 'datetime' },
  { key: 'author', label: 'Autor', hotres: 'author' },
  { key: 'source', label: 'Źródło', hotres: 'source' },
  { key: 'rate', label: 'Ocena', hotres: 'rate' },
  { key: 'lang', label: 'Język', hotres: 'lang' },
  { key: 'description', label: 'Treść opinii', hotres: 'description', kind: 'long' },
  { key: 'roomRate', label: 'Ocena - pokój', hotres: 'room_rate' },
  { key: 'serviceRate', label: 'Ocena - obsługa', hotres: 'service_rate' },
  { key: 'boardRate', label: 'Ocena - wyżywienie', hotres: 'board_rate' },
  { key: 'locationRate', label: 'Ocena - lokalizacja', hotres: 'location_rate' },
  { key: 'tags', label: 'Tagi', hotres: 'tags' },
  { key: 'reservationsId', label: 'ID rezerwacji', hotres: 'reservations_id' },
  { key: 'sourceReservationId', label: 'ID rezerwacji w kanale', hotres: 'source_reservation_id' },
];

export const INFORMATOR_FIELDS: Field[] = [
  { key: 'title', label: 'Tytuł', hotres: 'title' },
  { key: 'lang', label: 'Język', hotres: 'lang' },
  { key: 'advert', label: 'Podtytuł', hotres: 'advert' },
  { key: 'template', label: 'Szablon', hotres: 'template' },
  { key: 'width', label: 'Szerokość kafla (%)', hotres: 'width' },
  { key: 'icon', label: 'Ikona', hotres: 'icon' },
  { key: 'photo', label: 'Zdjęcie', hotres: 'photo', kind: 'url' },
  { key: 'addDate', label: 'Data dodania', hotres: 'add_date', kind: 'datetime' },
  { key: 'description', label: 'Treść', hotres: 'description', kind: 'html' },
];

export const USER_FIELDS: Field[] = [
  { key: 'uid', label: 'ID użytkownika', hotres: 'uid' },
  { key: 'name', label: 'Nazwa', hotres: 'name' },
  { key: 'email', label: 'E-mail', hotres: 'email' },
  { key: 'active', label: 'Aktywny', hotres: 'active', kind: 'bool' },
  { key: 'loginCount', label: 'Liczba logowań', hotres: 'login_count' },
  { key: 'loginDate', label: 'Ostatnie logowanie', hotres: 'login_date', kind: 'datetime' },
  { key: 'addDate', label: 'Data założenia', hotres: 'add_date', kind: 'datetime' },
];
