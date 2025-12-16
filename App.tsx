import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, VAPID_PUBLIC_KEY } from './services/supabaseClient';
import { Auth } from './components/Auth';
import { Layout } from './components/Layout';
import { PropertyView } from './components/PropertyView';
import { UnitsView } from './components/UnitsView';
import { CalendarView } from './components/CalendarView';
import { PricingView } from './components/PricingView';
import { Dashboard } from './components/Dashboard';
import { WorkflowView } from './components/WorkflowView';
import { Loader2 } from 'lucide-react';
import { PropertyProvider } from './contexts/PropertyContext';

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const subscribeToPush = async (userId: string) => {
    if (!('serviceWorker' in navigator) || !window.PushManager) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
      const { error } = await supabase.from('push_subscriptions').insert({
        user_id: userId,
        subscription: subscription
      });
      if (error) console.error("Subscription save error:", error);
    } catch (error) {
      console.error("Push subscription failed:", error);
    }
  };

  useEffect(() => {
    let mounted = true;
    const initSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) console.error("Supabase session error:", error);
        if (mounted) {
          setSession(data.session);
          if (data.session?.user && Notification.permission === 'granted') {
             subscribeToPush(data.session.user.id);
          }
        }
      } catch (err: any) {
        console.error("Auth error:", err);
        if (mounted) setError("Inicjalizacja nie powiodła się.");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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

  if (loading) return <div className="h-screen w-screen bg-slate-900 flex items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={48} /></div>;
  if (error) return <div className="h-screen w-screen bg-slate-900 flex flex-col items-center justify-center text-red-400 gap-4"><p>{error}</p><button onClick={() => window.location.reload()} className="bg-indigo-600 px-4 py-2 rounded text-white">Odśwież</button></div>;
  if (!session) return <Auth />;

  return (
    <HashRouter>
      <PropertyProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} /> 
            <Route path="/workflow" element={<WorkflowView />} />
            <Route path="/property/:id/details" element={<PropertyView />} />
            <Route path="/property/:id/units" element={<UnitsView />} />
            <Route path="/property/:id/pricing" element={<PricingView />} />
            <Route path="/property/:id/calendar" element={<CalendarView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </PropertyProvider>
    </HashRouter>
  );
};

export default App;