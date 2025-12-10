import { createClient } from '@supabase/supabase-js';

// Provided credentials
const SUPABASE_URL = 'https://uopdrhgkephrtpdxicts.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvcGRyaGdrZXBocnRwZHhpY3RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyNTU2OTksImV4cCI6MjA4MDgzMTY5OX0.8lCfP_RxkrQwhq6zUxqdHeJGxMVSr10pcz3f9IQ19O8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Wstawiony klucz publiczny
export const VAPID_PUBLIC_KEY = 'BN2aUXcVI8Dtbf0-7cLLa10fztOAVVMX-gXrl6ddWfGTqferHXXXXau1WblUAE3_g9QfqUbRLdqbqsr42ARFwHs';