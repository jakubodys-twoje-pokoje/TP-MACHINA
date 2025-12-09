import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { supabase, VAPID_PUBLIC_KEY } from '../services/supabaseClient';
import { LogOut, BellRing } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleEnablePush = async () => {
      if (!('serviceWorker' in navigator)) return;
      
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
          // Re-trigger subscription logic (usually handled in App.tsx but simplified here for direct action)
          // For now, reloading the page is the simplest way to trigger the App.tsx logic again
          window.location.reload();
      } else {
          alert("Brak zgody na powiadomienia. Zmień ustawienia przeglądarki.");
      }
  };

  return (
    <div className="flex h-screen w-full bg-background text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border bg-surface flex flex-col justify-between">
        <div className="flex-1 overflow-y-auto">
            <Sidebar />
        </div>
        
        {/* User Footer */}
        <div className="p-4 border-t border-border bg-slate-900/50 space-y-2">
          <button 
            onClick={handleEnablePush}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-indigo-400 hover:bg-indigo-500/10 rounded transition-colors"
          >
            <BellRing size={14} /> Włącz powiadomienia
          </button>
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <div className="text-xs text-slate-400 truncate max-w-[150px]" title={userEmail || ''}>
              {userEmail}
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-slate-700 rounded-md transition-colors text-slate-400 hover:text-white"
              title="Wyloguj"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <main className="flex-1 overflow-y-auto py-12 px-6 sm:px-8">
            <div className="max-w-6xl mx-auto">
                {children}
            </div>
        </main>
      </div>
    </div>
  );
};