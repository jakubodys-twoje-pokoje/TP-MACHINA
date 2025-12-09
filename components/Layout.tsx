import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { supabase } from '../services/supabaseClient';
import { LogOut } from 'lucide-react';

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

  return (
    <div className="flex h-screen w-full bg-background text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border bg-surface">
        <Sidebar />
        
        {/* User Footer */}
        <div className="p-4 border-t border-border bg-slate-900/50">
          <div className="flex items-center justify-between">
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
        <main className="flex-1 overflow-y-auto pt-8 px-6 sm:px-8">
            <div className="max-w-6xl mx-auto">
                {children}
            </div>
        </main>
      </div>
    </div>
  );
};