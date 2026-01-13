import React, { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Property, Availability, Unit } from '../types';
import { Loader2, ChevronLeft, ChevronRight, Calendar, Table } from 'lucide-react';

type ViewMode = 'calendar' | 'table';

// Calendar Generation Logic
const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

// Table View Component
interface TableViewProps {
  units: Unit[];
  startDate: Date;
  allUnitsAvailability: Map<string, Map<string, Availability['status']>>;
  loadingAvailability: boolean;
  onDateChange: (date: Date) => void;
  onPrevWeeks: () => void;
  onNextWeeks: () => void;
}

const TableView: React.FC<TableViewProps> = ({
  units,
  startDate,
  allUnitsAvailability,
  loadingAvailability,
  onDateChange,
  onPrevWeeks,
  onNextWeeks
}) => {
  // Generate 14 days (2 weeks) starting from startDate
  const dates: Date[] = [];
  for (let i = 0; i < 14; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    dates.push(date);
  }

  const getStatusColor = (status?: Availability['status']) => {
    if (!status || status === 'available') return 'bg-green-600/50 hover:bg-green-600/70';
    return 'bg-red-600/50 hover:bg-red-600/70';
  };

  return (
    <div className="bg-surface rounded-xl border border-border p-6 shadow-lg relative">
      {loadingAvailability && (
        <div className="absolute inset-0 bg-surface/50 backdrop-blur-sm flex items-center justify-center z-10">
          <Loader2 className="animate-spin text-indigo-400" size={32} />
        </div>
      )}

      {/* Navigation and Date Picker */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onPrevWeeks}
          className="p-2 rounded-md hover:bg-slate-700 transition-colors"
        >
          <ChevronLeft />
        </button>

        <div className="flex items-center gap-4">
          <input
            type="date"
            value={startDate.toISOString().split('T')[0]}
            onChange={(e) => onDateChange(new Date(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-slate-400 text-sm">
            {dates[0].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} - {dates[13].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>

        <button
          onClick={onNextWeeks}
          className="p-2 rounded-md hover:bg-slate-700 transition-colors"
        >
          <ChevronRight />
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface p-3 text-left text-xs font-bold text-slate-400 border-r border-border min-w-[150px]">
                Pokój
              </th>
              {dates.map((date, idx) => {
                const isToday = date.toDateString() === new Date().toDateString();
                return (
                  <th
                    key={idx}
                    className={`p-2 text-center text-xs font-medium border-r border-border min-w-[60px] ${
                      isToday ? 'bg-indigo-900/30' : ''
                    }`}
                  >
                    <div className="text-slate-300 font-bold">
                      {date.getDate()}
                    </div>
                    <div className="text-slate-500 text-[10px]">
                      {date.toLocaleDateString('pl-PL', { weekday: 'short' })}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => {
              const unitAvailability = allUnitsAvailability.get(unit.id);
              return (
                <tr key={unit.id} className="border-t border-border hover:bg-slate-800/30">
                  <td className="sticky left-0 z-10 bg-surface p-3 font-medium text-white border-r border-border">
                    {unit.name}
                  </td>
                  {dates.map((date, idx) => {
                    const dateStr = date.toISOString().split('T')[0];
                    const status = unitAvailability?.get(dateStr);
                    const isToday = date.toDateString() === new Date().toDateString();

                    return (
                      <td
                        key={idx}
                        className={`p-1 border-r border-border ${isToday ? 'bg-indigo-900/20' : ''}`}
                      >
                        <div
                          className={`h-10 rounded-sm transition-colors cursor-pointer ${getStatusColor(status)}`}
                          title={`${unit.name} - ${dateStr}: ${status || 'available'}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-green-600/50"></div>
          <span className="text-slate-400">Dostępny</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-red-600/50"></div>
          <span className="text-slate-400">Zajęty</span>
        </div>
      </div>
    </div>
  );
};

export const CalendarView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [availabilityData, setAvailabilityData] = useState<Map<string, Availability['status']>>(new Map());
  const [allUnitsAvailability, setAllUnitsAvailability] = useState<Map<string, Map<string, Availability['status']>>>(new Map());

  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [tableStartDate, setTableStartDate] = useState(new Date());

  const [loadingUnits, setLoadingUnits] = useState(true);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  useEffect(() => {
    if (propertyId) {
      fetchPropertyAndUnits();
    }
  }, [propertyId]);

  useEffect(() => {
    if (selectedUnitId && viewMode === 'calendar') {
      fetchAvailabilityForMonth();
    }
  }, [selectedUnitId, currentDate]);

  useEffect(() => {
    if (viewMode === 'table' && units.length > 0) {
      const endDate = new Date(tableStartDate);
      endDate.setDate(endDate.getDate() + 13); // 2 weeks = 14 days
      fetchAllUnitsAvailability(tableStartDate, endDate);
    }
  }, [viewMode, tableStartDate, units]);
  
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

  const fetchAllUnitsAvailability = async (startDate: Date, endDate: Date) => {
    if (units.length === 0) return;
    setLoadingAvailability(true);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    const unitIds = units.map(u => u.id);
    const { data } = await supabase
      .from('availability')
      .select('unit_id, date, status')
      .in('unit_id', unitIds)
      .gte('date', startDateStr)
      .lte('date', endDateStr);

    const newAllUnitsMap = new Map<string, Map<string, Availability['status']>>();
    units.forEach(unit => {
      newAllUnitsMap.set(unit.id, new Map());
    });

    (data || []).forEach(item => {
      const unitMap = newAllUnitsMap.get(item.unit_id);
      if (unitMap) {
        unitMap.set(item.date, item.status as Availability['status']);
      }
    });

    setAllUnitsAvailability(newAllUnitsMap);
    setLoadingAvailability(false);
  };

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
            ${isUnavailable ? 'bg-red-600/50 hover:bg-red-600/60' : 'bg-green-600/50 hover:bg-green-600/60'}
            ${isToday ? 'border-2 border-indigo-500' : 'border border-transparent'}
            cursor-pointer
          `}
        >
          <span className={`font-bold text-lg ${isUnavailable ? 'text-red-200' : 'text-green-200'}`}>{day}</span>
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
        <div className="flex items-center gap-4">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-2 rounded-md transition-colors flex items-center gap-2 ${
                viewMode === 'calendar' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Calendar size={16} />
              <span className="text-sm font-medium">Kalendarz</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-2 rounded-md transition-colors flex items-center gap-2 ${
                viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Table size={16} />
              <span className="text-sm font-medium">Tabela</span>
            </button>
          </div>
          {/* Unit selector (tylko dla widoku kalendarzowego) */}
          {units.length > 0 && viewMode === 'calendar' && (
            <select
               value={selectedUnitId}
               onChange={e => setSelectedUnitId(e.target.value)}
               className="bg-surface border border-border rounded-lg px-3 py-2 text-white outline-none focus:ring-2 focus:ring-indigo-500 min-w-[200px]"
            >
              {units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </select>
          )}
        </div>
      </div>

       {loadingUnits ? (
        <div className="text-center py-8 text-slate-500"><Loader2 className="animate-spin inline-block mr-2" /> Ładowanie...</div>
      ) : units.length === 0 ? (
        <p className="text-sm text-slate-500 italic text-center py-8">Brak kwater w tym obiekcie. Dodaj je w zakładce 'Kwatery', aby zarządzać dostępnością.</p>
      ) : viewMode === 'calendar' ? (
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
      ) : (
        <TableView
          units={units}
          startDate={tableStartDate}
          allUnitsAvailability={allUnitsAvailability}
          loadingAvailability={loadingAvailability}
          onDateChange={setTableStartDate}
          onPrevWeeks={() => {
            const newDate = new Date(tableStartDate);
            newDate.setDate(newDate.getDate() - 14);
            setTableStartDate(newDate);
          }}
          onNextWeeks={() => {
            const newDate = new Date(tableStartDate);
            newDate.setDate(newDate.getDate() + 14);
            setTableStartDate(newDate);
          }}
        />
      )}
    </div>
  );
};