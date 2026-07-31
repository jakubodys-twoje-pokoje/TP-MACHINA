-- ============================================================================
-- NAPRAWA ODSZUMIANIA POWIADOMIEŃ
-- ============================================================================
-- fix_duplicate_notifications.sql założył unikalny indeks na
--   (property_id, unit_id, change_type, start_date, end_date)
-- bez żadnego elementu czasu. Skutek: raz wysłane powiadomienie o danym
-- zakresie dat dla danej kwatery blokuje ten zakres NA ZAWSZE. Ponowna
-- rezerwacja tych samych dni tej samej kwatery odbija się o 23505, a edge
-- function loguje błąd i leci dalej — zmiana zostaje wykryta, ale powiadomienie
-- nigdy nie powstaje. Im dłużej system działa, tym więcej typowych zakresów
-- jest "zużytych" i tym mniej powiadomień dociera.
--
-- Odszumianie zostaje, ale przenosimy je do kodu edge functions (pomijamy
-- insert, jeśli identyczne powiadomienie powstało w ciągu ostatniej godziny).
-- Okno czasowe załatwia to, przed czym miał chronić indeks — równoległe albo
-- powtórzone przebiegi — nie blokując przy tym rezerwacji tych samych dni za
-- tydzień czy za miesiąc.
--
-- Idempotentna, niczego nie usuwa poza samym indeksem.

DROP INDEX IF EXISTS notifications_unique_change;

-- Weryfikacja: powinno zwrócić 0 wierszy.
SELECT indexname
FROM pg_indexes
WHERE tablename = 'notifications'
  AND indexname = 'notifications_unique_change';
