import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Property, Availability, Unit } from '../types';
import { RefreshCw, Loader2, Power, Timer, ChevronLeft, ChevronRight } from 'lucide-react';
import { useProperties } from '../contexts/PropertyContext';

// Calendar Generation Logic
const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

export const CalendarView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [availabilityData, setAvailabilityData] = useState<Map<string, Availability['status']>>(new Map());
  
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isAutoSync, setIsAutoSync] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(3600);
  const [lastSyncMessage, setLastSyncMessage] = useState<string>('Naciśnij, aby pobrać dane.');
  const timerRef = useRef<number | null>(null);
  
  const { syncAvailability } = useProperties();

  useEffect(() => {
    if (propertyId) {
      fetchPropertyAndUnits();
    }
  }, [propertyId]);

  useEffect(() => {
    if (selectedUnitId) {
      fetchAvailabilityForMonth();
    }
  }, [selectedUnitId, currentDate]);
  
  const fetchPropertyAndUnits = async () => {
    if (!propertyId) return;
    setLoadingUnits(true);
    const { data: propData } = await supabase.from('properties').select('*').eq('id', propertyId).single();
    setProperty(propData);

    const { data: unitsData } = await supabase.from('units').select('*').eq('property_id', propertyId).order('name');
    setUnits(unitsData || []);
    if (unitsData && unitsData.length > 0) {
      setSelectedUnitId(unitsData[0].id);
    }
    setLoadingUnits(false);
  };

  const fetchAvailabilityForMonth = async () => {
    if (!selectedUnitId) return;
    setLoadingAvailability(true);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${getDaysInMonth(year, month)}`;

    const { data } = await supabase
      .from('availability')
      .select('date, status')
      .eq('unit_id', selectedUnitId)
      .gte('date', startDate)
      .lte('date', endDate);
      
    const newAvailMap = new Map<string, Availability['status']>();
    (data || []).forEach(item => {
      newAvailMap.set(item.date, item.status as Availability['status']);
    });
    setAvailabilityData(newAvailMap);
    setLoadingAvailability(false);
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
    
    // Prevent multiple clicks if already syncing locally (fallback check)
    if (isSyncing) return;

    setIsSyncing(true);
    try {
      const resultMessage = await syncAvailability(oidMatch[1], property.id);
      await fetchAvailabilityForMonth();
      
      const syncTime = new Date().toLocaleTimeString();
      let alertMessage = '';
      if (resultMessage === "First sync complete") {
          alertMessage = "Pierwsza synchronizacja zakończona pomyślnie. Powiadomienia będą generowane od teraz.";
          setLastSyncMessage(`OK (${syncTime}). Pierwsza synchronizacja.`);
      } else {
          const changesCountMatch = resultMessage.match(/Znaleziono (\d+)/);
          const changesCount = changesCountMatch ? parseInt(changesCountMatch[1]) : 0;
          
          if (changesCount > 0) {
            alertMessage = `Synchronizacja zakończona. Wykryto ${changesCount} nowych zmian.`;
            setLastSyncMessage(`OK (${syncTime}). Wykryto ${changesCount} zmian.`);
          } else {
            alertMessage = `Synchronizacja zakończona. Brak nowych zmian.`;
            setLastSyncMessage(`OK (${syncTime}). Brak nowych zmian.`);
          }
      }
      // alert(alertMessage); // Optional: remove alert to be less intrusive on auto-sync

    } catch (err: any) {
      alert(`Błąd synchronizacji: ${err.message}`);
      setLastSyncMessage(`Błąd: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (isAutoSync && intervalSeconds > 0 && propertyId) {
      timerRef.current = window.setInterval(handleSync, intervalSeconds * 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) };
  }, [isAutoSync, intervalSeconds, propertyId]);

  const calendarGrid = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    
    const grid = [];
    for (let i = 0; i < (firstDay === 0 ? 6 : firstDay - 1); i++) {
      grid.push(<div key={`empty-${i}`} className="p-2"></div>);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const status = availabilityData.get(dateStr);
      
      const isUnavailable = status === 'booked' || status === 'blocked';
      const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();
      
      grid.push(
        <div 
          key={day} 
          className={`h-20 flex flex-col items-center justify-center rounded-lg transition-colors
            ${isUnavailable ? 'bg-red-900/40' : 'bg-slate-800/50'}
            ${isToday ? 'border-2 border-indigo-500' : 'border border-transparent'}
          `}
        >
          <span className={`font-bold text-lg ${isUnavailable ? 'text-red-400/50' : 'text-slate-200'}`}>{day}</span>
        </div>
      );
    }
    return grid;
  }, [currentDate, availabilityData]);
  
  const changeMonth = (delta: number) => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + delta);
      return newDate;
    });
  };

  const weekdays = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <h2 className="text-2xl font-bold text-white">Kalendarz Dostępności</h2>
        {units.length > 0 && (
          <select 
             value={selectedUnitId}
             onChange={e => setSelectedUnitId(e.target.value)}
             className="bg-surface border border-border rounded-lg px-3 py-2 text-white outline-none focus:ring-2 focus:ring-indigo-500 min-w-[200px]"
          >
            {units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        )}
      </div>

       {loadingUnits ? (
        <div className="text-center py-8 text-slate-500"><Loader2 className="animate-spin inline-block mr-2" /> Ładowanie...</div>
      ) : units.length === 0 ? (
        <p className="text-sm text-slate-500 italic text-center py-8">Brak kwater w tym obiekcie. Dodaj je w zakładce 'Kwatery', aby zarządzać dostępnością.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border p-6 shadow-lg relative">
          {loadingAvailability && <div className="absolute inset-0 bg-surface/50 backdrop-blur-sm flex items-center justify-center z-10"><Loader2 className="animate-spin text-indigo-400" size={32}/></div>}
          
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => changeMonth(-1)} className="p-2 rounded-md hover:bg-slate-700"><ChevronLeft /></button>
            <h3 className="text-xl font-bold text-white tracking-wide">
              {currentDate.toLocaleString('pl-PL', { month: 'long', year: 'numeric' })}
            </h3>
            <button onClick={() => changeMonth(1)} className="p-2 rounded-md hover:bg-slate-700"><ChevronRight /></button>
          </div>
          
          <div className="grid grid-cols-7 gap-2 text-center text-xs text-slate-400 font-bold mb-2">
            {weekdays.map(day => <div key={day}>{day}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {calendarGrid}
          </div>
        </div>
      )}

      {/* SYNC PANEL */}
      <div className="bg-surface rounded-xl border border-border p-6 shadow-lg">
        <h3 className="text-lg font-bold text-white mb-2">Synchronizacja z Hotres</h3>
        <p className="text-sm text-slate-400 mb-6">Pobierz i zaktualizuj stany dostępności dla wszystkich kwater w tym obiekcie na rok 2026.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
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
              {lastSyncMessage}
            </p>
          </div>
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
    </div>
  );
};