# Gap Protection Engine (System Ochrony Luk) — Analiza i Projekt

> **Status:** TYLKO ANALIZA I PROJEKT. Brak wdrożenia, brak migracji, brak zmian w
> działającym kodzie / schemacie / edge functions. Prototyp rdzenia leży osobno w
> `docs/prototypes/gapEngine.ts` (niezintegrowany, bez I/O, poza buildem).
>
> **Źródło prawdy reguł:** specyfikacja zadania (glosariusz + niezmienniki logiki).
> Silnik liczy WSZYSTKO z lokalnych tabel. Hotres to wyłącznie cel pushu gotowego
> wyniku przez istniejący pipeline — nie jest źródłem ani walidatorem.

---

## 0. Status implementacji (zrealizowane)

Plan z §9 został zaimplementowany. Weryfikacja: `npm test` → **26 testów OK**,
`npm run build` (vite/esbuild) → **OK**.

| Etap | Status | Artefakty |
|---|---|---|
| 1. Rdzeń (pure shared TS) | ✅ | `engine/gapEngine.ts`, `engine/dates.ts`, `engine/types.ts`, `engine/index.ts` |
| 1. Testy rdzenia (10 obowiązkowych) | ✅ | `engine/gapEngine.test.ts` (vitest, 14 asercji) + prototyp `docs/prototypes/gapEngine.ts` |
| 2. Migracje DB | ✅ | `supabase/migrations/create_gap_restrictions.sql`, `…_gap_engine_config.sql`, `…_gap_overrides.sql` |
| 3. `buildGaps` + `resolveConfig` + testy | ✅ | `engine/buildGaps.ts`, `engine/resolveConfig.ts`, `*.test.ts` (12 asercji) |
| 4. Edge function | ✅ | `supabase/functions/compute-gap-restrictions/index.ts` (import rdzenia) |
| 5. Frontend: serwis + wizualizacja + recompute + override | ✅ | `services/gapProtection.ts`, integracja w `components/CalendarView.tsx` |
| 6. Push z `gap_restrictions` → Hotres | ✅ | `pushGapRestrictionsToHotres` + akcja `'gaps'` w modalu wyboru cenników |
| 7. Wygaszenie AI | ✅ (disable) | flaga `AI_SUGGESTIONS_ENABLED=false`; bannery DEPRECATED w docs AI/n8n |
| 8. Tryby pracy (Off/Suggest/Autofill) + cron | ✅ | `mode` w `gap_engine_config`; `gap-autofill` edge + `_shared/gapCompute.ts`/`gapPush.ts`; `schedule_gap_autofill.sql`; toggle w UI |

**Decyzje przyjęte (domyślne z §11, do potwierdzenia):** standardowy Min LOS z
`gap_engine_config` (fallback default); `min_gap=3`, `emergency_gap=2`,
`last_minute_lead_days=7`, `horizon_days=365`; tryb awaryjny = flaga w configu **lub**
auto last-minute; override loosen/tighten z `expires_at`; push CTA/CTD/MIN (max opcjonalnie).
Wygaszenie AI jako **disable flagą** (bez kasowania kodu) — pełny `DROP`/usunięcie kodu
jako świadomy follow-up.

> **Uwaga wdrożeniowa:** migracje SQL i deploy edge function `compute-gap-restrictions`
> trzeba uruchomić na środowisku Supabase (brak dostępu do DB/deploy z tej sesji).
> Do czasu utworzenia tabel front-end degraduje się łagodnie (puste `gap_restrictions`,
> przycisk „Przelicz" zgłosi błąd z edge function).

---

## 1. Stan obecny (Discovery)

Zweryfikowane w kodzie na branchu `claude/focused-gates-1HKyf`.

### 1.1 Dostępność → skąd liczyć luki
- Typ: `Availability` — `types.ts:48-54` (`unit_id, date, status 'available'|'booked'|'blocked', reservation_id`).
- Tabela `availability`, upsert `onConflict: 'unit_id,date'`:
  - `supabase/functions/sync-single-property/index.ts:151`
  - `supabase/functions/sync-all-availability/index.ts:463`
- Odczyt do kalendarza: `components/CalendarView.tsx:346-386` (`fetchQuarterAvailability`, okno −30/+60 dni od wybranej daty, chunkowane `.in()` po 50 unitów).
- **Nigdzie nie ma wyliczania luk.** Brak funkcji, która z ciągów `available` robi `(gap_start, gap_end, gap_length)`. To trzeba zbudować od zera.

### 1.2 Ceny i restrykcje wejściowe
- Typ: `Price` — `types.ts:146-159` (`unit_id, rate_id, date, price, min, max, cta 0|1, ctd 0|1, cta_synced, ctd_synced`).
- Schemat: `supabase/migrations/create_prices_table.sql` — `UNIQUE(unit_id, rate_id, date)`, `min`/`max INTEGER`, `cta`/`ctd SMALLINT CHECK IN (0,1)`. Komentarz w migracji potwierdza: `min` = „Minimum length of stay (nights)".
- Upsert `onConflict: 'unit_id,rate_id,date'`:
  - `sync-single-property/index.ts:324`
  - `sync-all-availability/index.ts:850`
- Odczyt + mapowanie pod wybrany cennik: `CalendarView.tsx:388-470` (`fetchPricesData`) + `CalendarView.tsx:288-312` (`buildPricesMap` — wybiera `rate_id` == `unitRatePlan.get(unit) || defaultRatePlanId`).
- Kontekst cennika w widoku: `units.selected_rate_plan_id` (`types.ts:45`), stan `unitRatePlan` (`CalendarView.tsx:85`), auto-detekcja pierwszego dostępnego planu per unit (`CalendarView.tsx:435-446`).

### 1.3 Edycja CTA / CTD / Min (per dzień, ręczna)
- `handleCtaChange` — `CalendarView.tsx:1796`
- `handleCtdChange` — `CalendarView.tsx:1826`
- `handleMinChange` — `CalendarView.tsx:1856`
- Wszystkie wpisują delty do `priceChanges: Map<"unitId_date", Partial<Price>>` i kasują wpis, gdy wartość wraca do oryginału.
- Render komórki (checkboxy CTA/CTD + input MIN, kolory pending/synced): `CalendarView.tsx:2908-3010`.
- Bulk edit (zaznaczanie wielu komórek): `CalendarView.tsx:114-119, 635-679`.

### 1.4 Push wyniku do Hotres (istniejący pipeline — reużywamy)
Trzy ścieżki, wszystkie budują payload `{type_id, rate_id, mode:'delta', prices:[{from,till,cta,ctd,min}]}` i wołają edge function:
- **Delta zmian** (tylko `priceChanges`): `sendPriceChangesToHotres` — `CalendarView.tsx:997-1190`.
- **Push całej bazy w zakresie widoku**: `handlePushDBToHotres` / `executePushDBToHotres` — `CalendarView.tsx:838-995`.
- **Override (CTA/CTD/MIN, pełny zakres 20.01–31.12.2026)**: `executeOverride` / `sendAllPricesToHotres` — `CalendarView.tsx:1569-1768`.
- Wybór cenników docelowych jest **niezależny** od wyświetlanego planu, trzymany per property w `localStorage`, modal pyta za każdym razem: `selectedPushRatePlanIds` (`:92`), `openPushModal` (`:731`), `confirmPushModal` (`:744`), persist (`:209-213`).
- Edge function: `supabase/functions/update-hotres-prices/index.ts` — bierze `{property_id, payload[]}`, dociąga `properties.hotres_id` jako `oid`, normalizuje `type_id`/`rate_id` do `int`, POST `panel.hotres.pl/api_updateprices`. **Brak jakiejkolwiek walidacji „po stronie Hotres" — to czysty transport.**

### 1.5 Kompresja zakresów (reużywalny helper)
Identyczna logika „grupuj kolejne dni o tych samych wartościach w `{from, till}`" występuje w 4 miejscach — to wzorzec do reużycia w silniku:
- `isNextDay` (noon-normalizacja, anty-DST): `CalendarView.tsx:914, 1055, 1670`.
- Pętla grupująca delty/ceny: `CalendarView.tsx:1099-1141`, `:929-952`, `:1712-1754`.
- `groupConsecutiveDates` (dla notyfikacji): `sync-all-availability/index.ts:97-140`.
- Formatowanie daty bez przesunięcia UTC: `toLocalDateStr` — `CalendarView.tsx:504`.

### 1.6 Pull tła
- `sync-single-property` i `sync-all-availability` — pełny pull availability + prices z Hotres do tabel lokalnych. To miejsce, za którym ma się odpalać przeliczenie silnika.

### 1.7 Stara heurystyka AI (DO WYGASZENIA — patrz §7)
- Typ `AISuggestion`: `types.ts:161-180`.
- W `CalendarView.tsx`: `aiSuggestions` state (`:98`), `fetchAISuggestions` (`:2011`), `handleApplySuggestion` (`:2043`), `handleRejectSuggestion` (`:2090`), `handleAcceptAll` (`:2117`), `handleFeedback` (`:2172`), `hasAISuggestion` (`:2198`), żółty render komórki AI (`:2873-2965`), przycisk „Akceptuj wszystkie" (`:2550`).
- Tabele: `ai_suggestions`, `ai_suggestion_feedback`.
- Infrastruktura: `docs/AI_CTA_CTD_AUTOMATION.md`, `docs/N8N_IMPORT_INSTRUCTIONS.md`, `n8n-ai-cta-workflow.json` (n8n + Gemini Flash).

---

## 2. Braki (czego nie ma)

| Brak | Opis |
|---|---|
| **Wyliczanie luk** | Brak kodu zamieniającego ciągi `available` w `(gap_start, gap_end, gap_length)`, ograniczane przez `booked`/`blocked`/dziś/horyzont. |
| **Rdzeń decyzyjny** | Brak deterministycznej funkcji luka+config → CTA/CTD/Min/Max per dzień. CTA/CTD/MIN dziś są wyłącznie ręczne lub z AI. |
| **`effective_min_los`** | Brak dynamicznego Min LOS (sezon, długość luki, min/awaryjna luka, lead time, tryb awaryjny, override). |
| **`max_los`** | Kolumna `prices.max` istnieje, ale UI jej nie edytuje ani nie pushuje. Brak wyliczania. |
| **Reguły sezon/kanał/zakres dat** | Brak jakiejkolwiek konfiguracji per property/unit_type/sezon/kanał. Stałe (limit 10/h, daty 20.01–31.12.2026) są zaszyte w kodzie. |
| **Warstwa wyniku + audyt** | Brak miejsca na `reason`, `gap_id`, `source` (auto vs ręczne), `confidence`. `prices` tego nie ma. |
| **Konfiguracja** | Brak tabel config; brak rozstrzygnięcia czy standardowy Min LOS bierzemy z `prices.min` czy z osobnego configu (→ §9 decyzja). |
| **Override z trwałością** | Ręczne zmiany w `priceChanges` są ulotne (stan React) i nie przeżywają przeliczenia. Brak trwałych override'ów per data. |

---

## 3. Architektura jednego wspólnego silnika

### 3.1 Gdzie żyje rdzeń — decyzja i uzasadnienie

**Rdzeń = czysta, bezstanowa funkcja w współdzielonym module TS** (`engine/gapEngine.ts`),
importowana zarówno przez nową edge function (Deno) jak i opcjonalnie przez frontend
(Vite) do podglądu na żywo.

| Opcja | Werdykt | Dlaczego |
|---|---|---|
| **Shared TS module (rdzeń) + edge function (I/O)** | ✅ **WYBRANE** | Jedno źródło prawdy. Ten sam kod TS działa w Deno (edge) i w przeglądarce (podgląd operatora). Testowalny jednostkowo bez DB (patrz prototyp). Zero duplikacji logiki. |
| Postgres RPC (PL/pgSQL) | ❌ | Forkuje logikę do SQL — nietestowalne tak jak prototyp, nie do reużycia w przeglądarce, trudny audyt. |
| Tylko edge function | ❌ | Brak podglądu na żywo w kalendarzu (operator musiałby czekać na round-trip). Logika zamknięta serwerowo. |
| Część istniejącego `sync-*` | ❌ | Miesza pull (I/O ciężkie) z czystą decyzją. Chcemy móc przeliczyć bez pełnego pulla. |

**Granica czystości:** rdzeń nie wie nic o Supabase, `fetch`, datach „dziś" z zegara
ani o Hotresie. Dostaje na wejściu **już wyliczone luki + już rozwiązany config +
override'y**; zwraca tablicę restrykcji per dzień. Całe I/O (odczyt `availability`/`prices`,
rozwiązanie sezonu/kanału, zapis, push) jest w warstwie edge/frontend.

### 3.2 Warstwy

```
                        ┌──────────────────────────────────────────────┐
   pull tła             │  WARSTWA I/O  (edge fn: compute-gap-          │
 sync-single-property → │  restrictions, Deno)                         │
 sync-all-availability  │   1. czytaj availability + prices (lokalne)  │
                        │   2. buildGaps(availability)  → Gap[]        │
                        │   3. resolveConfig(date,unit) → GapEngineCfg │
                        │   4. czytaj gap_overrides     → Override[]   │
                        │            │                                 │
                        │            ▼                                 │
                        │   ┌───────────────────────────────┐         │
                        │   │  RDZEŃ (pure, shared TS)       │         │
                        │   │  computeGapRestrictions(       │         │
                        │   │     gap, config, overrides)    │         │
                        │   │  → DayRestriction[]            │         │
                        │   └───────────────────────────────┘         │
                        │            │                                 │
                        │            ▼                                 │
                        │   5. upsert gap_restrictions                 │
                        │      (onConflict unit_id,rate_id,date)       │
                        └──────────────────────────────────────────────┘
                                     │
   operator klika „Wyślij"          ▼
                        ┌──────────────────────────────────────────────┐
                        │  PUSH (istniejący pipeline)                  │
                        │   compress ranges (isNextDay) →              │
                        │   payload {type_id,rate_id,delta,prices[]} → │
                        │   update-hotres-prices → Hotres              │
                        └──────────────────────────────────────────────┘
                                     ▲
                        ┌────────────┴───────────────┐
                        │  FRONTEND (podgląd na żywo) │
                        │  importuje TEN SAM rdzeń    │
                        │  do wizualizacji w kalendarzu│
                        └─────────────────────────────┘
```

---

## 4. Finalna logika silnika (rdzeń)

### 4.1 Model luki (konwencja brzegowa — zgodna 1:1 ze spec)

Każdy `date` w `availability` to **noc**. Luka to maksymalny ciąg nocy `available`,
ograniczony przez `booked`/`blocked` albo przez dziś / koniec horyzontu.

Przyjmujemy **model brzegowy** (pasuje dokładnie do arytmetyki ze spec):

- `gap_start` = najwcześniejsza możliwa **data przyjazdu** = pierwsza wolna noc.
- `gap_end` = najpóźniejsza możliwa **data wyjazdu** = poranek po ostatniej wolnej nocy
  (= check-in następnej rezerwacji albo horyzont+1).
- `L` (długość luki, w nocach) = `gap_end − gap_start`. Czyli **k wolnych nocy ⇒ L = k**.

Pobyt to `(arrival, departure)`, liczba nocy = `departure − arrival`. Przesunięcia od
`gap_start`: przyjazd `a ∈ [0..L−1]`, wyjazd `d ∈ [a+min_los .. L]`. Wiersz restrykcji
zapisujemy dla nocy `addDays(gap_start, p)`, `p ∈ [0..L−1]`.

**Niezmiennik (mapowanie wprost ze spec):**
```
left_remaining_gap  = arrival − gap_start = a
right_remaining_gap = gap_end − departure = L − d

pobyt akceptowalny  ⇔
   (a === 0           OR a >= minimal_acceptable_gap)        # lewa: flush albo sprzedawalna
   AND (L − d === 0   OR (L − d) >= minimal_acceptable_gap)  # prawa: flush albo sprzedawalna
   AND (d − a) >= effective_min_los
   AND (max_los == null OR (d − a) <= max_los)
```

**Założenie operacyjne (rozwiązuje podział luki):** restrykcje są **przeliczane przy
każdym syncu dostępności**. Kształtują **następną pojedynczą rezerwację**; sąsiadujące
wypełnienia (np. 3+3) powstają iteracyjnie — pierwsza rezerwacja dzieli lukę, kolejny
sync wylicza świeże luki na nowo. Dlatego „pozostała luka" zawsze jest realnie pusta i
niezmiennik liczony względem bieżącej (pustej) luki jest poprawny.

### 4.2 `effective_min_los` (dynamiczny)

```
lastMinute = gap.leadDays <= cfg.lastMinuteLeadDays
emergency  = cfg.emergencyMode OR lastMinute
gapFloor   = emergency ? cfg.emergencyAcceptableGap : cfg.minAcceptableGap

effMinLos  = cfg.standardMinLos
if cfg.standardMinLos > L:          # standardowy pobyt się nie mieści
    if emergency AND cfg.allowShortenMinLos:
        effMinLos = L               # spłaszcz do jednego pobytu na całość (priorytet 4)
    else:
        UNSELLABLE                  # priorytet 5: nie zostawiaj cicho fragmentu — zamknij, flaga override
```

### 4.3 Algorytm (iteracja arrival × departure)

1. Policz `effMinLos`, `gapFloor`, flagi (§4.2).
2. Jeśli `UNSELLABLE`: każdy dzień `cta=1`, `ctd=1` (oprócz dnia 0, gdzie `ctd=0` — to
   dzień wymeldowania poprzedniego gościa), `reason='gap_unsellable_below_min_los'`,
   `confidence=0.3`. Wymaga ręcznego override. Koniec.
3. **Enumeruj zbiór akceptowalnych pobytów `S`** podwójną pętlą `a × d` z warunkami §4.1.
4. Dla każdej nocy `p ∈ [0..L−1]`:
   - `cta(p) = 0` jeśli istnieje pobyt z `a===p`, inaczej `1`.
   - `ctd(p)`: dla `p===0` zawsze `0` (brzeg — wymeldowanie poprzedniej rezerwacji).
     Dla `p≥1`: `0` jeśli istnieje pobyt z `d===p` (uwaga: `d===L` ląduje na `gap_end`,
     który nie jest naszym wierszem), inaczej `1`.
   - `min_los(p) = min(len)` wśród przyjazdów z `a===p` (gdy `cta=0`); gdy `cta=1` → `effMinLos`.
   - `max_los(p) = max(len)` wśród przyjazdów (opcjonalnie przycięte przez `cfg.maxLos`).
   - `reason` = przyczyna zamknięcia (left_gap / right_gap / min_los_tail / head) lub `arrival_open`.
   - `source='auto'`, `confidence = (emergency||shortened) ? 0.6 : 1.0`.
5. **Nałóż override'y** per data: pola podane przez operatora wygrywają, `source='manual'`,
   `confidence=1.0`, `reason` z override'a.

**Dlaczego to spełnia priorytety spec:**
- (1) *nie twórz luk < min_acceptable_gap* → warunki left/right w §4.1 wykluczają każdy
  pobyt zostawiający 1..gapFloor−1 nocy; CTA/CTD na właściwych dniach to egzekwują.
- (2) *preferuj wypełnienie całej luki* → gdy żaden podział nie jest dopuszczalny, jedynym
  elementem `S` jest `(0, L)` (pełne wypełnienie) — patrz T1/T6/T10a.
- (3) *podział tylko gdy obie części akceptowalne* → podział istnieje w `S` wyłącznie, gdy
  każda część ma `≥ gapFloor` lub `0` reszty (T2/T7); zły podział jest odrzucany (T8).
- (4) *w wyjątku obniż Min LOS* → `effMinLos = L` w trybie awaryjnym (T3).
- (5) *nigdy nie zostawiaj niesprzedawalnego fragmentu bez override* → gałąź `UNSELLABLE`
  (T3b) zamyka lukę i obniża `confidence`, czekając na decyzję operatora.

### 4.4 Sygnatury TypeScript (rdzeń)

```ts
export type Bool01 = 0 | 1;

export interface Gap {
  gapId: string; unitId: string;
  startDate: string;   // pierwsza wolna noc = najwcześniejszy przyjazd (ISO)
  length: number;      // L = gap_end - gap_start (noce)
  leadDays: number;    // noce od „dziś" do startDate
}

export interface GapEngineConfig {
  standardMinLos: number;
  minAcceptableGap: number;
  emergencyAcceptableGap: number;
  maxLos: number | null;
  lastMinuteLeadDays: number;
  emergencyMode: boolean;
  allowShortenMinLos: boolean;
}

export interface Override { date: string; cta?: Bool01; ctd?: Bool01; minLos?: number | null; reason?: string; }

export interface DayRestriction {
  date: string; cta: Bool01; ctd: Bool01;
  minLos: number | null; maxLos: number | null;
  reason: string; gapId: string;
  source: 'auto' | 'manual'; confidence: number; // 0..1
}

// PURE, bezstanowa, bez I/O:
export function computeGapRestrictions(gap: Gap, cfg: GapEngineConfig, overrides?: Override[]): DayRestriction[];

// Pomocnicze (też pure), w warstwie I/O lub przy rdzeniu:
export function buildGaps(rows: {date:string; status:string}[], todayISO: string, horizonISO: string): Gap[];
export function resolveConfig(ctx: {date:string; unitType?:string; season?:string; channel?:string}, configs: GapEngineConfig[]): GapEngineConfig;
```

Pełna, działająca implementacja + 30 asercji: **`docs/prototypes/gapEngine.ts`**
(uruchom `npx tsx docs/prototypes/gapEngine.ts` → `RESULT: 30 passed, 0 failed`).

---

## 5. Tabela przykładów (10 obowiązkowych testów)

Notacja per dzień: **`CTA/CTD/Min`** dla kolejnych nocy luki (offset 0..L−1).
Wartości wygenerowane i zweryfikowane przez prototyp (`docs/prototypes/gapEngine.ts`).
Domyślny `minGap = 3`, `gapFloor` = `minGap` poza trybem awaryjnym.

| # | Scenariusz | Wejście | Wynik per dzień (CTA/CTD/Min) | Interpretacja |
|---|---|---|---|---|
| 1 | Luka 5, MinLOS 3, min.luka 3 | L=5 | `0/0/5` `1/1/3` `1/1/3` `1/1/3` `1/1/3` | Każdy podział zostawia <3 → **wymuszony pełny pobyt 5 nocy** (przyjazd tylko dzień 0, Min=5). |
| 2 | Luka 7, MinLOS 3, min.luka 3 | L=7 | `0/0/3` `1/1/3` `1/1/3` `0/0/4` `0/0/3` `1/1/3` `1/1/3` | Bogaty zbiór: 3+4, 4+3 lub całość. Przyjazd dz.0 (Min 3), dz.3 (Min 4→do końca), dz.4 (Min 3→do końca). |
| 3 | Luka 3, MinLOS 6, **awaryjna** min.luka 3, tryb awaryjny | L=3, emergency | `0/0/3` `1/1/6` `1/1/6` | LOS 6>3 → awaryjne obniżenie do 3 → jeden pobyt na całość (dz.0 Min 3). Dni CTA pokazują bazowy Min 6 (informacyjnie). `confidence=0.6`. |
| 3b | jw. **bez** trybu awaryjnego | L=3, MinLOS 6 | `1/0/6` `1/1/6` `1/1/6` | Niesprzedawalna → wszystko CTA, dz.0 CTD=0 (wymeldowanie poprzedniego), `confidence=0.3`, czeka na override. |
| 4 | Rezerwacja zostawia 1 noc po **prawej** | L=6 | `0/0/3` `1/1/3` `1/1/3` `0/0/3` `1/1/3` `1/1/3` | Wyjazd na offsecie 5 (reszta 1) → **CTD=1**; offset 4 (reszta 2) → CTD=1. Dozwolone tylko 3+3 lub całość. |
| 5 | Rezerwacja zostawia 1 noc po **lewej** | L=6 | jw. | Przyjazd na offsecie 1 (reszta 1) i 2 (reszta 2) → **CTA=1**; offset 3 (reszta 3, sprzedawalna) → CTA=0. |
| 6 | Rezerwacja wypełnia całą lukę | L=4, MinLOS 4 | `0/0/4` `1/1/4` `1/1/4` `1/1/4` | Jedyny akceptowalny pobyt = pełne 4 noce. |
| 7 | Podział na dwie poprawne części | L=8, MinLOS 4, min.luka 4 | `0/0/4` `1/1/4` `1/1/4` `1/1/4` `0/0/4` `1/1/4` `1/1/4` `1/1/4` | Czysty podział 4+4 (przyjazd dz.0 i dz.4) lub całość 8. |
| 8 | Podział: jedna poprawna, jedna błędna | L=5, MinLOS 2, min.luka 3 | `0/0/2` `1/1/2` `1/0/2` `0/1/2` `1/1/2` | 2-nocny pobyt dozwolony tylko gdy zostawia sprzedawalne 3. Przyjazd dz.2 (zostawiłby 1 dead noc z lewej) **zablokowany** (CTA=1); wyjazd dz.3 (zostawiłby 2<3 z prawej) **zablokowany** (CTD=1). |
| 9 | Ręczne nadpisanie operatora | L=7 + override dz.5 `{cta:0,ctd:0,min:2}` | dz.5: `0/0/2`, `source=manual`, `confidence=1`, `reason=operator_last_minute`; reszta auto | Override wygrywa nad auto na wskazanej dacie; pozostałe dni bez zmian. |
| 10 | Sezon wysoki vs niski (ta sama luka L=6) | high: MinLOS 4, minLuka 3 / low: MinLOS 2, minLuka 2 | **high:** `0/0/6` `1/1/4` `1/1/4` `1/1/4` `1/1/4` `1/1/4`  ·  **low:** `0/0/2` `1/1/2` `0/0/2` `0/0/3` `0/0/2` `1/1/2` | Wysoki sezon wymusza pełne 6 nocy; niski dopuszcza krótkie pobyty i podziały. |

> **Min LOS per data (z cennika):** standardowy Min LOS dla każdego dnia przyjazdu jest
> brany z `prices.min` wybranego cennika dla **tej daty** (wartość MIN z kalendarza), a nie
> z jednej wartości na całą lukę. `gap_engine_config.standard_min_los` jest tylko fallbackiem,
> gdy w cenniku brak MIN. Przekazywane do rdzenia jako `minLosByDate` (4. argument
> `computeGapRestrictions`). Decyzja §11.1 rozstrzygnięta: **źródłem jest cennik**.
>
> **Uwaga o projekcji per-dzień:** zbiór dozwolony przez per-dniowe CTA/CTD/Min jest w
> ogólności **nadzbiorem** ścisłego `S` (restrykcje kanałowe nie wyrażają dowolnych
> zbiorów par). Dla wszystkich 10 przypadków projekcja pokrywa się z `S`. W rzadkich,
> dłuższych lukach z wieloma równoległymi podziałami możliwy jest pojedynczy „przeciek";
> mitygacja: przeliczenie po każdym syncu zawęża lukę i samonaprawia stan. Udokumentowane,
> akceptowane (standard dla channel managerów).

---

## 6. Struktura danych

### 6.1 Wynik silnika — **nowa tabela `gap_restrictions`** (NIE rozszerzamy `prices`)

Uzasadnienie: `prices` to **lustro Hotresa** (pull). Mieszanie tam wyniku silnika +
audytu (`reason/gap_id/source/confidence`) zaśmieciłoby pull i ryzykowałoby nadpisanie
przy następnym syncu. Trzymamy wynik osobno, z tą samą kardynalnością i kluczem konfliktu.

```sql
-- PROJEKT (nie migracja, nie uruchamiać w tej fazie)
CREATE TABLE gap_restrictions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  rate_id     UUID NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  cta         SMALLINT CHECK (cta IN (0,1)),
  ctd         SMALLINT CHECK (ctd IN (0,1)),
  min_los     INTEGER,
  max_los     INTEGER,
  gap_id      TEXT,                 -- stabilny id luki (np. unit:gap_start)
  reason      TEXT,                 -- 'cta_protect_left_gap', 'arrival_open', ...
  source      TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  confidence  NUMERIC(3,2) NOT NULL DEFAULT 1.0,  -- 0..1
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(unit_id, rate_id, date)    -- ten sam onConflict co prices → spójny push
);
CREATE INDEX idx_gap_restr_unit_date ON gap_restrictions(unit_id, date);
CREATE INDEX idx_gap_restr_gap ON gap_restrictions(gap_id);
```

> `rate_id` w wyniku odzwierciedla wybrany cennik kontekstu (`unitRatePlan` / `selected_rate_plan_id`).
> CTA/CTD/MIN są w Hotresie współdzielone per `type_id`, ale klucz `unit_id,rate_id,date`
> trzymamy zgodny z `prices`, żeby push i porównania działały 1:1 z istniejącym kodem.

### 6.2 Konfiguracja — **`gap_engine_config`** (warstwowa, „most specific wins")

```sql
CREATE TABLE gap_engine_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ZAKRES (każdy NULL = „dowolny"; bardziej szczegółowy wiersz wygrywa):
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,  -- NULL = globalny
  unit_id       UUID REFERENCES units(id) ON DELETE CASCADE,       -- NULL = wszystkie
  unit_type     TEXT,                                              -- NULL = wszystkie
  season        TEXT,                                              -- 'high'|'low'|... NULL = każdy
  channel       TEXT,                                              -- NULL = każdy
  date_from     DATE,  date_to DATE,                               -- NULL = bez ograniczenia
  -- PARAMETRY:
  standard_min_los          INTEGER NOT NULL DEFAULT 2,
  min_acceptable_gap        INTEGER NOT NULL DEFAULT 3,
  emergency_acceptable_gap  INTEGER NOT NULL DEFAULT 2,
  max_los                   INTEGER,                  -- NULL = bez limitu
  last_minute_lead_days     INTEGER NOT NULL DEFAULT 7,
  emergency_mode            BOOLEAN NOT NULL DEFAULT false,
  allow_shorten_min_los     BOOLEAN NOT NULL DEFAULT true,
  horizon_days              INTEGER NOT NULL DEFAULT 365,
  priority                  INTEGER NOT NULL DEFAULT 0,  -- tie-break
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
`resolveConfig(date, unit, channel)` scala globalny default → property → unit_type →
sezon → zakres dat → unit (najbardziej szczegółowy nadpisuje pola).

### 6.3 Trwałe override'y operatora — **`gap_overrides`**

Osobna tabela, by override **przeżył przeliczenie** (rdzeń je nakłada na końcu):
```sql
CREATE TABLE gap_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  date_from DATE NOT NULL, date_to DATE NOT NULL,
  cta SMALLINT CHECK (cta IN (0,1)), ctd SMALLINT CHECK (ctd IN (0,1)),
  min_los INTEGER, reason TEXT,
  operator_email TEXT, expires_at TIMESTAMPTZ,   -- np. auto-wygaśnięcie last-minute
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Integracje

### 7.1 Zapis wyniku do warstwy restrykcji
- Nowa edge function **`compute-gap-restrictions`** (Deno) importuje rdzeń z shared TS:
  1. czyta `availability` + `prices` (lokalne, per property/unit),
  2. `buildGaps()` z `availability` (ciągi `available`, ograniczane `booked`/`blocked`/dziś/horyzont),
  3. `resolveConfig()` z `gap_engine_config`; standardowy Min LOS → z configu **lub** z `prices.min` (decyzja §9),
  4. czyta `gap_overrides`,
  5. `computeGapRestrictions(gap, cfg, overrides)` → upsert do `gap_restrictions`
     `onConflict: 'unit_id,rate_id,date'` (ten sam wzorzec co `sync-*`).
- Wyzwalanie: po `sync-single-property` / `sync-all-availability` (po pullu tła), oraz
  ręcznie z kalendarza („Przelicz ochronę luk").

### 7.2 Push do Hotres (reużycie istniejącego pipeline)
- Źródłem pushu zamiast „surowego" `prices` staje się `gap_restrictions` (CTA/CTD/MIN/MAX).
- Reużywamy **bez zmian logiki**:
  - kompresję zakresów `isNextDay` + grupowanie (`CalendarView.tsx:914/1055/1670`),
  - budowę payloadu `{type_id, rate_id, mode:'delta', prices:[{from,till,cta,ctd,min}]}`,
  - `update-hotres-prices` (`oid` z `properties.hotres_id`),
  - **wybór cenników**: `selectedPushRatePlanIds` + modal `openPushModal`/`confirmPushModal`
    (`CalendarView.tsx:731/744`) — respektujemy wybór z poprzednich zmian (localStorage per property).
- Min LOS jako `min`, Max LOS jako `max` (opcjonalnie — `prices.max` istnieje; do włączenia
  w payloadzie, dziś nieużywane).

### 7.3 Wizualizacja w kalendarzu operatora
Frontend importuje **ten sam rdzeń** do podglądu na żywo (bez round-tripu) i pokazuje
zapisany `gap_restrictions`:
- **Chronione luki** — podświetlenie ciągu nocy luki (ramka), z `gap_id`.
- **CTA/CTD** — istniejące checkboxy (`:2969-2988`) zasilane z `gap_restrictions`; kolor wg `source`/`confidence`.
- **Dynamiczny Min LOS** — input MIN (`:2993`) pokazuje `min_los` (i `max_los` w tooltipie).
- **Powody** — `reason` w tooltipie komórki (zamiast obecnego tekstu AI w `:2962`).
- **Override** — przycisk/menu zapisujące do `gap_overrides`; oznaczenie `source=manual`
  innym kolorem; `confidence<1` (np. tryb awaryjny / niesprzedawalna luka) jako ostrzeżenie.

---

## 8. Co usunąć / wygasić z flow `ai_suggestions` (opis — bez kasowania w tej fazie)

Deterministyczny silnik jest **jedynym** źródłem CTA/CTD/Min LOS. Do wygaszenia:

| Element | Lokalizacja | Akcja docelowa |
|---|---|---|
| Typ `AISuggestion` | `types.ts:161-180` | Usunąć po migracji UI na `gap_restrictions`. |
| Stan + pobieranie sugestii | `CalendarView.tsx:98, 167, 2011-2040` | Usunąć `aiSuggestions`, `fetchAISuggestions`, wywołanie w `useEffect`. |
| Akceptacja/odrzucenie/feedback | `CalendarView.tsx:2043-2195` | Usunąć `handleApplySuggestion`, `handleRejectSuggestion`, `handleAcceptAll`, `handleFeedback`. |
| `hasAISuggestion` + żółty render | `CalendarView.tsx:2198-2201, 2873-2965` | Zastąpić renderem z `gap_restrictions` (CTA/CTD/Min/reason/source). |
| Przycisk „Akceptuj wszystkie (AI)" | `CalendarView.tsx:2550-2558` | Usunąć / zastąpić „Przelicz ochronę luk". |
| Tabele `ai_suggestions`, `ai_suggestion_feedback` | DB | Zaprzestać zapisów; archiwizacja, potem `DROP` (osobna, świadoma migracja — nie teraz). |
| n8n + Gemini | `n8n-ai-cta-workflow.json`, `docs/AI_CTA_CTD_AUTOMATION.md`, `docs/N8N_IMPORT_INSTRUCTIONS.md` | Wyłączyć workflow w n8n; oznaczyć docs jako *DEPRECATED*. |

> W tej fazie **nic nie kasujemy** — tylko inwentarz powyżej. Nie integrujemy silnika z
> tym flow ani nie budujemy wokół niego.

---

## 9. Plan wdrożenia (etapami)

1. **Rdzeń (shared TS).** Przenieść/utwardzić `gapEngine.ts` jako `engine/gapEngine.ts`
   (pure, bez I/O). Testy jednostkowe = 10 obowiązkowych przypadków (już w prototypie).
2. **Migracje DB.** `gap_restrictions`, `gap_engine_config`, `gap_overrides` (+ RLS analogiczne do `prices`).
3. **`buildGaps` + `resolveConfig`** (pure helpery I/O-adjacent) + testy.
4. **Edge function `compute-gap-restrictions`** importująca rdzeń; upsert wyniku; wyzwalana po `sync-*` i ręcznie.
5. **Frontend — podgląd i zapis override.** Render `gap_restrictions` w kalendarzu; przycisk „Przelicz"; zapis do `gap_overrides`.
6. **Push.** Przepiąć źródło pushu na `gap_restrictions` (reużycie kompresji + `update-hotres-prices` + wybór cenników).
7. **Wygaszenie AI** (§8) — po potwierdzeniu parytetu funkcjonalnego.

Każdy etap jest niezależnie wdrażalny; rdzeń (1) i schemat (2) nie ruszają działającego kodu.

---

## 10. Plan testów

- **Jednostkowe (rdzeń, bez I/O):** 10 obowiązkowych przypadków + 3b (niesprzedawalna)
  → `docs/prototypes/gapEngine.ts`, dziś **30 asercji, 0 błędów**. Docelowo w runnerze CI
  (np. `vitest`) na `engine/gapEngine.ts`.
- **`buildGaps`:** luka na początku horyzontu (dziś), na końcu (horyzont), luka 0-nocna,
  luka między `booked` a `blocked`, luki przedzielone pojedynczym `booked`.
- **`resolveConfig`:** kolejność szczegółowości (global→property→unit_type→sezon→zakres→unit),
  remisy po `priority`, brak configu → default.
- **Integracyjne (edge):** mock `availability`+`prices`+config → sprawdź upsert
  `gap_restrictions` i poprawny `onConflict`.
- **Push (kontrakt):** kompresja zakresów daje minimalną liczbę `{from,till}` (porównać z
  istniejącym `isNextDay`), payload do `update-hotres-prices` zgodny z dzisiejszym; respekt
  `selectedPushRatePlanIds`.
- **Override:** zapis `gap_overrides` → po `compute` wynik per data ma `source=manual`,
  `confidence=1`, przeżywa przeliczenie.
- **E2E manualny:** sezon wysoki/niski na tej samej luce → różny wynik w kalendarzu i w pushu.

---

## 11. Pytania / decyzje do zatwierdzenia (PRZED implementacją)

1. **Standardowy Min LOS — z `prices.min` czy z osobnego configu?**
   Rekomendacja: **config `gap_engine_config.standard_min_los`** jako źródło prawdy,
   z `prices.min` jako fallback gdy brak configu dla daty. (Czysty rozdział: `prices` =
   lustro Hotresa, config = polityka.) — akceptujesz?
2. **Domyślne wartości:** `min_acceptable_gap`, `emergency_acceptable_gap`,
   `last_minute_lead_days`, `max_los`, `horizon_days`. Proponowane: `3 / 2 / 7 / brak / 365`.
   Czy te wartości są OK globalnie?
3. **Tryb awaryjny per obiekt** — sterowany flagą `emergency_mode` w configu per property/unit,
   czy także automatycznie przez `last_minute_lead_days` (lead time)? Rekomendacja: **oba**
   (auto last-minute + ręczny przełącznik operatora).
4. **Polityka override:** override per zakres dat z `expires_at` (auto-wygaśnięcie last-minute)
   czy bezterminowo do ręcznego zdjęcia? Czy override może też *zaostrzać* (nie tylko luzować)?
5. **Horyzont dat:** liczyć luki do `today + horizon_days` (rekom. 365) czy trzymać obecny
   zaszyty zakres 20.01–31.12.2026 z pushu? Rekomendacja: **`horizon_days`** (koniec z hardkodami).
6. **`max_los` do Hotresa:** czy pushować `prices.max` (dziś nieużywane), czy na razie tylko
   CTA/CTD/MIN jak obecnie?
7. **Kardynalność wyniku:** `gap_restrictions` per `rate_id` (zgodnie z `prices`) — czy OK,
   skoro CTA/CTD/MIN w Hotresie są współdzielone per `type_id`? (Trzymam zgodność klucza dla
   prostoty pushu; alternatywa: jeden wiersz per `unit_id,date` i rozmnożenie przy pushu.)
8. **Branch:** zadanie wskazuje `claude/focused-gates-1HKyf` (użyty), a konfiguracja sesji —
   `claude/dreamy-euler-tt2rx8`. Potwierdzasz `claude/focused-gates-1HKyf` jako docelowy?

---

## 12. Tryby pracy Asystenta Luk (Off / Suggest / Autofill)

Per-obiektowy przełącznik 3-pozycyjny (`gap_engine_config.mode`, rozwiązywany jak
reszta configu — najbardziej szczegółowy wiersz wygrywa; UI ustawia wiersz property-scoped).

| Tryb | Liczenie (`gap_restrictions`) | Push do Hotres |
|---|---|---|
| **off** | nie liczy (edge `computeAndStore` zwraca `skipped`) | — |
| **suggest** | liczy i pokazuje sugestie | **ręczny** — „🛡 Zastosuj sugestie (prefill)" wstawia wynik do istniejącego stagingu (`priceChanges`), potem zwykłe „Wyślij na Hotres" (jak edycja ręczna; nie nadpisuje ręcznych zmian) |
| **autofill** | liczy | **automatyczny** — cron `gap-autofill` co 10 min |

### Autofill — przepływ (serwerowy)
`pg_cron` (`schedule_gap_autofill.sql`, `*/10 * * * *`) → edge `gap-autofill`:
1. dla każdego obiektu z `mode='autofill'`: `computeAndStoreGapRestrictions` (recompute),
2. sprawdza **wspólny limit 10/h** (tabela `hotres_push_log`, liczy pushe z ostatniej godziny — manual + autofill razem),
3. cel cenników z `properties.push_rate_plan_ids` (utrwalone z UI — bo cron nie widzi `localStorage`),
4. buduje payload z `gap_restrictions` (kompresja zakresów `isNextDay`) i wysyła **tą samą drogą co user** → edge `update-hotres-prices`,
5. zapisuje wpis do `hotres_push_log` (`source='autofill'`).

### Współdzielony limit 10/h
Konieczny, bo dotychczasowy licznik żył w `localStorage` (niewidoczny dla crona). Nowa
tabela `hotres_push_log` jest źródłem prawdy po stronie serwera: autofill nie przekroczy
10/h licząc również pushe ręczne. (UI nadal pokazuje licznik z `localStorage` dla natychmiastowego
feedbacku — drobna rozbieżność wyświetlania; twarde egzekwowanie jest po stronie crona/DB.)

### Reużyte moduły współdzielone (Deno)
- `supabase/functions/_shared/gapCompute.ts` — `computeAndStoreGapRestrictions` (jedna implementacja dla edge on-demand i crona).
- `supabase/functions/_shared/gapPush.ts` — budowa payloadu + wysyłka przez `update-hotres-prices`.

### Kroki wdrożeniowe (środowisko Supabase — poza tą sesją)
1. Migracje: `create_gap_*`, `add_gap_push_target_to_properties`, `create_hotres_push_log` (+ `mode` jest już w `create_gap_engine_config`).
2. Deploy edge: `compute-gap-restrictions`, `gap-autofill`.
3. `schedule_gap_autofill.sql` (wymaga `app.settings.service_role_key` jak istniejący `setup_pg_cron.sql`).
