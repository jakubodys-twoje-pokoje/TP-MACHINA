import React, { useState, useMemo } from 'react';
import { useProperties } from '../contexts/PropertyContext';
import { Notification } from '../types';
import { Loader2, Bell, Check, Trash2, Inbox, ArrowUp, ArrowDown, LayoutGrid, List, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';

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

  return (
    <div className="flex items-start gap-4 p-4 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors">
      <div className={`mt-1 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isAvailable ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
        {isAvailable ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
      </div>
      <div className="flex-grow">
        <p className="text-sm text-slate-300">
          <span className={`font-bold ${isAvailable ? 'text-green-400' : 'text-red-400'}`}>
            {isAvailable ? 'Zwolniono termin: ' : 'Zablokowano termin: '}
          </span>
           {formatDateRange(notification.start_date, notification.end_date)}
        </p>
        <p className="text-sm font-medium text-slate-300 mt-1">
          <Link to={`/property/${notification.property_id}/units`} className="font-bold text-indigo-400 hover:text-indigo-300 hover:underline">{notification.property_name}</Link>
          <span className="text-slate-600 mx-1">/</span>
          <span className="text-slate-300">{notification.unit_name}</span>
        </p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        <div className="flex flex-col items-end">
          <span className="text-[10px] italic text-slate-500 whitespace-nowrap">{formattedTime}</span>
          {notification.is_read && notification.read_by_email && (
            <span className="text-[9px] text-slate-600 whitespace-nowrap">{notification.read_by_email}</span>
          )}
        </div>
        {!notification.is_read && (
          <button onClick={() => onMarkRead(notification.id)} title="Oznacz jako przeczytane" className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors">
            <Check size={16} />
          </button>
        )}
        {notification.is_read && (
          <button onClick={() => onMarkUnread(notification.id)} title="Przywróć do nieodczytanych" className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-md transition-colors">
            <RotateCcw size={16} />
          </button>
        )}
         <button onClick={() => onDelete(notification.id)} title="Usuń" className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors">
            <Trash2 size={16} />
          </button>
      </div>
    </div>
  );
};


export const Dashboard: React.FC = () => {
  const { notifications, loading, markNotificationAsRead, markNotificationAsUnread, markAllNotificationsAsRead, deleteAllReadNotifications, deleteNotification } = useProperties();
  const [groupByProperty, setGroupByProperty] = useState(false);
  const [collapsedReadGroups, setCollapsedReadGroups] = useState<Set<string>>(new Set());

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

    const groupsArray = Array.from(groups.values());

    // Set all groups as collapsed by default on first render
    setCollapsedReadGroups(prev => {
      if (prev.size === 0 && groupsArray.length > 0) {
        return new Set(groupsArray.map(g => g.propertyId));
      }
      return prev;
    });

    return groupsArray;
  }, [readNotifications]);

  return (
    <div className="space-y-8">
       <div className="border-b border-border pb-4">
        <h2 className="text-2xl font-bold text-white">Zmiany w dostępności</h2>
        <p className="text-slate-400 text-sm mt-1">Automatycznie wygenerowane powiadomienia o zmianach statusu kwater.</p>
      </div>
      
      {loading ? (
        <div className="text-center py-20 text-slate-500"><Loader2 className="animate-spin" /></div>
      ) : (
        <>
          {/* Unread Notifications */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-lg font-bold text-white">Nieodczytane ({unreadNotifications.length})</h3>
              {unreadNotifications.length > 0 && (
                <button
                  onClick={() => setGroupByProperty(!groupByProperty)}
                  className="text-xs flex items-center gap-1.5 px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded-md text-slate-400 transition-colors"
                  title={groupByProperty ? 'Widok płaski' : 'Grupuj po obiektach'}
                >
                  {groupByProperty ? <List size={14} /> : <LayoutGrid size={14} />}
                  {groupByProperty ? 'Płaska lista' : 'Grupuj po obiektach'}
                </button>
              )}
            </div>
            {unreadNotifications.length > 0 ? (
              groupByProperty ? (
                // Grouped view by property
                <div className="space-y-6">
                  {groupedUnread.map(group => (
                    <div key={group.propertyId} className="space-y-2">
                      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/50 rounded-lg border border-slate-700">
                        <Link
                          to={`/property/${group.propertyId}/units`}
                          className="font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          {group.propertyName}
                        </Link>
                        <span className="text-xs text-slate-500">({group.notifications.length})</span>
                      </div>
                      <div className="space-y-2 pl-4">
                        {group.notifications.map(n => (
                          <NotificationItem key={n.id} notification={n} onMarkRead={markNotificationAsRead} onMarkUnread={markNotificationAsUnread} onDelete={deleteNotification} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                // Flat view
                <div className="space-y-3">
                  {unreadNotifications.map(n => <NotificationItem key={n.id} notification={n} onMarkRead={markNotificationAsRead} onMarkUnread={markNotificationAsUnread} onDelete={deleteNotification} />)}
                </div>
              )
            ) : (
              <div className="text-center py-12 bg-surface rounded-xl border border-border">
                <Inbox size={40} className="mx-auto text-slate-600 mb-4" />
                <h3 className="font-bold text-white">Brak nowych powiadomień</h3>
                <p className="text-slate-400 text-sm">Wszystko jest na bieżąco!</p>
              </div>
            )}
          </section>

          {/* Read Notifications */}
          {readNotifications.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">Ostatnio odczytane</h3>
                <button
                  onClick={deleteAllReadNotifications}
                  className="text-sm flex items-center gap-2 px-3 py-1.5 text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                >
                  <Trash2 size={16} /> Usuń wszystkie przeczytane
                </button>
              </div>
              <div className="opacity-60">
                {groupByProperty ? (
                  // Grouped view by property (collapsible)
                  <div className="space-y-6">
                    {groupedRead.map(group => {
                      const isCollapsed = collapsedReadGroups.has(group.propertyId);
                      return (
                        <div key={group.propertyId} className="space-y-2">
                          <div
                            className="flex items-center gap-2 px-3 py-2 bg-slate-900/50 rounded-lg border border-slate-700 cursor-pointer hover:bg-slate-800/50 transition-colors"
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
                            {isCollapsed ? <ChevronRight size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                            <Link
                              to={`/property/${group.propertyId}/units`}
                              className="font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {group.propertyName}
                            </Link>
                            <span className="text-xs text-slate-500">({group.notifications.length})</span>
                          </div>
                          {!isCollapsed && (
                            <div className="space-y-2 pl-4">
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
                  <div className="space-y-3">
                    {readNotifications.map(n => <NotificationItem key={n.id} notification={n} onMarkRead={markNotificationAsRead} onMarkUnread={markNotificationAsUnread} onDelete={deleteNotification} />)}
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};