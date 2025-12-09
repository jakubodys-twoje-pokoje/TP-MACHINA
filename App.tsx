import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './services/supabaseClient';
import { Auth } from './components/Auth';
import { Layout } from './components/Layout';
import { PropertyView } from './components/PropertyView';
import { UnitsView } from './components/UnitsView';
import { CalendarView } from './components/CalendarView';
import { Loader2, Building } from 'lucide-react';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const initSession = async () => {
      try {
        // Bezpieczne pobranie sesji
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
            console.error("Błąd sesji Supabase:", error);
            // Nie rzucamy błędu krytycznego, po prostu zakładamy brak sesji
        }
        
        if (mounted) {
          setSession(data.session);
        }
      } catch (err: any) {
        console.error("Nieoczekiwany błąd autoryzacji:", err);
        if (mounted) setError("Wystąpił problem z inicjalizacją aplikacji.");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initSession();

    // Nasłuchiwanie zmian w autoryzacji
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setSession(session);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex flex-col items-center justify-center text-indigo-500 gap-4">
        <Loader2 className="animate-spin" size={48} />
        <p className="text-slate-400 text-sm font-medium">Ładowanie aplikacji...</p>
      </div>
    );
  }

  if (error) {
      return (
          <div className="h-screen w-screen bg-slate-900 flex flex-col items-center justify-center text-red-400 gap-4">
              <p className="text-lg font-bold">Błąd aplikacji</p>
              <p>{error}</p>
              <button 
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
              >
                  Odśwież
              </button>
          </div>
      )
  }

  if (!session) {
    return <Auth />;
  }

  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={
            <div className="text-center mt-20 p-4">
              <div className="w-20 h-20 bg-indigo-600/20 rounded-full flex items-center justify-center mx-auto mb-6">
                 <Building className="text-indigo-500" size={40} /> 
              </div>
              <h2 className="text-3xl font-bold text-white mb-4">Witaj w Panelu Rezerwacji</h2>
              <p className="text-slate-400 max-w-md mx-auto">
                Wybierz obiekt z menu po lewej stronie, aby rozpocząć edycję, lub dodaj nowy obiekt przyciskiem "+".
              </p>
            </div>
          } />
          
          <Route path="/property/:id/details" element={<PropertyView />} />
          <Route path="/property/:id/units" element={<UnitsView />} />
          <Route path="/property/:id/calendar" element={<CalendarView />} />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
};

export default App;