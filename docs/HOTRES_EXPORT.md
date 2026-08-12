# Eksport z Hotres

Narzędzie w Machinie do zrzucenia **wszystkich statycznych danych obiektu** z Hotres —
pod migrację na własny PMS.

- Widok: **Obiekt → Eksport Hotres** (`/property/:id/export`)
- GUI: `components/HotresExportView.tsx`
- Logika: `services/hotresExport.ts` (+ testy `services/hotresExport.test.ts`)

## Co pobiera

| Grupa | Endpoint | Zawartość |
|---|---|---|
| Obiekt | `api_object` | adres, kontakt, dane firmy, galeria, opis, regulamin, godziny doby |
| Parametry | `api_params` | pełna konfiguracja `be_*` |
| Słowniki | `api_definitions` | udogodnienia, ikony, kategorie |
| Pokoje fizyczne | `api_rooms` | numery, łóżka, piętro, stan, pola własne |
| Standardy | `api_roomstypes` + `api_roomtype` | lista typów + pełne opisy, galerie, meta |
| Plany cenowe | `api_rates` + `api_rate` | metadane cenników (**bez** kalendarza cen) |
| Dodatki | `api_addons` | ceny, stany, reguły sprzedaży |
| Vouchery | `api_vouchers` + `api_voucher` | vouchery i opisy |
| Bilety | `api_tickets` + `api_ticket` | wydarzenia, limity, stany |
| Opinie | `api_reviews` | publiczne opinie (maks. 300) |
| Informator | `api_informator` | kafle informacyjne dla gości |
| Użytkownicy | `api_users` | konta z dostępem do obiektu |

Endpointy oznaczone jako wielojęzyczne pobierane są dla każdego zaznaczonego języka
(`pl`, `en`, `de`, `cz`, `sk`, `ua`, `ru`, `fr`, `es`, `it`).

## Czego NIE pobiera — świadomie

`api_availability`, `api_prices`, `api_blocks`, `api_reservations`,
`api_reservationdetails`, `api_guests`, `api_payments`, `api_invoices`, `api_messages`.

To dane dynamiczne i transakcyjne — idą osobnym, jednorazowym eksportem. Hotres limituje
liczbę zapytań na godzinę, więc ten widok celowo ich nie dotyka.

## Jak działa

1. Wybierasz zakres (grupy), języki i czy dociągać szczegóły per element.
2. Zapytania lecą przez funkcję Edge `hotres-proxy` (te same dane dostępowe, co reszta aplikacji).
3. Między zapytaniami trzymany jest stały odstęp (domyślnie 350 ms) — do wyboru w GUI.
4. Postęp widać na pasku i w konsoli na żywo; eksport można przerwać.
5. Wynik pobierasz jako `all.json` (całość + manifest) albo per grupa.

### Struktura `all.json`

```jsonc
{
  "oid": "474",
  "exported_at": "2026-08-12T09:00:00.000Z",
  "langs": ["pl", "en"],
  "requests": 42,
  "counts": { "roomstypes": 8, "roomtypes": 8 },
  "errors": [],
  "excluded": [{ "action": "api_availability", "reason": "dostępność - dane dynamiczne" }],
  "data": {
    "params": { "be_currency": "PLN" },          // endpoint bez tłumaczeń → surowa odpowiedź
    "roomstypes": { "pl": [], "en": [] },        // endpoint tłumaczony → mapa lang → odpowiedź
    "roomtypes":  { "pl": { "29411": {} } }      // szczegóły → mapa lang → id → odpowiedź
  }
}
```

## Błędy

- **twarde** (czerwone) — endpoint wymagany nie odpowiedział; dane grupy są niepełne,
- **miękkie** (szare) — endpoint opcjonalny albo 404 na pojedynczym elemencie
  (Hotres potrafi trzymać na liście element, którego szczegóły już nie istnieją).

Eksport nigdy nie przerywa się przez pojedynczy błędny endpoint — wszystko ląduje
w sekcji `errors` w wyniku.
