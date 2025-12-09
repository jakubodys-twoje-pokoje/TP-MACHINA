import React from 'react';
import { useProperties } from '../contexts/PropertyContext';
import { Notification } from '../types';
import { Loader2, Bell, Check, Trash2, CheckCheck, Inbox, ArrowUp, ArrowDown } from 'lucide-react';
import { Link } from 'react-router-dom';

const formatDateRange = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (start === end) {
    return startDate.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  return `${startDate.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })} - ${endDate.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
};

const NotificationItem: React.FC<{ notification: Notification; onMarkRead: (id: string) => void; onDelete: (id: string) => void; }> = ({ notification, onMarkRead, onDelete }) => {
  const isAvailable = notification.change_type === 'available';
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
        <p className="text-xs text-slate-400 mt-1">
          <Link to={`/property/${notification.property_id}/units`} className="font-semibold text-indigo-400 hover:underline">{notification.property_name}</Link>
          <span className="text-slate-600 mx-1">/</span>
          {notification.unit_name}
        </p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-1">
        {!notification.is_read && (
          <button onClick={() => onMarkRead(notification.id)} title="Oznacz jako przeczytane" className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors">
            <Check size={16} />
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
  const { notifications, loading, markNotificationAsRead, markAllNotificationsAsRead, deleteNotification } = useProperties();

  const unreadNotifications = notifications.filter(n => !n.is_read);
  const readNotifications = notifications.filter(n => n.is_read).slice(0, 20); // Show last 20 read

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
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Nieodczytane ({unreadNotifications.length})</h3>
              {unreadNotifications.length > 0 && (
                <button 
                  onClick={markAllNotificationsAsRead}
                  className="text-sm flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-slate-300 transition-colors"
                >
                  <CheckCheck size={16} /> Oznacz wszystkie jako przeczytane
                </button>
              )}
            </div>
            {unreadNotifications.length > 0 ? (
              <div className="space-y-3">
                {unreadNotifications.map(n => <NotificationItem key={n.id} notification={n} onMarkRead={markNotificationAsRead} onDelete={deleteNotification} />)}
              </div>
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
              <h3 className="text-lg font-bold text-white mb-4">Ostatnio odczytane</h3>
               <div className="space-y-3 opacity-60">
                {readNotifications.map(n => <NotificationItem key={n.id} notification={n} onMarkRead={markNotificationAsRead} onDelete={deleteNotification} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};
