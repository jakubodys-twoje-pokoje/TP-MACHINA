import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { supabase, VAPID_PUBLIC_KEY } from '../services/supabaseClient';
import { LogOut, BellRing, Clock, Menu, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useProperties } from '../contexts/PropertyContext';

interface LayoutProps {
  children: React.ReactNode;
}

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

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const location = useLocation();
  const { syncLogs } = useProperties();

  // Get last sync timestamp
  const lastSync = syncLogs[0];
  const getLastSyncText = () => {
    if (!lastSync) return 'Brak synchronizacji';

    const date = new Date(lastSync.timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Przed chwilą';
    if (diffMins < 60) return `${diffMins} min temu`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h temu`;

    return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleEnablePush = async () => {
      if (!('serviceWorker' in navigator) || !window.PushManager) {
        if (!window.isSecureContext) {
             alert("Powiadomienia Push wymagają HTTPS lub localhost.");
        } else {
             alert("Twoja przeglądarka nie obsługuje powiadomień Push.");
        }
        return;
      }
      
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });

            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              // Use upsert to prevent duplicates (unique constraint on user_id + endpoint)
              const { error } = await supabase.from('push_subscriptions').upsert({
                user_id: user.id,
                subscription: subscription
              }, {
                onConflict: 'user_id,endpoint',
                ignoreDuplicates: false
              });
              if (error) throw error;
              alert("Powiadomienia zostały włączone!");
            }
        } else {
            alert("Brak zgody na powiadomienia.");
        }
      } catch (e: any) {
        console.error(e);
        alert("Błąd: " + e.message);
      }
  };

  // Logic to determine layout width based on current path
  const isWorkflow = location.pathname === '/workflow';
  const isCalendar = location.pathname.includes('/calendar');
  // Use w-full for workflow and calendar to utilize ultrawide monitors, keep constrained width for other views
  const containerClass = (isWorkflow || isCalendar) ? "w-full px-6" : "max-w-6xl mx-auto px-4";

  return (
    <div className="flex h-screen w-full bg-background text-slate-100 overflow-hidden font-sans">
      {/* Mobile Header with Hamburger */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-surface border-b border-border px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          className="p-2 hover:bg-slate-700 rounded-md transition-colors"
        >
          {isMobileSidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <div className="flex items-center gap-2 text-indigo-400">
          <div className="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <Menu size={14} />
          </div>
          <span className="font-bold text-sm">Machina</span>
        </div>
        <button
          onClick={handleLogout}
          className="p-2 hover:bg-slate-700 rounded-md transition-colors text-slate-400 hover:text-white"
          title="Wyloguj"
        >
          <LogOut size={18} />
        </button>
      </div>

      {/* Overlay for mobile sidebar */}
      {isMobileSidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar - desktop always visible, mobile slides in */}
      <div className={`
        ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        fixed lg:static z-50 lg:z-auto
        w-64 h-full
        flex-shrink-0 border-r border-border bg-surface
        flex flex-col justify-between
        transition-transform duration-300 ease-in-out
      `}>
        <div className="flex-1 overflow-y-auto">
            <Sidebar onNavigate={() => setIsMobileSidebarOpen(false)} />
        </div>
        <div className="p-3 sm:p-4 border-t border-border bg-slate-900/50 space-y-2">
          {/* Last sync timestamp */}
          <div className="px-2 sm:px-3 py-1.5 sm:py-2 text-[9px] sm:text-[10px] text-slate-500 flex items-center gap-1.5 sm:gap-2">
            <Clock size={10} className="sm:w-3 sm:h-3 flex-shrink-0" />
            <span className="truncate">Ostatnia synch: {getLastSyncText()}</span>
          </div>
          <button
            onClick={handleEnablePush}
            className="w-full flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs text-indigo-400 hover:bg-indigo-500/10 rounded transition-colors"
          >
            <BellRing size={12} className="sm:w-3.5 sm:h-3.5" /> Włącz powiadomienia
          </button>
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <div className="text-[10px] sm:text-xs text-slate-400 truncate max-w-[120px] sm:max-w-[150px]" title={userEmail || ''}>
              {userEmail}
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 sm:p-2 hover:bg-slate-700 rounded-md transition-colors text-slate-400 hover:text-white"
              title="Wyloguj"
            >
              <LogOut size={14} className="sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full overflow-hidden relative lg:ml-0">
        <main className="flex-1 overflow-y-auto py-4 sm:py-6 lg:py-8 mt-14 lg:mt-4 custom-scrollbar">
            <div className={containerClass}>
                {children}
            </div>
        </main>
      </div>
    </div>
  );
};
