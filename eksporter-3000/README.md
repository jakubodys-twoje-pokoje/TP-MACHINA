# Eksporter 3000

Samodzielne narzędzie migracyjne. Ściąga **statyczne dane obiektów z Hotres**
do lokalnej bazy SQLite i pokazuje je w GUI tak, żeby dało się je ręcznie
przepisać do nowego PMS-a.

**To nie jest część Machiny.** Nie ma tu Supabase, nie ma automatyzacji, nie ma
żadnego zapisu z powrotem do Hotresa. Cały tool to jeden katalog — po skończonej
migracji wystarczy go skasować.

```
eksporter-3000/
  server/   Node + Express + Prisma (SQLite) - API i serwowanie GUI
  web/      React + Vite - interfejs
```

Jeden proces, jeden port: serwer serwuje zbudowane GUI z `web/dist`.

---

## Uruchomienie lokalnie

```bash
cd eksporter-3000/server
cp .env.example .env        # wpisz login, hasło i dane do Hotresa
npm install
npm run db:push             # tworzy prisma/eksporter3000.db

cd ../web
npm install
npm run build

cd ../server
npm run dev                 # http://localhost:4000
```

## Konfiguracja (`server/.env`)

| Zmienna | Do czego |
|---|---|
| `EKSPORTER_USER` / `EKSPORTER_PASSWORD` | logowanie do panelu — jedno konto, wpisane ręcznie |
| `HOTRES_API_USER` / `HOTRES_API_PASSWORD` | konto agencyjne w Hotresie |
| `DATABASE_URL` | plik SQLite, domyślnie `file:./eksporter3000.db` |
| `PORT` | port GUI i API, domyślnie 4000 |
| `MAX_UPLOAD_MB` | limit wielkości wgrywanego pliku, domyślnie 200 |
| `UPLOADS_DIR` | katalog na pliki importu, domyślnie `server/data/uploads` |

Bez kompletu `EKSPORTER_USER` i `EKSPORTER_PASSWORD` serwis **nie wstanie** —
lepiej to niż panel bez hasła.

---

## Co jest w GUI

Lewa kolumna to osobny widok na każdy rodzaj danych. Wszędzie obowiązuje ta sama
zasada: **polska etykieta + oryginalna nazwa pola z Hotresa + wartość + kopiowanie
jednym kliknięciem**, a puste pola są pokazane wprost jako „puste", nigdy ukryte.

| Widok | Źródło | Co zawiera |
|---|---|---|
| Obiekty | baza | lista wszystkich pobranych klientów: etykieta, OID, liczniki, data i status ostatniego pobrania, **kumulatywny postęp przepisywania** (odhaczanie sekcji + procent), notatki, wyszukiwarka, filtry oraz **wsadowe pobieranie wielu OID-ów naraz** |
| Pobieranie | — | pojedynczy eksport z pełną kontrolą zakresu, postęp na żywo, historia przebiegów |
| Obiekt | `api_object` | kontakt, adres, dane do faktur, doba hotelowa, opisy, galeria |
| Standardy | `api_roomstypes` + `api_roomtype` | łóżka, metraż, wyposażenie (po nazwach), opisy per język, galeria, przypisane pokoje |
| Pokoje fizyczne | `api_rooms` | numery, stan, pola własne, powiązanie ze standardem |
| Cenniki | `api_rates` + `api_rate` | wyżywienie, długość pobytu, opisy, galerie |
| Dodatki | `api_addons` | ceny, VAT, stany, reguły sprzedaży, powiązania z cennikami i standardami |
| Vouchery | `api_vouchers` + `api_voucher` | wartość, ważność, opisy |
| Bilety | `api_tickets` + `api_ticket` | cena, termin, pula, limit |
| Opinie | `api_reviews` | oceny i treści z kanałów sprzedaży |
| Informator | `api_informator` | kafle informacyjne dla gości |
| Użytkownicy | `api_users` | konta z dostępem do obiektu |
| Parametry | `api_params` | surowa konfiguracja `be_*` |
| Słowniki (legendy) | `api_definitions` | wyposażenie, waluty, kraje - zamiana numerów na nazwy |
| Pliki importu | — | materiały człowieka przypięte do obiektu: arkusze, zdjęcia od właściciela, notatki, gotowe paczki |

### Dwie rzeczy, które oszczędzają najwięcej klikania

**Czysty tekst.** Opisy w Hotresie są pisane w edytorze WYSIWYG i bywają
naszpikowane stylami, twardymi spacjami i pustymi akapitami. Każde pole HTML ma
przełącznik *Złożone / Czysty tekst / HTML* i przycisk **Kopiuj czysty tekst** -
listy stają się punktami, style znikają. „Kopiuj wszystkie pola" też kopiuje
tekst, nie znaczniki.

**Zdjęcia jako ZIP.** Hotres daje tylko adresy URL, więc serwis pobiera pliki po
swojej stronie i pakuje je w foldery (`obiekt/`, `standardy/<id>-<nazwa>/`,
`cenniki/<id>-<nazwa>/`, `vouchery/`, `bilety/`). Można wziąć całość albo
pojedynczą galerię. Zdjęcia, których nie udało się pobrać, nie wywracają
archiwum - lądują w pliku `BLEDY.txt` w środku.

**Pliki importu.** Ostatnia sekcja przy każdym obiekcie to miejsce na własne
pliki - przeciągasz je z pulpitu, dopisujesz notatkę „po co to jest", pobierasz
pod oryginalną nazwą. Nie mają nic wspólnego z Hotresem i nigdzie nie są
wysyłane: leżą na dysku serwera w `server/data/uploads/<oid>/`, a w bazie są
tylko metadane. Nazwa od użytkownika nigdy nie trafia do ścieżki na dysku -
plik dostaje losowy identyfikator, oryginalna nazwa wraca dopiero przy pobieraniu.

## Czego NIE pobieramy — świadomie

`api_availability`, `api_prices`, `api_blocks`, `api_reservations`, `api_guests`,
`api_payments`, `api_invoices`, `api_messages`.

To dane dynamiczne i transakcyjne — pójdą osobnym eksportem. Hotres limituje
zapytania na godzinę, więc to narzędzie ich nie dotyka.

Nie zapisujemy też pól `auth` i `apikey` z `api_object` — to poświadczenia
dostępowe, nie dane obiektu.

---

## Zasady, które warto znać

**Pełna normalizacja.** Żadnych blobów JSON — każde pole ma swoją kolumnę,
tłumaczenia siedzą w tabelach `*Translation`, a listy w rodzaju
`facilities: "22,7,73"` czy `rates_ids` są rozbite na relacje.

**Postęp przepisywania jest nasz, nie Hotresa.** Każdy obiekt ma status
(do zrobienia / w trakcie / przepisane / pomijamy), notatkę oraz **odhaczane
sekcje** (obiekt, standardy, pokoje, cenniki, dodatki, vouchery, bilety,
informator). Procent liczy się kumulatywnie z tych sekcji, a **sekcja bez danych
zalicza się automatycznie** - nie ma czego przepisywać. To wyliczenie dzieje się
przy odczycie, więc gdy pusta dotąd sekcja dostanie dane, krok sam wraca do
niezrobionych.

To jedyne dane w bazie, których nie da się odtworzyć z Hotresa. Eksport ich nie
nadpisuje (pilnuje tego test), ale **kasowanie pliku bazy je traci** - przy 50
klientach to jest ta rzecz, którą warto backupować.

**Hotres nie zwraca nazwy obiektu.** Etykietę na liście składamy z tego, co jest:
identyfikator tekstowy → nazwa firmy → miejscowość → sam OID.

**Dane czyta się z bazy, nie z Hotresa.** Połączenie do API powstaje wyłącznie
przy pobieraniu; przeglądanie widoków działa nawet przy błędnych poświadczeniach
Hotresa i nie zużywa limitu zapytań.

**Wsadowo, ale po kolei.** Lista OID-ów leci sekwencyjnie, nie równolegle -
równoległość tylko szybciej wyczerpałaby godzinowy limit Hotresa.

**Pierwszy wybrany język jest główny.** Z niego biorą się wartości podstawowe
rekordu; pozostałe języki lądują w zakładkach przy opisach.

**Powtórny eksport aktualizuje, nie duplikuje.** Wszystko jest upsertowane po
`(propertyId, hotresId)`.

**Kasowanie sierot jest warunkowe.** Rzeczy usunięte w Hotresie znikają też
z bazy — ale tylko gdy lista pobrała się bez twardego błędu. Chwilowa awaria API
nie wyczyści dobrych danych.

**Relacje wiszą luźno.** Dodatek wskazujący nieistniejący cennik zachowuje jego
identyfikator z pustą relacją — w GUI widać to jako żółty znacznik.

**Prawdziwe API zwraca więcej niż dokumentacja.** Na realnym obiekcie wyszło
52 pola, których nie ma w przykładach Hotresa - m.in. progi wiekowe dzieci,
`def_persons`/`min_persons` przy standardach, zasady anulacji i rabaty cenników
oraz `title` dodatku. Wszystkie są już zmapowane.

**Nieznane pola są raportowane.** Przy pełnej normalizacji zmiana w API Hotres
mogłaby zniknąć po cichu, więc każde pole spoza schematu ląduje w tabeli
`UnmappedField` i po przebiegu widać je w GUI na żółto. Jeśli takie coś się
pojawi — trzeba dopisać pole do `server/prisma/schema.prisma`, mappera
w `server/src/importers.ts` i opisu w `web/src/fields.ts`.

---

## Wdrożenie (Ubuntu, root, pm2)

```bash
apt update && apt -y upgrade
apt install -y git curl ca-certificates openssl nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm i -g pm2

git clone -b eksporter-3000 <adres-repo> /opt/machina
cd /opt/machina/eksporter-3000/server
cp .env.example .env && nano .env      # login, hasło, dane Hotresa
npm ci                                  # BEZ --omit=dev (tsx jest w devDependencies)
npm run db:push

cd ../web && npm ci && npm run build

cd ../server
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup systemd -u root --hp /root
```

nginx jako wejście (potrzebny dla HTTPS i długich eksportów):

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;

        # Postęp eksportu leci strumieniem NDJSON - bez tego pasek stoi.
        proxy_buffering off;

        # Pełny eksport obiektu potrafi trwać kilka minut.
        proxy_read_timeout 900s;
        proxy_send_timeout 900s;
    }
}
```

### Aktualizacja

```bash
cd /opt/machina && git pull
cd eksporter-3000/server && npm ci && npm run db:push
cd ../web && npm ci && npm run build
pm2 restart eksporter-3000
```

### Kopia danych

Do backupu idą **dwie rzeczy**:

- `eksporter-3000/server/prisma/eksporter3000.db` - dane i postęp przepisywania,
- `eksporter-3000/server/data/uploads/` - wgrane pliki importu.

Tylko tego nie da się odtworzyć ponownym pobraniem z Hotresa.

---

## Struktura kodu

```
server/src/catalogue.ts   katalog endpointów (kolejność = kolejność importu, wymuszona relacjami)
server/src/hotres.ts      klient API: throttle, ponawianie, klasyfikacja błędów
server/src/coerce.ts      rzutowanie stringów Hotresa na typy ("0" → false, "" → null)
server/src/fetchAll.ts    faza pobierania do pamięci
server/src/importers.ts   faza zapisu: payload → modele Prismy
server/src/runExport.ts   orkiestracja przebiegu + ExportRun
server/src/auth.ts        logowanie na konto z .env
server/src/server.ts      Express: API, streaming NDJSON, serwowanie GUI

web/src/fields.ts         opisy pól - jedyne źródło prawdy o tym, co widać w GUI
web/src/ui.tsx            klocki: tabela pól, kopiowanie, galeria, HTML, zakładki językowe
web/src/views/            po jednym widoku na rodzaj danych
```

## Testy

```bash
cd server && npm test        # 42 testy: rzutowanie, klient Hotres, pełny przebieg na SQLite
cd web && npm test           # 13 testów: HTML → czysty tekst, parsowanie listy OID-ów, odmiana liczebników
```
