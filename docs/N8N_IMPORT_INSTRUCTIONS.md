# Jak zaimportować workflow AI do n8n

## Krok 1: Import workflow

1. Otwórz n8n
2. Kliknij **"+"** (New Workflow)
3. Kliknij menu **"..."** → **"Import from File"**
4. Wybierz plik: `/home/user/TP-MACHINA/n8n-ai-cta-workflow.json`
5. Workflow się załaduje z wszystkimi 12 node'ami

## Krok 2: Skonfiguruj Supabase Credentials

Musisz dodać credentials Supabase **TYLKO RAZ**, potem wszystkie node'y będą ich używać:

1. Kliknij na **dowolny node Supabase** (np. "Fetch Notifications")
2. W sekcji **Credentials** kliknij **"Create New Credential"**
3. Wypełnij:
   - **Host:** `https://uopdrhgkephrtpdxicts.supabase.co`
   - **Service Role Secret:** Twój Supabase Service Role Key
     - Znajdziesz w: Supabase Dashboard → Project Settings → API → `service_role` key
4. Kliknij **Save**
5. **WAŻNE:** Teraz przejedź przez WSZYSTKIE pozostałe node'y Supabase i wybierz te same credentials:
   - Fetch Notifications
   - Fetch Reservations
   - Fetch Availability
   - Fetch Prices
   - Fetch Units
   - Insert to Supabase

## Krok 3: Dodaj Gemini API Key

1. W n8n, idź do **Settings** → **Environment Variables**
2. Dodaj nową zmienną:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** Twój klucz API z Google AI Studio
     - Pobierz tutaj: https://aistudio.google.com/app/apikey
3. Save

## Krok 4: Test Workflow

1. Kliknij **"Execute Workflow"** (play button)
2. Webhook będzie aktywny - wyślij test request:

```bash
curl -X POST https://n8n.twojepokoje.com.pl/webhook/181df836-8c89-47d2-b611-07cd556473f8 \
  -H "Content-Type: application/json" \
  -d '{
    "notification_ids": ["jakiś-prawdziwy-uuid-z-bazy"]
  }'
```

3. Sprawdź czy workflow przechodzi przez wszystkie node'y
4. Sprawdź czy w tabeli `ai_suggestions` pojawiły się rekordy

## Krok 5: Aktywuj workflow (produkcyjny webhook)

1. Kliknij **"Active"** (toggle w prawym górnym rogu)
2. Webhook będzie działał non-stop
3. URL webhooka produkcyjnego: `https://n8n.twojepokoje.com.pl/webhook/181df836-8c89-47d2-b611-07cd556473f8`

W `components/CalendarView.tsx` linia ~825:
```typescript
const response = await fetch('https://n8n.twojepokoje.com.pl/webhook/181df836-8c89-47d2-b611-07cd556473f8', {
```

---

## Troubleshooting

### Problem: Node Supabase nie działa
**Rozwiązanie:** Sprawdź czy wszystkie node'y Supabase mają przypisane credentials. Kliknij na każdy i wybierz "Supabase account".

### Problem: Gemini zwraca błąd 400
**Rozwiązanie:** Sprawdź czy `GEMINI_API_KEY` jest ustawiony w Environment Variables.

### Problem: Insert to Supabase zwraca błąd
**Rozwiązanie:** Sprawdź czy tabela `ai_suggestions` istnieje w Supabase. Uruchom SQL z `/docs/AI_CTA_CTD_AUTOMATION.md` sekcja 1.

### Problem: Workflow timeout
**Rozwiązanie:** Gemini czasem jest wolny. W node "Call Gemini API" → Options → Timeout: ustaw 30000ms (30 sekund).

---

## Co dalej?

Po zaimportowaniu i aktywacji workflow:

1. **Test z prawdziwymi danymi:**
   - Kliknij przycisk "🤖 Zatrudnij AI" w kalendarzu
   - Sprawdź konsolę przeglądarki (F12)
   - Sprawdź tabelę `ai_suggestions` w Supabase

2. **Dodaj frontend do wyświetlania sugestii:**
   - Modal z sugestiami AI
   - Przycisk "Zastosuj" do aplikowania CTA/CTD
   - Kod w `/docs/AI_CTA_CTD_AUTOMATION.md` sekcja 3

3. **Monitoruj koszty:**
   - Gemini Flash: $0.003 per 35 powiadomień
   - Sprawdzaj usage w Google AI Studio

4. **Opcjonalnie: Auto-apply dla wysokiej pewności (>95%)**
   - Dodaj conditional node po "Parse Gemini Response"
   - Auto-aplikuj sugestie z confidence > 95
