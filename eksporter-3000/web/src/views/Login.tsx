import React, { useState } from 'react';
import { KeyRound, Loader2, User } from 'lucide-react';
import { login } from '../api';

export const Login: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(user, password);
      onDone();
    } catch (err: any) {
      setError(err.message ?? 'Nie udało się zalogować');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl mx-auto flex items-center justify-center mb-4">
            <KeyRound className="text-white" size={24} />
          </div>
          <h1 className="text-2xl font-bold text-white">Eksporter 3000</h1>
          <p className="text-slate-400 mt-2 text-sm">
            Dane obiektów z Hotres do przepisania do nowego PMS-a
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 text-red-400 text-sm rounded-lg p-3 mb-6">{error}</div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Login</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="text"
                required
                autoFocus
                value={user}
                onChange={event => setUser(event.target.value)}
                className="w-full bg-slate-900 border border-border text-white rounded-lg py-2.5 pl-10 pr-4 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Hasło</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input
                type="password"
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
                className="w-full bg-slate-900 border border-border text-white rounded-lg py-2.5 pl-10 pr-4 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 mt-6"
          >
            {busy && <Loader2 className="animate-spin" size={18} />}
            Zaloguj się
          </button>
        </form>

        <p className="text-[11px] text-slate-600 text-center mt-6">
          Jedno konto, ustawione w pliku <span className="font-mono">.env</span> serwisu
          (EKSPORTER_USER / EKSPORTER_PASSWORD).
        </p>
      </div>
    </div>
  );
};
