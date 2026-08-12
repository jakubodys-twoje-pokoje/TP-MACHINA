# Eksporter 3000

Tymczasowe narzędzie migracyjne: ciągnie **statyczne** dane obiektu z Hotres
i rozkłada je na znormalizowane tabele w lokalnej bazie **SQLite pod Prismą**.

Stoi **obok Supabase, nie w nim** — to przystanek w drodze na własny PMS.

## Dlaczego osobny serwis

Machina to czysty Vite SPA, a Prisma nie działa w przeglądarce. Przy okazji
serwis rozwiązuje trzy rzeczy:

- woła Hotres po stronie serwera, więc **funkcja Edge `hotres-proxy` nie jest tu potrzebna** (brak CORS),
- **poświadczenia Hotres siedzą w `.env`**, a nie w bundlu przeglądarki,
- eksport nie zależy od sesji Supabase.

## Uruchomienie

```bash
cd server
cp .env.example .env       # uzupełnij HOTRES_API_PASSWORD
npm install
npm run db:push            # tworzy plik eksporter3000.db
npm run dev                # http://localhost:4000
```

Potem w Machinie: **Obiekt → Eksport Hotres**. Jeśli serwis nie działa, widok
powie to wprost i pokaże te komendy.

Inny port? `PORT=5000` w `.env` serwisu i `VITE_EKSPORTER_API=http://localhost:5000`
w `.env` Machiny.

| Komenda | Co robi |
|---|---|
| `npm run dev` | serwis z auto-restartem |
| `npm run db:push` | zakłada/aktualizuje schemat w SQLite |
| `npm run db:studio` | Prisma Studio — klikalny podgląd bazy |
| `npm test` | testy (30) |
| `npm run typecheck` | `tsc --noEmit` |

## Endpointy

| Metoda | Ścieżka | Do czego |
|---|---|---|
| `GET` | `/health` | ping z GUI |
| `GET` | `/api/catalogue` | grupy, języki i lista pomijanych endpointów — GUI buduje z tego formularz |
| `POST` | `/api/export` | uruchamia eksport, streamuje postęp jako NDJSON |
| `GET` | `/api/runs?oid=` | historia przebiegów |
| `GET` | `/api/runs/:id` | przebieg ze statystykami, błędami i nieznanymi polami |
| `GET` | `/api/properties/:oid/snapshot` | liczniki „co siedzi w bazie" |
| `GET` | `/api/properties/:oid/export.json` | pełny zrzut obiektu z bazy |

Rozłączenie klienta w trakcie `POST /api/export` przerywa przebieg.

## Co ląduje w bazie

`api_object`, `api_params`, `api_definitions`, `api_roomstypes` + `api_roomtype`,
`api_rooms`, `api_rates` + `api_rate`, `api_addons`, `api_vouchers` + `api_voucher`,
`api_tickets` + `api_ticket`, `api_reviews`, `api_informator`, `api_users`.

**Świadomie pomijane:** `api_availability`, `api_prices`, `api_blocks`,
`api_reservations`, `api_guests`, `api_payments`, `api_invoices`, `api_messages`.
Dane dynamiczne i transakcyjne idą osobnym eksportem — Hotres limituje zapytania na godzinę.

**Świadomie niezapisywane:** pola `auth` i `apikey` z `api_object`. To poświadczenia
dostępowe, nie dane obiektu.

## Zasady, które warto znać

**Pełna normalizacja.** Żadnych blobów JSON — każde pole ma kolumnę, tłumaczenia
siedzą w osobnych tabelach (`*Translation`), a listy w rodzaju `facilities: "22,7,73"`
czy `rates_ids: [...]` są rozbite na relacje.

**Pierwszy wybrany język jest kanoniczny.** Z niego biorą się wartości bazowe rekordu;
pozostałe języki lądują wyłącznie w tabelach tłumaczeń.

**Powtórny eksport aktualizuje, nie duplikuje.** Wszystko jest upsertowane po
`(propertyId, hotresId)`.

**Kasowanie sierot jest warunkowe.** Rzeczy usunięte w Hotresie znikają też z bazy —
ale tylko gdy lista pobrała się bez twardego błędu. Chwilowa awaria API nie wyczyści
dobrych danych.

**Relacje wiszą luźno.** Dodatek wskazujący na nieistniejący cennik zachowuje jego
identyfikator (`rateHotresId`) z pustą relacją — nic nie ginie.

**Nieznane pola są raportowane.** Przy pełnej normalizacji zmiana w API Hotres
mogłaby zniknąć po cichu, więc każde pole spoza schematu ląduje w tabeli
`UnmappedField` i jest widoczne w GUI po przebiegu.

## Struktura

```
src/catalogue.ts   katalog endpointów (kolejność = kolejność importu, wymuszona relacjami)
src/hotres.ts      klient API: throttle, ponawianie, klasyfikacja błędów
src/coerce.ts      rzutowanie stringów Hotresa na typy ("0" → false, "" → null)
src/fetchAll.ts    faza pobierania do pamięci
src/importers.ts   faza zapisu: payload → modele Prismy
src/runExport.ts   orkiestracja przebiegu + ExportRun
src/db.ts          klient Prismy, snapshot i liczniki
src/server.ts      Express + streaming NDJSON
```
