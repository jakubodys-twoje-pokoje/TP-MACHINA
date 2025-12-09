import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, VAPID_PUBLIC_KEY } from './services/supabaseClient';
import { Auth } from './components/Auth';
import { Layout } from './components/Layout';
import { PropertyView } from './components/PropertyView';
import { UnitsView } from './components/UnitsView';
import { CalendarView } from './components/CalendarView';
import { Dashboard } from './components/Dashboard';
import { Loader2 } from 'lucide-react';
import { PropertyProvider } from './contexts/PropertyContext';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper to convert VAPID key
  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');
  
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
  
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const subscribeToPush = async (userId: string) => {
    if (!('serviceWorker' in navigator)) return;
    if (VAPID_PUBLIC_KEY === 'YOUR_VAPID_PUBLIC_KEY_HERE') {
        console.warn("VAPID Key not set in supabaseClient.ts");
        return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      // Save subscription to DB
      const { error } = await supabase.from('push_subscriptions').insert({
        user_id: userId,
        subscription: subscription
      });

      if (error) console.error("Error saving subscription:", error);
      else console.log("Push subscription saved!");

    } catch (error) {
      console.error("Push subscription failed:", error);
    }
  };

  useEffect(() => {
    let mounted = true;

    const initSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error("Błąd sesji Supabase:", error);
        }
        if (mounted) {
          setSession(data.session);
          if (data.session?.user) {
             // Try to subscribe on load if permission is granted
             if (Notification.permission === 'granted') {
                 subscribeToPush(data.session.user.id);
             }
          }
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setSession(session);
        setLoading(false);
        if (session?.user && Notification.permission === 'granted') {
            subscribeToPush(session.user.id);
        }
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
      <PropertyProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} /> 
            
            <Route path="/property/:id/details" element={<PropertyView />} />
            <Route path="/property/:id/units" element={<UnitsView />} />
            <Route path="/property/:id/calendar" element={<CalendarView />} />
            
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </PropertyProvider>
    </HashRouter>
  );
};

export default App;