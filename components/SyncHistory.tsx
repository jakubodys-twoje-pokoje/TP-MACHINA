import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { SyncHistory as SyncHistoryType } from '../types';
import { ChevronDown, ChevronRight, Clock, RefreshCw, AlertCircle, CheckCircle2, BarChart3, Bell, TrendingUp } from 'lucide-react';

interface GroupedHistory {
  propertyId: string;
  propertyName: string;
  history: SyncHistoryType[];
}

export const SyncHistory: React.FC = () => {
  const [history, setHistory] = useState<SyncHistoryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchSyncHistory();
  }, []);

  const fetchSyncHistory = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('sync_history')
        .select('*')
        .order('synced_at', { ascending: false })
        .limit(100); // Last 100 sync events

      if (error) {
        console.error('Error fetching sync history:', error);
      } else {
        setHistory(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch sync history:', err);
    } finally {
      setLoading(false);
    }
  };

  const groupedHistory = React.useMemo(() => {
    const groups = new Map<string, GroupedHistory>();

    history.forEach(h => {
      if (!groups.has(h.property_id)) {
        groups.set(h.property_id, {
          propertyId: h.property_id,
          propertyName: h.property_name,
          history: []
        });
      }
      groups.get(h.property_id)!.history.push(h);
    });

    return Array.from(groups.values());
  }, [history]);

  const toggleGroup = (propertyId: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(propertyId)) {
        newSet.delete(propertyId);
      } else {
        newSet.add(propertyId);
      }
      return newSet;
    });
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="animate-spin text-slate-400" size={24} />
        <span className="ml-2 text-slate-400">Ładowanie historii synchronizacji...</span>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <Clock size={48} className="mx-auto mb-4 opacity-50" />
        <p>Brak historii synchronizacji</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2">
          <BarChart3 size={24} />
          Historia Synchronizacji
        </h2>
        <button
          onClick={fetchSyncHistory}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
        >
          <RefreshCw size={16} />
          Odśwież
        </button>
      </div>

      {groupedHistory.map(group => {
        const isCollapsed = collapsedGroups.has(group.propertyId);
        const latestSync = group.history[0];
        const totalRecords = group.history.reduce((sum, h) => sum + h.records_compared, 0);
        const totalChanges = group.history.reduce((sum, h) => sum + h.changes_detected, 0);
        const totalNotifications = group.history.reduce((sum, h) => sum + h.notifications_sent, 0);

        return (
          <div key={group.propertyId} className="bg-slate-800/50 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleGroup(group.propertyId)}
              className="w-full flex items-center justify-between p-4 hover:bg-slate-800 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isCollapsed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
                <h3 className="text-lg font-semibold text-slate-200">{group.propertyName}</h3>
                <span className="text-xs text-slate-500">({group.history.length} synchronizacji)</span>
                {latestSync.status === 'success' ? (
                  <CheckCircle2 size={18} className="text-green-400" />
                ) : (
                  <AlertCircle size={18} className="text-red-400" />
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-400">
                <span className="flex items-center gap-1">
                  <BarChart3 size={14} />
                  {totalRecords} porównanych
                </span>
                <span className="flex items-center gap-1">
                  <TrendingUp size={14} />
                  {totalChanges} zmian
                </span>
                <span className="flex items-center gap-1">
                  <Bell size={14} />
                  {totalNotifications} powiadomień
                </span>
              </div>
            </button>

            {!isCollapsed && (
              <div className="px-4 pb-4 space-y-2">
                {group.history.map(sync => (
                  <div
                    key={sync.id}
                    className={`p-3 rounded-lg ${
                      sync.status === 'success'
                        ? 'bg-slate-700/50 border border-slate-600'
                        : 'bg-red-900/20 border border-red-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Clock size={14} />
                        <span>{formatDateTime(sync.synced_at)}</span>
                        {sync.status === 'error' && (
                          <span className="flex items-center gap-1 text-red-400">
                            <AlertCircle size={14} />
                            Błąd
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex flex-col items-end">
                          <span className="text-slate-300 font-medium">{sync.records_compared}</span>
                          <span className="text-xs text-slate-500">porównanych</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-green-400 font-medium">{sync.changes_detected}</span>
                          <span className="text-xs text-slate-500">zmian</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-indigo-400 font-medium">{sync.notifications_sent}</span>
                          <span className="text-xs text-slate-500">powiadomień</span>
                        </div>
                      </div>
                    </div>
                    {sync.error_message && (
                      <div className="mt-2 text-xs text-red-300 bg-red-950/30 p-2 rounded">
                        {sync.error_message}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
