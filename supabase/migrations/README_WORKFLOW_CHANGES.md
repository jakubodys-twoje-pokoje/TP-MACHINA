# Workflow Changes - SQL Migrations

## Co zostało zmienione?

### 1. **Platform-wide workflow** (tasks, statuses, persons)
- `workflow_tasks` i `workflow_statuses` są teraz **współdzielone** przez wszystkich użytkowników
- Kolumna `user_id` pozostaje jako pole audytu (nullable)
- RLS ustawione na `USING (true)` dla wszystkich authenticated users

### 2. **Historia zmian** (workflow_entry_history)
- Nowa tabela `workflow_entry_history` śledzi każdą zmianę w komórkach workflow
- Przechowuje: stare/nowe wartości, powód zmiany, kto zmienił, kiedy
- Platform-wide access (wszyscy authenticated users)

### 3. **Opiekun obiektu** (properties.workflow_assigned_to)
- Nowa kolumna `workflow_assigned_to` w tabeli `properties`
- Przechowuje imię osoby odpowiedzialnej za obiekt (dropdown w UI)

---

## Jak wykonać migracje?

### Opcja 1: Supabase Dashboard (SQL Editor)

1. Otwórz Supabase Dashboard → SQL Editor
2. Skopiuj całą zawartość pliku **`ALL_WORKFLOW_CHANGES.sql`**
3. Wklej do SQL Editora
4. Kliknij "Run" / "Execute"
5. Sprawdź czy wszystko przeszło bez błędów

### Opcja 2: Supabase CLI

```bash
supabase db push
```

Lub wykonaj konkretne migracje:

```bash
supabase db execute -f supabase/migrations/make_workflow_tasks_statuses_platform_wide.sql
supabase db execute -f supabase/migrations/add_workflow_entry_history.sql
supabase db execute -f supabase/migrations/add_workflow_assigned_to_properties.sql
```

---

## Weryfikacja po migracji

Po wykonaniu sprawdź:

✅ **workflow_tasks**: Polityki RLS powinny być platform-wide
✅ **workflow_statuses**: Polityki RLS powinny być platform-wide
✅ **workflow_entry_history**: Tabela powinna istnieć z indeksami
✅ **properties**: Kolumna `workflow_assigned_to` powinna istnieć

### Przykładowe zapytania sprawdzające:

```sql
-- Sprawdź polityki RLS dla workflow_tasks
SELECT * FROM pg_policies WHERE tablename = 'workflow_tasks';

-- Sprawdź polityki RLS dla workflow_statuses
SELECT * FROM pg_policies WHERE tablename = 'workflow_statuses';

-- Sprawdź czy tabela workflow_entry_history istnieje
SELECT * FROM workflow_entry_history LIMIT 1;

-- Sprawdź kolumnę workflow_assigned_to w properties
SELECT workflow_assigned_to FROM properties LIMIT 1;
```

---

## Rollback (jeśli potrzebny)

Jeśli coś pójdzie nie tak:

```sql
-- Przywróć per-user policies (przykład dla workflow_tasks)
DROP POLICY IF EXISTS "Authenticated users can manage workflow tasks" ON workflow_tasks;

CREATE POLICY "Users can manage their own workflow tasks"
  ON workflow_tasks
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Usuń tabelę workflow_entry_history
DROP TABLE IF EXISTS workflow_entry_history CASCADE;

-- Usuń kolumnę workflow_assigned_to
ALTER TABLE properties DROP COLUMN IF EXISTS workflow_assigned_to;
```

---

## Kontakt

W razie problemów sprawdź logi:
- Supabase Dashboard → Logs
- Lub uruchom `supabase db logs` w CLI
