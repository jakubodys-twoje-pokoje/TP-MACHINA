import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './services/supabaseClient';
import { Auth } from './components/Auth';
import { Layout } from './components/Layout';
import { PropertyView } from './components/PropertyView';
import { UnitsView } from './components/UnitsView';
import { CalendarView } from './components/CalendarView';
import { Loader2 } from 'lucide-react';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-slate-900 flex items-center justify-center text-indigo-500">
        <Loader2 className="animate-spin" size={48} />
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={
            <div className="text-center mt-20">
              <h2 className="text-3xl font-bold text-white mb-4">Witaj w Panelu Rezerwacji</h2>
              <p className="text-slate-400">Wybierz obiekt z menu po lewej stronie, aby rozpocząć edycję.</p>
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