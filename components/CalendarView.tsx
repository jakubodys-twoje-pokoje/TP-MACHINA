import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Property, Availability, Unit, Notification } from '../types';
import { Loader2, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

export const CalendarView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allUnitsAvailability, setAllUnitsAvailability] = useState<Map<string, Map<string, Availability['status']>>>(new Map());
  const [unreadNotifications, setUnreadNotifications] = useState<Notification[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'full' | 'notifications'>('notifications');

  const [loadingUnits, setLoadingUnits] = useState(true);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Hotres sync counter
  const getHotresSyncCount = (): { count: number; hourStart: number } => {
    const stored = localStorage.getItem('hotres_sync_count');
    if (!stored) return { count: 0, hourStart: Date.now() };

    const data = JSON.parse(stored);
    const currentHour = Math.floor(Date.now() / 3600000);
    const storedHour = Math.floor(data.hourStart / 3600000);

    // Reset if different hour
    if (currentHour !== storedHour) {
      return { count: 0, hourStart: Date.now() };
    }

    return data;
  };

  const [hotresSyncCount, setHotresSyncCount] = useState(getHotresSyncCount());

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
    const summary: Array<{
      unitName: string;
      dateRange: string;
      changeType: 'available' | 'blocked';
      notificationId: string;
    }> = [];
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
          dateRange: `${startDate} - ${endDate}`,
          changeType: notif.change_type,
          notificationId: notif.id
        });
      });
    });

    return summary;
  };

  const handleMarkNotificationAsRead = async (notificationId: string) => {
    const isCurrentlyRead = readNotificationIds.has(notificationId);
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email || null;

    if (isCurrentlyRead) {
      // Unmark as read - restore to unread state
      await supabase
        .from('notifications')
        .update({ is_read: false, read_by_email: null, read_at: null })
        .eq('id', notificationId);

      // Remove from read set
      setReadNotificationIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(notificationId);
        return newSet;
      });
    } else {
      // Mark as read
      const readAt = new Date().toISOString();
      await supabase
        .from('notifications')
        .update({ is_read: true, read_by_email: userEmail, read_at: readAt })
        .eq('id', notificationId);

      // Add to read set
      setReadNotificationIds(prev => new Set(prev).add(notificationId));
    }
  };

  const handleSyncToHotres = async () => {
    // Check limit
    const currentData = getHotresSyncCount();
    if (currentData.count >= 15) {
      alert('Osiągnięto limit 15 synchronizacji na godzinę. Spróbuj ponownie za chwilę.');
      return;
    }

    // Confirm
    if (!confirm('Czy na pewno chcesz wysłać zmiany na Hotres? Ta operacja jest nieodwracalna.')) {
      return;
    }

    // TODO: Implement actual Hotres sync logic here
    // For now, just remove read notifications

    // Update counter
    const newCount = currentData.count + 1;
    const newData = { count: newCount, hourStart: currentData.hourStart };
    localStorage.setItem('hotres_sync_count', JSON.stringify(newData));
    setHotresSyncCount(newData);

    // Remove read notifications from view
    setUnreadNotifications(prev =>
      prev.filter(n => !readNotificationIds.has(n.id))
    );
    setReadNotificationIds(new Set());

    alert(`Wysłano na Hotres. Pozostało ${15 - newCount} synchronizacji w tej godzinie.`);
  };

  const triggerAvailabilitySync = async () => {
    if (syncing) return;

    if (!confirm('Czy na pewno chcesz wymusić synchronizację dostępności? To zsynchronizuje wszystkie obiekty.')) {
      return;
    }

    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('Musisz być zalogowany aby wykonać synchronizację');
        return;
      }

      const response = await fetch(
        'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/sync-all-availability',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({})
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sync failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      console.log('Manual sync result:', result);

      alert(`Synchronizacja zakończona!\n✓ Sukces: ${result.success_count}\n✗ Błędy: ${result.error_count}`);

      // Refresh availability data after sync
      if (units.length > 0) {
        await fetchAvailability();
      }
    } catch (error: any) {
      console.error('Manual sync error:', error);
      alert(`Błąd synchronizacji: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const getStatusColor = (status?: Availability['status']) => {
    if (!status || status === 'available') return 'bg-green-600/50 hover:bg-green-600/70';
    return 'bg-red-600/50 hover:bg-red-600/70';
  };

  // Helper to check if a date has an unread notification (not read yet)
  const hasUnreadNotification = (unitId: string, dateStr: string): boolean => {
    return unreadNotifications.some(notification => {
      if (notification.unit_id !== unitId) return false;
      if (readNotificationIds.has(notification.id)) return false; // Skip read ones

      const notifStart = new Date(notification.start_date);
      const notifEnd = new Date(notification.end_date);
      const checkDate = new Date(dateStr);

      return checkDate >= notifStart && checkDate <= notifEnd;
    });
  };

  // Helper to get notification boundary position (for continuous yellow box)
  const getNotificationPosition = (unitId: string, dateStr: string, dateIndex: number): 'start' | 'middle' | 'end' | 'single' | null => {
    // Check if current day has any notification
    const hasCurrentNotif = hasUnreadNotification(unitId, dateStr);
    if (!hasCurrentNotif) return null;

    // Check if previous day has ANY notification (doesn't need to be the same one)
    const prevDateStr = dateIndex > 0 ? dates[dateIndex - 1].toISOString().split('T')[0] : null;
    const hasPrevNotif = prevDateStr ? hasUnreadNotification(unitId, prevDateStr) : false;

    // Check if next day has ANY notification (doesn't need to be the same one)
    const nextDateStr = dateIndex < dates.length - 1 ? dates[dateIndex + 1].toISOString().split('T')[0] : null;
    const hasNextNotif = nextDateStr ? hasUnreadNotification(unitId, nextDateStr) : false;

    // Determine position - connects all adjacent notifications regardless of type
    if (!hasPrevNotif && !hasNextNotif) return 'single';
    if (!hasPrevNotif && hasNextNotif) return 'start';
    if (hasPrevNotif && !hasNextNotif) return 'end';
    return 'middle';
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

            {/* Manual Sync Button */}
            <button
              onClick={triggerAvailabilitySync}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
              title="Wymuś synchronizację dostępności dla wszystkich obiektów"
            >
              {syncing ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Sync...
                </>
              ) : (
                <>
                  <RefreshCw size={14} />
                  Sync
                </>
              )}
            </button>

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
          <div className="mb-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {getNotificationSummary().map((item, idx) => {
                const isRead = readNotificationIds.has(item.notificationId);
                const isAvailable = item.changeType === 'available';

                // Gray out if read
                const bgColor = isRead
                  ? 'bg-slate-800/50'
                  : isAvailable ? 'bg-green-900/30' : 'bg-red-900/30';
                const borderColor = isRead
                  ? 'border-slate-700/50'
                  : isAvailable ? 'border-green-700/50' : 'border-red-700/50';
                const nameColor = isRead
                  ? 'text-slate-500'
                  : isAvailable ? 'text-green-400' : 'text-red-400';
                const dateColor = isRead
                  ? 'text-slate-600'
                  : isAvailable ? 'text-green-300' : 'text-red-300';

                return (
                  <button
                    key={idx}
                    onClick={() => handleMarkNotificationAsRead(item.notificationId)}
                    className={`inline-flex items-center gap-2 px-2.5 py-0.5 ${bgColor} border ${borderColor} rounded-full text-[10px] transition-opacity hover:opacity-80 cursor-pointer ${
                      isRead ? 'opacity-60' : ''
                    }`}
                  >
                    <span className={`font-semibold ${nameColor}`}>{item.unitName}</span>
                    <span className={dateColor}>{item.dateRange}</span>
                    {!isRead && <span className="text-slate-500 text-[9px]">(kliknij aby odczytać)</span>}
                    {isRead && <span className="text-slate-600 text-[9px]">✓ odczytane (kliknij aby cofnąć)</span>}
                  </button>
                );
              })}
            </div>

            {/* Sync to Hotres Button */}
            {readNotificationIds.size > 0 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSyncToHotres}
                  className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2.5 px-5 rounded-lg shadow-md transition-all hover:shadow-lg active:scale-98 flex items-center justify-center gap-2"
                >
                  <span className="text-sm">Wyślij na Hotres</span>
                  <span className="text-[10px] bg-yellow-800 px-2 py-0.5 rounded-full">
                    {readNotificationIds.size}
                  </span>
                </button>
                <div className="text-xs text-slate-400 whitespace-nowrap">
                  Pozostało: <span className="font-bold text-yellow-400">{15 - hotresSyncCount.count}</span>/15
                </div>
              </div>
            )}
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
              {/* Month headers row */}
              <tr className="bg-surface border-b border-border">
                <th className="sticky left-0 z-40 bg-surface border-r border-border min-w-[120px]"></th>
                {(() => {
                  const monthGroups: Array<{ month: string; year: string; count: number; startIdx: number }> = [];
                  let currentMonth = '';
                  let currentYear = '';
                  let count = 0;
                  let startIdx = 0;

                  dates.forEach((date, idx) => {
                    const month = date.toLocaleDateString('pl-PL', { month: 'long' });
                    const year = date.getFullYear().toString();
                    const monthYear = `${month} ${year}`;

                    if (monthYear !== currentMonth) {
                      if (count > 0) {
                        monthGroups.push({ month: currentMonth.split(' ')[0], year: currentYear, count, startIdx });
                      }
                      currentMonth = monthYear;
                      currentYear = year;
                      count = 1;
                      startIdx = idx;
                    } else {
                      count++;
                    }
                  });

                  // Push last group
                  if (count > 0) {
                    monthGroups.push({ month: currentMonth.split(' ')[0], year: currentYear, count, startIdx });
                  }

                  return monthGroups.map((group, idx) => (
                    <th
                      key={idx}
                      colSpan={group.count}
                      className="p-1 text-center text-xs font-bold text-slate-300 border-r border-border bg-slate-800/50"
                    >
                      <div className="capitalize">{group.month}</div>
                      <div className="text-[9px] text-slate-500 font-normal">{group.year}</div>
                    </th>
                  ));
                })()}
              </tr>
              {/* Day headers row */}
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
                      const notifPosition = getNotificationPosition(unit.id, dateStr, idx);

                      const isBooked = status === 'booked';
                      const cellClass = isBooked
                        ? 'h-7 rounded-sm transition-colors cursor-pointer bg-red-600/60 hover:bg-red-600/80 flex items-center justify-center text-white font-bold text-sm'
                        : 'h-7 rounded-sm transition-colors cursor-pointer bg-green-600/60 hover:bg-green-600/80 flex items-center justify-center text-white font-bold text-sm';

                      // Continuous yellow box styling
                      let notifBoxClass = '';
                      if (notifPosition === 'single') {
                        notifBoxClass = 'border-2 border-yellow-500 rounded';
                      } else if (notifPosition === 'start') {
                        notifBoxClass = 'border-2 border-yellow-500 rounded-l border-r-0';
                      } else if (notifPosition === 'middle') {
                        notifBoxClass = 'border-t-2 border-b-2 border-yellow-500';
                      } else if (notifPosition === 'end') {
                        notifBoxClass = 'border-2 border-yellow-500 rounded-r border-l-0';
                      }

                      return (
                        <td
                          key={idx}
                          className={`p-1 border-r border-border ${
                            isSelected ? 'bg-indigo-900/30' : isToday ? 'bg-indigo-900/20' : ''
                          } ${notifBoxClass}`}
                        >
                          <div className="flex flex-col gap-1">
                            {/* Colored cell with 0/1 */}
                            <div
                              className={cellClass}
                              title={`${unit.name} - ${dateStr}: ${status || 'available'}`}
                            >
                              {isBooked ? '0' : '1'}
                            </div>

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
            <div className="space-y-2 mt-2">
              <div className="flex items-center justify-center gap-4 text-xs flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-green-600/60 flex items-center justify-center text-white font-bold text-xs">1</div>
                  <span className="text-slate-400">Dostępny</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-red-600/60 flex items-center justify-center text-white font-bold text-xs">0</div>
                  <span className="text-slate-400">Zajęty</span>
                </div>
                <div className="w-px h-4 bg-slate-700"></div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded border-2 border-yellow-500"></div>
                  <span className="text-slate-400">Nieodczytane</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-green-900/30 border border-green-700/50"></div>
                  <span className="text-slate-400">Zwolnienie (powiadomienie)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-red-900/30 border border-red-700/50"></div>
                  <span className="text-slate-400">Blokada (powiadomienie)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-slate-800/50 border border-slate-700/50"></div>
                  <span className="text-slate-400">Odczytane (powiadomienie)</span>
                </div>
              </div>
              <div className="flex items-center justify-center gap-6 text-[11px] text-slate-500">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-400">CTA:</span>
                  <span>Przyjazd niemożliwy</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-400">CTD:</span>
                  <span>Wyjazd niemożliwy</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
