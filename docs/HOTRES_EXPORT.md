# Eksport z Hotres (Eksporter 3000)

Tymczasowe narzędzie migracyjne: pobiera **wszystkie statyczne** dane obiektu z Hotres
i zapisuje je do **lokalnej bazy SQLite pod Prismą** — nie do Supabase.

- Widok w Machinie: **Obiekt → Eksport Hotres** (`/property/:id/export`)
- GUI: `components/HotresExportView.tsx`
- Klient serwisu: `services/hotresExport.ts` (+ testy)
- Serwis + baza: `server/` — szczegóły w [`server/README.md`](../server/README.md)

## Architektura

```
Machina (Vite SPA)                  server/ (Node + Express + Prisma)
  HotresExportView  ──POST /api/export──►  runExport
        ▲                                    ├─► panel.hotres.pl   (bezpośrednio, bez proxy)
        └──── NDJSON: postęp na żywo ────────┤
                                             └─► SQLite (Prisma)
```

Prisma nie działa w przeglądarce, więc pobieranie i zapis dzieją się w serwisie,
a GUI tylko steruje i słucha postępu. Efekt uboczny, który jest zaletą:
poświadczenia Hotres wyszły z bundla do `server/.env`, a funkcja Edge `hotres-proxy`
nie bierze w tym udziale.

## Uruchomienie

```bash
cd server && npm install && npm run db:push && npm run dev
```

Bez działającego serwisu widok w Machinie nie udaje, że działa — pokazuje komunikat
i dokładnie te komendy.

## Co widać w GUI

- **Co siedzi w bazie** — liczniki per tabela + `Pobierz export.json` (pełny zrzut z bazy)
- **Konfiguracja** — OID, języki, odstęp między zapytaniami, przełącznik szczegółów
- **Zakres danych** — grupy zaciągane z `/api/catalogue`, więc katalog nie jest duplikowany
- **Postęp na żywo** — pasek, konsola i przycisk „Przerwij" (rozłączenie przerywa przebieg w serwisie)
- **Podsumowanie przebiegu** — zapisane/usunięte rekordy per grupa, błędy twarde i miękkie,
  oraz pola, których schemat nie zna
- **Historia przebiegów** — z tabeli `ExportRun`

## Zakres

Pobierane: `api_object`, `api_params`, `api_definitions`, `api_roomstypes` + `api_roomtype`,
`api_rooms`, `api_rates` + `api_rate`, `api_addons`, `api_vouchers` + `api_voucher`,
`api_tickets` + `api_ticket`, `api_reviews`, `api_informator`, `api_users`.

Pomijane świadomie: `api_availability`, `api_prices`, `api_blocks`, `api_reservations`,
`api_guests`, `api_payments`, `api_invoices`, `api_messages` — dane dynamiczne
i transakcyjne, osobny eksport.

Niezapisywane: `auth` i `apikey` z `api_object` — to poświadczenia, nie dane obiektu.

## Uwaga na później

To narzędzie jest **tymczasowe**. Kiedy migracja się skończy, do usunięcia idzie
cały katalog `server/`, widok, klient i wpis w routingu — nic z tego nie jest wplecione
w resztę Machiny poza jednym linkiem w Sidebarze.
