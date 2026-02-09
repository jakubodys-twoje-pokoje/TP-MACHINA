import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useProperties } from '../contexts/PropertyContext';
import { Notification } from '../types';
import { Loader2, Bell, Check, Trash2, Inbox, ArrowUp, ArrowDown, LayoutGrid, List, ChevronDown, ChevronRight, RotateCcw, BarChart3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SyncHistory } from './SyncHistory';

const formatDateRange = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (start === end) {
    return startDate.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  return `${startDate.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })} - ${endDate.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
};

const NotificationItem: React.FC<{
  notification: Notification;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ notification, onMarkRead, onMarkUnread, onDelete }) => {
  const isAvailable = notification.change_type === 'available';
  const createdDate = new Date(notification.created_at);
  const formattedTime = createdDate.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const readAtDate = notification.read_at ? new Date(notification.read_at) : null;
  const formattedReadAt = readAtDate ? readAtDate.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) : null;

  return (
    <div className="flex flex-col sm:flex-row items-start gap-2 sm:gap-3 lg:gap-4 p-3 sm:p-4 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors">
      <div className={`flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center ${isAvailable ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
        {isAvailable ? <ArrowDown size={16} className="sm:w-[18px] sm:h-[18px]" /> : <ArrowUp size={16} className="sm:w-[18px] sm:h-[18px]" />}
      </div>
      <div className="flex-grow min-w-0">
        <p className="text-xs sm:text-sm text-slate-300">
          <span className={`font-bold ${isAvailable ? 'text-green-400' : 'text-red-400'}`}>
            {isAvailable ? 'Zwolniono termin: ' : 'Zablokowano termin: '}
          </span>
           {formatDateRange(notification.start_date, notification.end_date)}
        </p>
        <p className="text-xs sm:text-sm font-medium text-slate-300 mt-0.5 sm:mt-1">
          <Link to={`/property/${notification.property_id}/calendar`} className="font-bold text-indigo-400 hover:text-indigo-300 hover:underline">{notification.property_name}</Link>
          <span className="text-slate-600 mx-1">/</span>
          <span className="text-slate-300">{notification.unit_name}</span>
        </p>
      </div>
      <div className="flex-shrink-0 flex flex-row sm:flex-col lg:flex-row items-start sm:items-end lg:items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
        <div className="flex flex-col items-start sm:items-end flex-1 sm:flex-initial">
          <span className="text-[9px] sm:text-[10px] italic text-slate-500 whitespace-nowrap">{formattedTime}</span>
          {notification.is_read && formattedReadAt && (
            <span className="text-[8px] sm:text-[9px] text-green-600 whitespace-nowrap">Przeczytano: {formattedReadAt}</span>
          )}
          {notification.is_read && notification.read_by_email && (
            <span className="text-[8px] sm:text-[9px] text-slate-600 whitespace-nowrap truncate max-w-[120px]">{notification.read_by_email}</span>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-1.5">
          {!notification.is_read && (
            <button onClick={() => onMarkRead(notification.id)} title="Oznacz jako przeczytane" className="p-1.5 sm:p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors">
              <Check size={14} className="sm:w-4 sm:h-4" />
            </button>
          )}
          {notification.is_read && (
            <button onClick={() => onMarkUnread(notification.id)} title="Przywróć do nieodczytanych" className="p-1.5 sm:p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-md transition-colors">
              <RotateCcw size={14} className="sm:w-4 sm:h-4" />
            </button>
          )}
           <button onClick={() => onDelete(notification.id)} title="Usuń" className="p-1.5 sm:p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors">
              <Trash2 size={14} className="sm:w-4 sm:h-4" />
            </button>
        </div>
      </div>
    </div>
  );
};


export const Dashboard: React.FC = () => {
  const { notifications, loading, markNotificationAsRead, markNotificationAsUnread, markAllNotificationsAsRead, deleteNotification } = useProperties();
  const [groupByProperty, setGroupByProperty] = useState(true);
  const [collapsedUnreadGroups, setCollapsedUnreadGroups] = useState<Set<string>>(new Set());
  const [collapsedReadGroups, setCollapsedReadGroups] = useState<Set<string>>(new Set());
  const [showSyncHistory, setShowSyncHistory] = useState(false);
  const prevPropertyIdsRef = useRef<string>('');

  const unreadNotifications = notifications.filter(n => !n.is_read);
  const readNotifications = notifications.filter(n => n.is_read).slice(0, 20); // Show last 20 read

  // Group notifications by property
  const groupedUnread = useMemo(() => {
    const groups = new Map<string, { propertyName: string; propertyId: string; notifications: Notification[] }>();

    unreadNotifications.forEach(n => {
      if (!groups.has(n.property_id)) {
        groups.set(n.property_id, {
          propertyName: n.property_name,
          propertyId: n.property_id,
          notifications: []
        });
      }
      groups.get(n.property_id)!.notifications.push(n);
    });

    return Array.from(groups.values());
  }, [unreadNotifications]);

  const groupedRead = useMemo(() => {
    const groups = new Map<string, { propertyName: string; propertyId: string; notifications: Notification[] }>();

    readNotifications.forEach(n => {
      if (!groups.has(n.property_id)) {
        groups.set(n.property_id, {
          propertyName: n.property_name,
          propertyId: n.property_id,
          notifications: []
        });
      }
      groups.get(n.property_id)!.notifications.push(n);
    });

    return Array.from(groups.values());
  }, [readNotifications]);

  // Set all read groups as collapsed by default when new properties appear
  useEffect(() => {
    const currentPropertyIds = groupedRead.map(g => g.propertyId).sort().join(',');

    // Only update if property IDs have changed
    if (currentPropertyIds !== prevPropertyIdsRef.current) {
      prevPropertyIdsRef.current = currentPropertyIds;

      const propertyIds = groupedRead.map(g => g.propertyId);
      setCollapsedReadGroups(prev => {
        const newSet = new Set(prev);
        propertyIds.forEach(id => newSet.add(id));
        return newSet;
      });
    }
  }, [groupedRead]);

  return (
    <div className="space-y-4 sm:space-y-6 lg:space-y-8">
       <div className="border-b border-border pb-3 sm:pb-4 flex flex-col sm:flex-row items-start gap-3 sm:gap-0 sm:justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">Zmiany w dostępności</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Automatycznie wygenerowane powiadomienia o zmianach statusu kwater.</p>
        </div>
        <button
          onClick={() => setShowSyncHistory(true)}
          className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors text-xs sm:text-sm whitespace-nowrap"
        >
          <BarChart3 size={16} className="sm:w-[18px] sm:h-[18px]" />
          Historia synchronizacji
        </button>
      </div>
      
      {loading ? (
        <div className="text-center py-20 text-slate-500"><Loader2 className="animate-spin" /></div>
      ) : (
        <>
          {/* Unread Notifications */}
          <section>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <h3 className="text-base sm:text-lg font-bold text-white">Nieodczytane ({unreadNotifications.length})</h3>
              {unreadNotifications.length > 0 && (
                <button
                  onClick={() => setGroupByProperty(!groupByProperty)}
                  className="text-[10px] sm:text-xs flex items-center gap-1 sm:gap-1.5 px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-400 transition-colors"
                  title={groupByProperty ? 'Widok płaski' : 'Grupuj po obiektach'}
                >
                  {groupByProperty ? <List size={12} className="sm:w-3.5 sm:h-3.5" /> : <LayoutGrid size={12} className="sm:w-3.5 sm:h-3.5" />}
                  <span className="hidden sm:inline">{groupByProperty ? 'Płaska lista' : 'Grupuj po obiektach'}</span>
                  <span className="sm:hidden">{groupByProperty ? 'Płaska' : 'Grupuj'}</span>
                </button>
              )}
            </div>
            {unreadNotifications.length > 0 ? (
              groupByProperty ? (
                // Grouped view by property (collapsible)
                <div className="space-y-3 sm:space-y-4 lg:space-y-6">
                  {groupedUnread.map(group => {
                    const isCollapsed = collapsedUnreadGroups.has(group.propertyId);
                    return (
                      <div key={group.propertyId} className="space-y-1.5 sm:space-y-2">
                        <div
                          className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-900/50 rounded-lg border border-slate-700 cursor-pointer hover:bg-slate-800/50 transition-colors"
                          onClick={() => {
                            setCollapsedUnreadGroups(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(group.propertyId)) {
                                newSet.delete(group.propertyId);
                              } else {
                                newSet.add(group.propertyId);
                              }
                              return newSet;
                            });
                          }}
                        >
                          {isCollapsed ? <ChevronRight size={14} className="sm:w-4 sm:h-4 text-slate-500 flex-shrink-0" /> : <ChevronDown size={14} className="sm:w-4 sm:h-4 text-slate-500 flex-shrink-0" />}
                          <Link
                            to={`/property/${group.propertyId}/calendar`}
                            className="font-bold text-sm sm:text-base text-indigo-400 hover:text-indigo-300 transition-colors truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {group.propertyName}
                          </Link>
                          <span className="text-[10px] sm:text-xs text-slate-500 flex-shrink-0">({group.notifications.length})</span>
                        </div>
                        {!isCollapsed && (
                          <div className="space-y-1.5 sm:space-y-2 pl-2 sm:pl-3 lg:pl-4">
                            {group.notifications.map(n => (
                              <NotificationItem key={n.id} notification={n} onMarkRead={markNotificationAsRead} onMarkUnread={markNotificationAsUnread} onDelete={deleteNotification} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                // Flat view
                <div className="space-y-2 sm:space-y-3">
                  {unreadNotifications.map(n => <NotificationItem key={n.id} notification={n} onMarkRead={markNotificationAsRead} onMarkUnread={markNotificationAsUnread} onDelete={deleteNotification} />)}
                </div>
              )
            ) : (
              <div className="text-center py-8 sm:py-10 lg:py-12 bg-surface rounded-xl border border-border">
                <Inbox size={32} className="sm:w-10 sm:h-10 mx-auto text-slate-600 mb-3 sm:mb-4" />
                <h3 className="font-bold text-sm sm:text-base text-white">Brak nowych powiadomień</h3>
                <p className="text-slate-400 text-xs sm:text-sm">Wszystko jest na bieżąco!</p>
              </div>
            )}
          </section>

          {/* Read Notifications */}
          {readNotifications.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <h3 className="text-base sm:text-lg font-bold text-white">Ostatnio odczytane</h3>
              </div>
              <div className="opacity-60">
                {groupByProperty ? (
                  // Grouped view by property (collapsible)
                  <div className="space-y-3 sm:space-y-4 lg:space-y-6">
                    {groupedRead.map(group => {
                      const isCollapsed = collapsedReadGroups.has(group.propertyId);
                      return (
                        <div key={group.propertyId} className="space-y-1.5 sm:space-y-2">
                          <div
                            className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-900/50 rounded-lg border border-slate-700 cursor-pointer hover:bg-slate-800/50 transition-colors"
                            onClick={() => {
                              setCollapsedReadGroups(prev => {
                                const newSet = new Set(prev);
                                if (newSet.has(group.propertyId)) {
                                  newSet.delete(group.propertyId);
                                } else {
                                  newSet.add(group.propertyId);
                                }
                                return newSet;
                              });
                            }}
                          >
                            {isCollapsed ? <ChevronRight size={14} className="sm:w-4 sm:h-4 text-slate-500 flex-shrink-0" /> : <ChevronDown size={14} className="sm:w-4 sm:h-4 text-slate-500 flex-shrink-0" />}
                            <Link
                              to={`/property/${group.propertyId}/calendar`}
                              className="font-bold text-sm sm:text-base text-indigo-400 hover:text-indigo-300 transition-colors truncate"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {group.propertyName}
                            </Link>
                            <span className="text-[10px] sm:text-xs text-slate-500 flex-shrink-0">({group.notifications.length})</span>
                          </div>
                          {!isCollapsed && (
                            <div className="space-y-1.5 sm:space-y-2 pl-2 sm:pl-3 lg:pl-4">
                              {group.notifications.map(n => (
                                <NotificationItem key={n.id} notification={n} onMarkRead={markNotificationAsRead} onMarkUnread={markNotificationAsUnread} onDelete={deleteNotification} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // Flat view
                  <div className="space-y-2 sm:space-y-3">
                    {readNotifications.map(n => <NotificationItem key={n.id} notification={n} onMarkRead={markNotificationAsRead} onMarkUnread={markNotificationAsUnread} onDelete={deleteNotification} />)}
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* Sync History Modal */}
      {showSyncHistory && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3 sm:p-4" onClick={() => setShowSyncHistory(false)}>
          <div className="bg-slate-900 rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 sm:p-5 lg:p-6 border-b border-slate-700">
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-200 flex items-center gap-1.5 sm:gap-2">
                <BarChart3 size={20} className="sm:w-5 sm:h-5 lg:w-6 lg:h-6" />
                <span className="hidden sm:inline">Historia Synchronizacji</span>
                <span className="sm:hidden">Historia</span>
              </h2>
              <button
                onClick={() => setShowSyncHistory(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto p-4 sm:p-5 lg:p-6">
              <SyncHistory />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};