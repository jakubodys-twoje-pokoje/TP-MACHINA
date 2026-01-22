import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { SyncHistory as SyncHistoryType } from '../types';
import { ChevronDown, ChevronRight, Clock, RefreshCw, AlertCircle, CheckCircle2, BarChart3, Bell, TrendingUp, List, Play, Trash2 } from 'lucide-react';

interface GroupedHistory {
  propertyId: string;
  propertyName: string;
  history: SyncHistoryType[];
}

interface UnitDetail {
  id: string;
  unit_name: string;
  days_fetched: number;
  records_compared: number;
  changes_detected: number;
}

export const SyncHistory: React.FC = () => {
  const [history, setHistory] = useState<SyncHistoryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedSyncs, setExpandedSyncs] = useState<Set<string>>(new Set());
  const [unitDetails, setUnitDetails] = useState<Map<string, UnitDetail[]>>(new Map());

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

  const toggleSyncDetails = async (syncId: string) => {
    setExpandedSyncs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(syncId)) {
        newSet.delete(syncId);
      } else {
        newSet.add(syncId);
      }
      return newSet;
    });

    // Fetch unit details if not already loaded
    if (!unitDetails.has(syncId)) {
      try {
        const { data, error } = await supabase
          .from('sync_unit_details')
          .select('*')
          .eq('sync_history_id', syncId)
          .order('unit_name');

        if (error) {
          console.error('Error fetching unit details:', error);
          // Set empty array to stop loading spinner
          setUnitDetails(prev => new Map(prev).set(syncId, []));
        } else {
          // Set data (even if empty array)
          setUnitDetails(prev => new Map(prev).set(syncId, data || []));
        }
      } catch (err) {
        console.error('Failed to fetch unit details:', err);
        // Set empty array to stop loading spinner
        setUnitDetails(prev => new Map(prev).set(syncId, []));
      }
    }
  };

  const triggerManualSync = async () => {
    if (syncing) return;

    if (!confirm('Czy na pewno chcesz wymusić ręczną synchronizację? To wywoła synchronizację wszystkich obiektów.')) {
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

      // Refresh history after sync
      await fetchSyncHistory();
    } catch (error: any) {
      console.error('Manual sync error:', error);
      alert(`Błąd synchronizacji: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const clearHistory = async () => {
    if (!confirm('Czy na pewno chcesz wyczyścić całą historię synchronizacji? Ta akcja jest nieodwracalna.')) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('sync_history')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all records

      if (error) {
        console.error('Error clearing sync history:', error);
        alert('Błąd podczas czyszczenia historii: ' + error.message);
      } else {
        alert('Historia synchronizacji została wyczyszczona');
        setHistory([]);
        setExpandedSyncs(new Set());
        setUnitDetails(new Map());
      }
    } catch (err: any) {
      console.error('Failed to clear sync history:', err);
      alert('Błąd podczas czyszczenia historii: ' + err.message);
    } finally {
      setLoading(false);
    }
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
      <div className="flex items-center justify-end gap-3 mb-4">
        <button
          onClick={triggerManualSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
        >
          {syncing ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              Synchronizacja...
            </>
          ) : (
            <>
              <Play size={16} />
              Wymuś synchronizację
            </>
          )}
        </button>
        <button
          onClick={fetchSyncHistory}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
        >
          <RefreshCw size={16} />
          Odśwież historię
        </button>
        <button
          onClick={clearHistory}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          <Trash2 size={16} />
          Wyczyść historię
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

                    {/* Per-unit details button */}
                    <div className="mt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSyncDetails(sync.id);
                        }}
                        className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 transition-colors"
                      >
                        {expandedSyncs.has(sync.id) ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        <List size={14} />
                        <span>Zobacz szczegóły kwater ({sync.records_compared || 0} rekordów)</span>
                      </button>

                      {/* Unit details dropdown */}
                      {expandedSyncs.has(sync.id) && (
                        <div className="mt-2 bg-slate-900/50 border border-slate-700 rounded-lg overflow-hidden">
                          {unitDetails.has(sync.id) ? (
                            unitDetails.get(sync.id)!.length > 0 ? (
                              <table className="w-full text-xs">
                                <thead className="bg-slate-800/50">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-slate-400 font-medium">Kwatera</th>
                                    <th className="px-3 py-2 text-right text-slate-400 font-medium">Dni pobrane</th>
                                    <th className="px-3 py-2 text-right text-slate-400 font-medium">Porównane</th>
                                    <th className="px-3 py-2 text-right text-slate-400 font-medium">Zmiany</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700">
                                  {unitDetails.get(sync.id)!.map(unit => (
                                    <tr key={unit.id} className="hover:bg-slate-800/30">
                                      <td className="px-3 py-2 text-slate-300">{unit.unit_name}</td>
                                      <td className="px-3 py-2 text-right text-indigo-400 font-medium">{unit.days_fetched}</td>
                                      <td className="px-3 py-2 text-right text-slate-400">{unit.records_compared}</td>
                                      <td className="px-3 py-2 text-right text-green-400 font-medium">{unit.changes_detected}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <div className="p-4 text-center text-slate-500">
                                <AlertCircle className="inline-block mr-2" size={14} />
                                Brak szczegółowych danych. Synchronizacja została wykonana przed dodaniem funkcji trackingu per-kwatera. Uruchom nową synchronizację aby zobaczyć szczegóły.
                              </div>
                            )
                          ) : (
                            <div className="p-4 text-center text-slate-500">
                              <RefreshCw className="animate-spin inline-block mr-2" size={14} />
                              Ładowanie szczegółów...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
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
