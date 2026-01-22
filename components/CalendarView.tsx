import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Property, Availability, Unit, Notification } from '../types';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

export const CalendarView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allUnitsAvailability, setAllUnitsAvailability] = useState<Map<string, Map<string, Availability['status']>>>(new Map());
  const [unreadNotifications, setUnreadNotifications] = useState<Notification[]>([]);
  const [viewMode, setViewMode] = useState<'full' | 'notifications'>('full');

  const [loadingUnits, setLoadingUnits] = useState(true);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (propertyId) {
      fetchPropertyAndUnits();
      fetchUnreadNotifications();
    }
  }, [propertyId]);

  useEffect(() => {
    if (units.length > 0) {
      fetchQuarterAvailability();
    }
  }, [selectedDate, units]);

  // Auto-scroll to position selected date at 1/3 of viewport
  useEffect(() => {
    if (scrollContainerRef.current && !loadingAvailability) {
      // Each day cell is ~90px wide (min-w-[90px])
      const dayWidth = 90;
      // Selected date is 30 days from start (1 month before)
      const daysBeforeSelected = 30;
      // Scroll so selected date appears at 1/3 of container width
      const containerWidth = scrollContainerRef.current.clientWidth;
      const scrollPosition = (daysBeforeSelected * dayWidth) - (containerWidth / 3);

      scrollContainerRef.current.scrollLeft = Math.max(0, scrollPosition);
      if (topScrollRef.current) {
        topScrollRef.current.scrollLeft = Math.max(0, scrollPosition);
      }
    }
  }, [allUnitsAvailability, loadingAvailability]);

  // Synchronize scroll between top and bottom scrollbars
  const handleMainScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (topScrollRef.current) {
      topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const handleTopScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const fetchPropertyAndUnits = async () => {
    if (!propertyId) return;
    setLoadingUnits(true);
    const { data: propData } = await supabase.from('properties').select('*').eq('id', propertyId).single();
    setProperty(propData);

    const { data: unitsData } = await supabase.from('units').select('*').eq('property_id', propertyId).order('name');
    if (unitsData) {
      setUnits(unitsData);
    }
    setLoadingUnits(false);
  };

  const fetchQuarterAvailability = async () => {
    if (units.length === 0) return;

    setLoadingAvailability(true);

    // Calculate date range: 1 month before, 2 months after (~90 days total)
    const startDate = new Date(selectedDate);
    startDate.setDate(startDate.getDate() - 30);

    const endDate = new Date(selectedDate);
    endDate.setDate(endDate.getDate() + 60);

    const unitIds = units.map(u => u.id);
    const { data } = await supabase
      .from('availability')
      .select('unit_id, date, status')
      .in('unit_id', unitIds)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);

    const availabilityMap = new Map<string, Map<string, Availability['status']>>();

    units.forEach(unit => {
      availabilityMap.set(unit.id, new Map());
    });

    data?.forEach((record: any) => {
      const unitMap = availabilityMap.get(record.unit_id);
      if (unitMap) {
        unitMap.set(record.date, record.status);
      }
    });

    setAllUnitsAvailability(availabilityMap);
    setLoadingAvailability(false);
  };

  const fetchUnreadNotifications = async () => {
    if (!propertyId) return;

    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('property_id', propertyId)
      .eq('is_read', false)
      .order('created_at', { ascending: false });

    if (data) {
      setUnreadNotifications(data);
    }
  };

  const handlePrevMonth = () => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() - 1);
    setSelectedDate(newDate);
  };

  const handleNextMonth = () => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() + 1);
    setSelectedDate(newDate);
  };

  const handleDateChange = (dateStr: string) => {
    setSelectedDate(new Date(dateStr));
  };

  // Generate ~90 days (quarter): 30 days before, selected date, 60 days after
  const generateQuarterDates = () => {
    const dates: Date[] = [];
    const startDate = new Date(selectedDate);
    startDate.setDate(startDate.getDate() - 30);

    for (let i = 0; i < 91; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }

    return dates;
  };

  const dates = generateQuarterDates();

  // Filter units based on view mode
  const getFilteredUnits = (): Unit[] => {
    if (viewMode === 'full') return units;

    // Filter to only units with unread notifications
    const unitsWithNotifications = new Set(
      unreadNotifications.map(n => n.unit_id)
    );
    return units.filter(u => unitsWithNotifications.has(u.id));
  };

  const filteredUnits = getFilteredUnits();

  // Get notification summary for tags
  const getNotificationSummary = () => {
    const summary: Array<{ unitName: string; dateRange: string }> = [];
    const unitNotifications = new Map<string, Notification[]>();

    // Group notifications by unit
    unreadNotifications.forEach(notif => {
      if (!unitNotifications.has(notif.unit_id)) {
        unitNotifications.set(notif.unit_id, []);
      }
      unitNotifications.get(notif.unit_id)!.push(notif);
    });

    // Create summary entries
    unitNotifications.forEach((notifs, unitId) => {
      const unit = units.find(u => u.id === unitId);
      if (!unit) return;

      notifs.forEach(notif => {
        const startDate = new Date(notif.start_date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
        const endDate = new Date(notif.end_date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
        summary.push({
          unitName: unit.name,
          dateRange: `${startDate} - ${endDate}`
        });
      });
    });

    return summary;
  };

  const getStatusColor = (status?: Availability['status']) => {
    if (!status || status === 'available') return 'bg-green-600/50 hover:bg-green-600/70';
    return 'bg-red-600/50 hover:bg-red-600/70';
  };

  // Helper to check if a date has an unread notification
  const hasUnreadNotification = (unitId: string, dateStr: string): boolean => {
    return unreadNotifications.some(notification => {
      if (notification.unit_id !== unitId) return false;

      const notifStart = new Date(notification.start_date);
      const notifEnd = new Date(notification.end_date);
      const checkDate = new Date(dateStr);

      return checkDate >= notifStart && checkDate <= notifEnd;
    });
  };

  // Helper to check if a day is the start or end of a reservation
  const getReservationBoundary = (
    unitId: string,
    dateIndex: number
  ): 'start' | 'end' | null => {
    const unitAvailability = allUnitsAvailability.get(unitId);
    if (!unitAvailability) return null;

    const currentDateStr = dates[dateIndex].toISOString().split('T')[0];
    const currentStatus = unitAvailability.get(currentDateStr);

    if (!currentStatus || currentStatus === 'available') return null;

    const prevDateStr = dateIndex > 0
      ? dates[dateIndex - 1].toISOString().split('T')[0]
      : null;
    const prevStatus = prevDateStr ? unitAvailability.get(prevDateStr) : 'available';

    const nextDateStr = dateIndex < dates.length - 1
      ? dates[dateIndex + 1].toISOString().split('T')[0]
      : null;
    const nextStatus = nextDateStr ? unitAvailability.get(nextDateStr) : 'available';

    if ((!prevStatus || prevStatus === 'available') && currentStatus === 'booked') {
      return 'start';
    }

    if (currentStatus === 'booked' && (!nextStatus || nextStatus === 'available')) {
      return 'end';
    }

    return null;
  };

  if (loadingUnits) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-indigo-400" size={32} />
      </div>
    );
  }

  if (units.length === 0) {
    return (
      <div className="text-center py-20 text-slate-400">
        <p>Brak kwater w tym obiekcie.</p>
      </div>
    );
  }

  const selectedDateStr = selectedDate.toISOString().split('T')[0];
  const startDateStr = dates[0].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  const endDateStr = dates[dates.length - 1].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-4 w-full max-w-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">{property?.name}</h2>
          <p className="text-slate-400 text-sm mt-1">Widok kwartalny dostępności</p>
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-3 shadow-lg relative w-full">
        {loadingAvailability && (
          <div className="absolute inset-0 bg-surface/50 backdrop-blur-sm flex items-center justify-center z-10 rounded-xl">
            <Loader2 className="animate-spin text-indigo-400" size={32} />
          </div>
        )}

        {/* Navigation and Date Picker */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={handlePrevMonth}
            className="p-2 rounded-md hover:bg-slate-700 transition-colors"
            title="Poprzedni miesiąc"
          >
            <ChevronLeft />
          </button>

          <div className="flex items-center gap-4">
            {/* View Mode Toggle */}
            <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
              <button
                onClick={() => setViewMode('full')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  viewMode === 'full'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Pełny
              </button>
              <button
                onClick={() => setViewMode('notifications')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  viewMode === 'notifications'
                    ? 'bg-yellow-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Powiadomienia
              </button>
            </div>

            <input
              type="date"
              value={selectedDateStr}
              onChange={(e) => handleDateChange(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="text-slate-400 text-sm">
              {startDateStr} - {endDateStr}
            </span>
          </div>

          <button
            onClick={handleNextMonth}
            className="p-2 rounded-md hover:bg-slate-700 transition-colors"
            title="Następny miesiąc"
          >
            <ChevronRight />
          </button>
        </div>

        {/* Notification Tags */}
        {viewMode === 'notifications' && unreadNotifications.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {getNotificationSummary().map((item, idx) => (
              <div
                key={idx}
                className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-900/30 border border-yellow-700/50 rounded-full text-xs"
              >
                <span className="font-semibold text-yellow-400">{item.unitName}</span>
                <span className="text-yellow-300">{item.dateRange}</span>
              </div>
            ))}
          </div>
        )}

        {/* Empty state for notifications view */}
        {viewMode === 'notifications' && unreadNotifications.length === 0 && (
          <div className="mb-3 p-4 bg-slate-800/50 rounded-lg text-center">
            <p className="text-slate-400 text-sm">Brak nieodczytanych powiadomień</p>
          </div>
        )}

        {/* Show table only if there are units to display */}
        {filteredUnits.length > 0 && (
          <>
            {/* Top Scrollbar */}
            <div
              className="overflow-x-auto overflow-y-hidden mb-2"
              ref={topScrollRef}
              onScroll={handleTopScroll}
            >
              <div style={{ width: `${120 + (dates.length * 90)}px`, height: '1px' }}></div>
            </div>

            {/* Scrollable Table */}
            <div className="overflow-x-auto max-h-[calc(100vh-300px)] overflow-y-auto" ref={scrollContainerRef} onScroll={handleMainScroll}>
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-30 border-b-2 border-border">
              <tr className="bg-surface">
                <th className="sticky left-0 z-40 bg-surface p-2 text-left text-[10px] font-bold text-slate-400 border-r border-border min-w-[120px]">
                  Pokój
                </th>
                {dates.map((date, idx) => {
                  const isToday = date.toDateString() === new Date().toDateString();
                  const isSelected = date.toISOString().split('T')[0] === selectedDateStr;
                  return (
                    <th
                      key={idx}
                      className={`p-2 text-center text-xs font-medium border-r border-border min-w-[90px] ${
                        isSelected ? 'bg-indigo-900/50' : isToday ? 'bg-indigo-900/30' : 'bg-surface'
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
              {filteredUnits.map((unit) => {
                const unitAvailability = allUnitsAvailability.get(unit.id);
                return (
                  <tr key={unit.id} className="border-t border-border hover:bg-slate-800/30">
                    <td className="sticky left-0 z-20 bg-surface p-2 text-[11px] font-medium text-white border-r border-border">
                      {unit.name}
                    </td>
                    {dates.map((date, idx) => {
                      const dateStr = date.toISOString().split('T')[0];
                      const status = unitAvailability?.get(dateStr);
                      const isToday = date.toDateString() === new Date().toDateString();
                      const isSelected = dateStr === selectedDateStr;
                      const boundary = getReservationBoundary(unit.id, idx);
                      const hasUnread = hasUnreadNotification(unit.id, dateStr);

                      let cellStyle: React.CSSProperties = {};
                      let cellClass = `h-5 rounded-sm transition-colors cursor-pointer ${getStatusColor(status)}`;

                      if (boundary === 'start') {
                        cellStyle = {
                          background: 'linear-gradient(135deg, rgb(22 163 74 / 0.5) 50%, rgb(220 38 38 / 0.5) 50%)'
                        };
                        cellClass = 'h-5 rounded-sm transition-opacity cursor-pointer hover:opacity-80';
                      } else if (boundary === 'end') {
                        cellStyle = {
                          background: 'linear-gradient(135deg, rgb(220 38 38 / 0.5) 50%, rgb(22 163 74 / 0.5) 50%)'
                        };
                        cellClass = 'h-5 rounded-sm transition-opacity cursor-pointer hover:opacity-80';
                      }

                      return (
                        <td
                          key={idx}
                          className={`p-1 border-r border-border ${
                            isSelected ? 'bg-indigo-900/30' : isToday ? 'bg-indigo-900/20' : ''
                          } ${hasUnread ? 'ring-2 ring-yellow-500 ring-inset' : ''}`}
                        >
                          <div className="flex flex-col gap-1">
                            {/* Colored cell */}
                            <div
                              className={cellClass}
                              style={cellStyle}
                              title={`${unit.name} - ${dateStr}: ${status || 'available'}${boundary ? ` (${boundary === 'start' ? 'początek' : 'koniec'} rezerwacji)` : ''}`}
                            />

                            {/* Checkboxes in one line - vertical labels */}
                            <div className="flex items-center justify-center gap-2">
                              <label className="flex flex-col items-center gap-0.5 cursor-pointer">
                                <input type="checkbox" className="w-5 h-5 cursor-pointer" />
                                <span className="text-slate-400 text-[8px] font-semibold">CTA</span>
                              </label>
                              <label className="flex flex-col items-center gap-0.5 cursor-pointer">
                                <input type="checkbox" className="w-5 h-5 cursor-pointer" />
                                <span className="text-slate-400 text-[8px] font-semibold">CTD</span>
                              </label>
                            </div>

                            {/* MIN input - centered with label below */}
                            <div className="flex flex-col gap-0.5 items-center">
                              <input
                                type="text"
                                className="w-full px-1.5 py-1 text-center text-[11px] bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                placeholder="000"
                              />
                              <label className="text-[8px] text-slate-500 uppercase">MIN</label>
                            </div>
                          </div>
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
            <div className="flex items-center justify-center gap-4 mt-2 text-xs flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-green-600/50"></div>
                <span className="text-slate-400">Dostępny</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-red-600/50"></div>
                <span className="text-slate-400">Zajęty</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg, rgb(22 163 74 / 0.5) 50%, rgb(220 38 38 / 0.5) 50%)' }}></div>
                <span className="text-slate-400">Początek rezerwacji</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ background: 'linear-gradient(135deg, rgb(220 38 38 / 0.5) 50%, rgb(22 163 74 / 0.5) 50%)' }}></div>
                <span className="text-slate-400">Koniec rezerwacji</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
