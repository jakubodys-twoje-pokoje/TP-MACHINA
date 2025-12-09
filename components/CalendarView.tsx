import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Property, Availability } from '../types';
import { AlertCircle, RefreshCw, Loader2, Power, Timer } from 'lucide-react';
import { useProperties } from '../contexts/PropertyContext';

export const CalendarView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [availabilityList, setAvailabilityList] = useState<Availability[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAutoSync, setIsAutoSync] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(3600);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  // FIX: In a browser environment, setInterval returns a number, not NodeJS.Timeout.
  const timerRef = useRef<number | null>(null);

  // @ts-ignore - The context will be updated in the next step
  const { syncAvailability } = useProperties();

  useEffect(() => {
    if (propertyId) {
      fetchProperty();
      fetchAvailability();
    }
  }, [propertyId]);

  const fetchProperty = async () => {
    if (!propertyId) return;
    const { data } = await supabase.from('properties').select('*').eq('id', propertyId).single();
    setProperty(data);
  };

  const fetchAvailability = async () => {
    if (!propertyId) return;
    setLoading(true);
    // Fetch all units for this property
    const { data: units } = await supabase.from('units').select('id').eq('property_id', propertyId);
    if (units && units.length > 0) {
      const unitIds = units.map(u => u.id);
      // Fetch availability for all units in this property
      const { data: availData } = await supabase
        .from('availability')
        .select('*')
        .in('unit_id', unitIds)
        .neq('status', 'available')
        .order('date', { ascending: false })
        .limit(100); // Limit for display purposes
      setAvailabilityList(availData || []);
    } else {
      setAvailabilityList([]);
    }
    setLoading(false);
  };
  
  const handleSync = async () => {
    if (!property || !property.description) {
      alert("Brak OID w opisie obiektu. Nie można zsynchronizować.");
      return;
    }
    const oidMatch = property.description.match(/OID: (\d+)/);
    if (!oidMatch || !oidMatch[1]) {
      alert("Nie znaleziono OID w opisie obiektu.");
      return;
    }
    
    setIsSyncing(true);
    try {
      // @ts-ignore
      await syncAvailability(oidMatch[1], property.id);
      await fetchAvailability();
      setLastSync(new Date());
      alert('Synchronizacja dostępności zakończona pomyślnie.');
    } catch (err: any) {
      alert(`Błąd synchronizacji: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Effect for managing the auto-sync interval
  useEffect(() => {
    if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
    }
    if (isAutoSync && intervalSeconds > 0 && propertyId) {
        timerRef.current = setInterval(handleSync, intervalSeconds * 1000);
    }
    return () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
        }
    };
  }, [isAutoSync, intervalSeconds, propertyId]);


  if (!property && !loading) return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
          <AlertCircle size={48} className="mb-4 text-slate-600" />
          <p className="text-lg font-medium">Nie znaleziono obiektu.</p>
      </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h2 className="text-2xl font-bold text-white">Zarządzanie Dostępnością</h2>
      </div>

      {/* SYNC PANEL */}
      <div className="bg-surface rounded-xl border border-border p-6 shadow-lg">
        <h3 className="text-lg font-bold text-white mb-2">Synchronizacja z Hotres</h3>
        <p className="text-sm text-slate-400 mb-6">Pobierz i zaktualizuj stany dostępności dla wszystkich kwater w tym obiekcie na rok 2026.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Manual Sync */}
          <div className="space-y-4">
             <button 
              onClick={handleSync}
              disabled={isSyncing || !property?.description?.includes('OID')}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-wait text-white px-4 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors text-base"
            >
              {isSyncing ? <Loader2 size={20} className="animate-spin" /> : <RefreshCw size={20} />}
              {isSyncing ? 'Synchronizuję dane...' : 'Synchronizuj teraz'}
            </button>
            <p className="text-xs text-slate-500 text-center">
              {lastSync ? `Ostatnia synchronizacja: ${lastSync.toLocaleTimeString()}` : 'Naciśnij, aby pobrać dane.'}
            </p>
          </div>
          
          {/* Auto Sync */}
          <div className="bg-slate-900/50 p-4 rounded-lg border border-border space-y-4">
              <div className="flex items-center justify-between">
                <label htmlFor="auto-sync-toggle" className="flex items-center gap-2 font-medium text-slate-300 cursor-pointer">
                  <Power size={16} className={isAutoSync ? 'text-green-500' : 'text-slate-600'} />
                  Automatyczna synchronizacja
                </label>
                 <button
                    id="auto-sync-toggle"
                    onClick={() => setIsAutoSync(!isAutoSync)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAutoSync ? 'bg-green-600' : 'bg-slate-700'}`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAutoSync ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="flex items-center gap-3">
                 <label className="flex items-center gap-2 text-sm text-slate-400 whitespace-nowrap"><Timer size={16}/> Interwał:</label>
                 <input 
                    type="number" 
                    value={intervalSeconds}
                    onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                    disabled={!isAutoSync}
                    className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-white text-sm outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                 />
                 <span className="text-sm text-slate-500">sek.</span>
              </div>
          </div>
        </div>
      </div>
      
      {/* LAST 100 UNAVAILABLE DATES */}
       <div className="bg-surface rounded-xl border border-border p-6 shadow-lg">
           <h3 className="text-lg font-bold text-white mb-4">Ostatnie 100 Zmian Dostępności</h3>
            {loading ? (
                <div className="text-center py-8 text-slate-500"><Loader2 className="animate-spin inline-block mr-2" /> Ładowanie...</div>
            ) : availabilityList.length === 0 ? (
                <p className="text-sm text-slate-500 italic text-center py-8">Brak zdefiniowanych blokad lub rezerwacji. Cały kalendarz jest oznaczony jako dostępny.</p>
            ) : (
                <div className="max-h-96 overflow-y-auto custom-scrollbar pr-2">
                    <ul className="space-y-2">
                    {availabilityList.map(a => (
                        <li key={a.id} className="flex justify-between items-center p-2 bg-slate-900/40 rounded-md">
                            <span className="font-mono text-sm text-slate-300">{a.date}</span>
                             <span className={`text-xs px-2 py-0.5 rounded-md uppercase font-bold tracking-wider ${a.status === 'booked' ? 'bg-red-500/10 text-red-400' : 'bg-orange-500/10 text-orange-400'}`}>
                                {a.status === 'blocked' ? 'Zablokowane' : a.status}
                             </span>
                        </li>
                    ))}
                    </ul>
                </div>
            )}
       </div>

    </div>
  );
};