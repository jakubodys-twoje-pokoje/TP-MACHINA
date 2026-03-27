# Backend Synchronization Setup - Instrukcja Krok po Kroku

## Przegląd
Backend synchronizacja działa 24/7 i automatycznie synchronizuje wszystkie obiekty co 2 minuty (w godzinach 04:00-01:00 czasu polskiego). Logi są automatycznie czyszczone po 12 godzinach, więc maksymalnie będziesz mieć ~360 wpisów.

## Krok 1: Utwórz Tabelę sync_logs

1. Zaloguj się do Supabase Dashboard: https://supabase.com/dashboard
2. Wybierz swój projekt
3. Przejdź do **SQL Editor** (ikona z lewej strony)
4. Kliknij **New Query**
5. Skopiuj i wklej zawartość pliku `supabase/migrations/create_sync_logs.sql`
6. Kliknij **Run** (lub Ctrl+Enter)

Powinieneś zobaczyć komunikat: "Success. No rows returned"

## Krok 2: Utwórz Edge Function

1. W Supabase Dashboard przejdź do **Edge Functions** (ikona z lewej strony)
2. Kliknij **Create a new function**
3. Nazwa funkcji: `sync-all-availability`
4. Skopiuj całą zawartość pliku `supabase/functions/sync-all-availability/index.ts`
5. Wklej do edytora funkcji
6. Kliknij **Deploy**

Alternatywnie, możesz użyć Supabase CLI:
```bash
# Zainstaluj Supabase CLI (jeśli jeszcze nie masz)
npm install -g supabase

# Zaloguj się
supabase login

# Link do projektu
supabase link --project-ref uopdrhgkephrtpdxicts

# Deploy funkcji
supabase functions deploy sync-all-availability
```

## Krok 3: Sprawdź czy Edge Function działa

1. W Supabase Dashboard przejdź do **Edge Functions**
2. Wybierz `sync-all-availability`
3. Kliknij **Invoke** (test button)
4. Powinieneś zobaczyć odpowiedź JSON z listą successes/errors

## Krok 4: Skonfiguruj pg_cron

### 4.1 Włącz pg_cron extension

1. Przejdź do **SQL Editor**
2. Uruchom:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;
```

### 4.2 Ustaw Service Role Key w konfiguracji bazy danych

1. Przejdź do **Settings** -> **API**
2. Skopiuj **service_role** secret key (⚠️ nie udostępniaj tego klucza!)
3. Wróć do **SQL Editor**
4. Uruchom (zastąp `YOUR_SERVICE_ROLE_KEY` swoim kluczem):

```sql
ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
```

### 4.3 Zaplanuj automatyczne uruchamianie

1. W **SQL Editor** uruchom:

```sql
SELECT cron.schedule(
  'sync-all-availability-job',
  '*/2 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/sync-all-availability',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

## Krok 5: Weryfikacja

### Sprawdź czy job został utworzony:
```sql
SELECT * FROM cron.job;
```

Powinieneś zobaczyć job o nazwie `sync-all-availability-job` z harmonogramem `*/2 * * * *`

### Sprawdź historię uruchomień (po kilku minutach):
```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

### Sprawdź czy logi są zapisywane:
```sql
SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 5;
```

## Krok 6: Push zmian do Git

Wszystkie pliki zostały utworzone lokalnie. Teraz je zapisz:

```bash
git add .
git commit -m "feat: Add backend synchronization with pg_cron and Edge Functions"
git push -u origin claude/fix-push-subscription-error-BQOoA
```

## Jak to działa?

1. **pg_cron** uruchamia job co 2 minuty
2. Job wywołuje **Edge Function** `sync-all-availability`
3. Edge Function:
   - Sprawdza czy to godziny 04:00-01:00 (Polish time)
   - Jeśli nie, zwraca "skipped"
   - Jeśli tak, pobiera wszystkie properties z `hotres_id`
   - Synchronizuje wszystkie równolegle (Promise.allSettled)
   - Zapisuje wyniki do tabeli `sync_logs`
   - Usuwa logi starsze niż 12 godzin
4. **Frontend** automatycznie odbiera nowe logi przez realtime subscription

## Zarządzanie

### Zatrzymanie synchronizacji:
```sql
SELECT cron.unschedule('sync-all-availability-job');
```

### Wznowienie synchronizacji:
```sql
-- Ponownie uruchom SELECT cron.schedule(...) z Kroku 4.3
```

### Wyświetlenie wszystkich logów:
```sql
SELECT
  created_at,
  success_count,
  error_count,
  successes,
  errors
FROM sync_logs
ORDER BY created_at DESC;
```

### Ręczne czyszczenie logów:
```sql
DELETE FROM sync_logs WHERE created_at < NOW() - INTERVAL '12 hours';
```

### Ręczne uruchomienie synchronizacji (bez czekania 2 minuty):
W Supabase Dashboard -> Edge Functions -> sync-all-availability -> Invoke

## Troubleshooting

### Synchronizacja nie działa?
1. Sprawdź czy job jest aktywny: `SELECT * FROM cron.job;`
2. Sprawdź błędy: `SELECT * FROM cron.job_run_details WHERE status = 'failed' ORDER BY start_time DESC;`
3. Sprawdź logi Edge Function w Dashboard -> Edge Functions -> sync-all-availability -> Logs

### Brak logów w tabeli sync_logs?
1. Sprawdź czy Edge Function się wykona: Dashboard -> Edge Functions -> Invoke
2. Sprawdź czy RLS policies są poprawne: `SELECT * FROM pg_policies WHERE tablename = 'sync_logs';`

### Zbyt dużo logów?
Logi są automatycznie czyszczone po 12 godzinach, ale możesz zmienić to w Edge Function:
```typescript
// Zmień 12 na inną liczbę godzin
const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
```

## Koszty

- **pg_cron**: Wliczony w Supabase Pro ($25/miesiąc)
- **Edge Functions**: 500K wywołań/miesiąc gratis, potem $2/1M wywołań
  - Przy 2 minutach = 720 wywołań/dzień = ~21,600/miesiąc (dużo poniżej limitu)
- **Database storage**: ~1 MB dla 360 logów (praktycznie darmowe)
- **Realtime**: Wliczony w Pro plan

**Razem**: Żadnych dodatkowych kosztów poza twoim obecnym Pro planem! 🎉
