
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { useProperties } from '../contexts/PropertyContext';
import { WorkflowTask, WorkflowStatus, WorkflowEntry, Property } from '../types';
import { 
  Plus, X, Loader2, Save, Trash2, Settings, MessageSquare, 
  Search, Eye, EyeOff, GripVertical 
} from 'lucide-react';

const COLORS = [
  { label: 'Szary', class: 'bg-slate-600' },
  { label: 'Czerwony', class: 'bg-red-600' },
  { label: 'Pomarańczowy', class: 'bg-orange-500' },
  { label: 'Indygo', class: 'bg-indigo-600' },
  { label: 'Fioletowy', class: 'bg-purple-600' },
  { label: 'Zielony', class: 'bg-green-600' },
];

export const WorkflowView: React.FC = () => {
  const { properties, fetchProperties } = useProperties();
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);
  const [entries, setEntries] = useState<WorkflowEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [localProperties, setLocalProperties] = useState<Property[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<'task' | 'property' | null>(null);

  // Krytyczny ref do blokowania nadpisywania stanu podczas operacji
  const isProcessing = useRef(false);

  // Synchronizacja inicjalna i przy zmianach zewnętrznych
  useEffect(() => {
    if (!isProcessing.current && !dragType) {
      setLocalProperties([...properties]);
    }
  }, [properties, dragType]);

  const fetchTasks = useCallback(async () => {
    if (isProcessing.current) return;
    const { data } = await supabase.from('workflow_tasks').select('*').order('position', { ascending: true });
    if (data) setTasks(data);
  }, []);

  const fetchStatuses = useCallback(async () => {
    const { data } = await supabase.from('workflow_statuses').select('*').order('created_at', { ascending: true });
    if (data) setStatuses(data);
  }, []);

  const handleEntryRealtime = useCallback((payload: any) => {
    if (isProcessing.current) return;
    if (payload.eventType === 'INSERT') setEntries(prev => [...prev, payload.new]);
    else if (payload.eventType === 'UPDATE') setEntries(prev => prev.map(e => e.id === payload.new.id ? payload.new : e));
    else if (payload.eventType === 'DELETE') setEntries(prev => prev.filter(e => e.id !== payload.old.id));
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      const [tRes, sRes, eRes] = await Promise.all([
        supabase.from('workflow_tasks').select('*').order('position', { ascending: true }),
        supabase.from('workflow_statuses').select('*').order('created_at', { ascending: true }),
        supabase.from('workflow_entries').select('*')
      ]);
      setTasks(tRes.data || []);
      setStatuses(sRes.data || []);
      setEntries(eRes.data || []);
      setLocalProperties([...properties]);
      setLoading(false);
    };
    loadAll();

    const channel = supabase.channel('workflow-v77')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_tasks' }, () => fetchTasks())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_statuses' }, () => fetchStatuses())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_entries' }, (p) => handleEntryRealtime(p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, () => {
         if (!isProcessing.current) fetchProperties();
      })
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [fetchTasks, fetchStatuses, handleEntryRealtime, fetchProperties]);

  // --- REORDER LOGIC ---
  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null); setDropTargetId(null); setDragType(null);
      return;
    }

    isProcessing.current = true;
    setIsSavingOrder(true);

    try {
      if (dragType === 'task') {
        const newList = [...tasks];
        const sIdx = newList.findIndex(t => t.id === draggedId);
        const tIdx = newList.findIndex(t => t.id === targetId);
        const [moved] = newList.splice(sIdx, 1);
        newList.splice(tIdx, 0, moved);
        
        setTasks(newList); // Optimistic UI

        // Update pozycji kolumn (tasks)
        const updates = newList.map((t, i) => 
          supabase.from('workflow_tasks').update({ position: i }).eq('id', t.id)
        );
        await Promise.all(updates);
        
        // Wymuszone odświeżenie po zapisie
        const { data } = await supabase.from('workflow_tasks').select('*').order('position', { ascending: true });
        if (data) setTasks(data);
      } 
      else if (dragType === 'property') {
        const newList = [...localProperties];
        const sIdx = newList.findIndex(p => p.id === draggedId);
        const tIdx = newList.findIndex(p => p.id === targetId);
        const [moved] = newList.splice(sIdx, 1);
        newList.splice(tIdx, 0, moved);

        setLocalProperties(newList); // Optimistic UI

        // Update pozycji rzędów (properties)
        const updates = newList.map((p, i) => 
          supabase.from('properties').update({ workflow_position: i }).eq('id', p.id)
        );
        await Promise.all(updates);
        
        // Wymuszone odświeżenie kontekstu
        await fetchProperties();
      }
    } catch (err: any) {
      console.error("Błąd zapisu kolejności:", err);
      alert("Błąd zapisu: " + err.message);
      await fetchProperties();
      const { data } = await supabase.from('workflow_tasks').select('*').order('position', { ascending: true });
      if (data) setTasks(data);
    } finally {
      setDraggedId(null);
      setDropTargetId(null);
      setDragType(null);
      setTimeout(() => {
        isProcessing.current = false;
        setIsSavingOrder(false);
      }, 800);
    }
  };

  // --- FILTRACJA I SORTOWANIE ---
  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => a.position - b.position), [tasks]);
  
  const filteredProperties = useMemo(() => {
    let list = [...localProperties];
    
    // Stabilne sortowanie
    list.sort((a, b) => {
      // Aktywne zawsze u góry
      const activeA = a.workflow_is_active === false ? 0 : 1;
      const activeB = b.workflow_is_active === false ? 0 : 1;
      if (activeA !== activeB) return activeB - activeA;
      
      // Potem po pozycji
      const posA = a.workflow_position ?? 999;
      const posB = b.workflow_position ?? 999;
      return posA - posB;
    });

    if (searchQuery) {
      list = list.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return list;
  }, [localProperties, searchQuery]);

  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isCellModalOpen, setIsCellModalOpen] = useState(false);
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newStatus, setNewStatus] = useState({ label: '', color: 'bg-slate-600' });
  const [selectedCell, setSelectedCell] = useState<{ propId: string, taskId: string } | null>(null);
  const [cellForm, setCellForm] = useState({ statusId: '', comment: '' });

  const handleToggleTaskActive = async (taskId: string, currentState: boolean) => {
    await supabase.from('workflow_tasks').update({ is_active: !currentState }).eq('id', taskId);
    fetchTasks();
  };

  const handleTogglePropertyActive = async (propId: string, currentState: boolean) => {
    await supabase.from('properties').update({ workflow_is_active: !currentState }).eq('id', propId);
    fetchProperties();
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const maxPos = tasks.length > 0 ? Math.max(...tasks.map(t => t.position)) : 0;
    await supabase.from('workflow_tasks').insert({ title: newTaskTitle, user_id: user.id, position: maxPos + 1, is_active: true });
    setNewTaskTitle(''); setIsTaskModalOpen(false); fetchTasks();
  };

  const handleAddPropertyLocal = async () => {
    if (!newPropertyName.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const maxPos = properties.length > 0 ? Math.max(...properties.map(p => p.workflow_position || 0)) : 0;
    await supabase.from('properties').insert({ 
        user_id: user.id, 
        name: newPropertyName, 
        workflow_position: maxPos + 1, 
        workflow_is_active: true 
    });
    setNewPropertyName(''); setIsPropertyModalOpen(false); fetchProperties();
  };

  const handleAddStatus = async () => {
    if (!newStatus.label.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('workflow_statuses').insert({ label: newStatus.label, color: newStatus.color, user_id: user.id });
    setNewStatus({ label: '', color: 'bg-slate-600' }); fetchStatuses();
  };

  const openCellModal = (propId: string, taskId: string) => {
    const entry = entries.find(e => e.property_id === propId && e.task_id === taskId);
    setSelectedCell({ propId, taskId });
    setCellForm({ statusId: entry?.status_id || '', comment: entry?.comment || '' });
    setIsCellModalOpen(true);
  };

  const saveCell = async () => {
    if (!selectedCell) return;
    const { data: { user } } = await supabase.auth.getUser();
    const existing = entries.find(e => e.property_id === selectedCell.propId && e.task_id === selectedCell.taskId);
    const payload = { 
      status_id: cellForm.statusId || null, 
      comment: cellForm.comment, 
      last_updated_by_email: user?.email || 'System', 
      updated_at: new Date().toISOString() 
    };
    if (existing) {
      await supabase.from('workflow_entries').update(payload).eq('id', existing.id);
    } else {
      await supabase.from('workflow_entries').insert({ ...payload, property_id: selectedCell.propId, task_id: selectedCell.taskId });
    }
    setIsCellModalOpen(false);
  };

  const getStatus = (id: string | null) => statuses.find(s => s.id === id);
  const getEntry = (propId: string, taskId: string) => entries.find(e => e.property_id === propId && e.task_id === taskId);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" /></div>;

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] overflow-hidden space-y-4">
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 flex-shrink-0 bg-surface p-4 rounded-xl border border-border">
        <div className="flex items-center gap-4">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input type="text" placeholder="Szukaj obiektu..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2.5 pl-10 pr-4 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all" />
          </div>
          {isSavingOrder && (
            <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold animate-pulse">
              <Loader2 size={14} className="animate-spin" /> ZAPISYWANIE...
            </div>
          )}
        </div>
        <div className="flex gap-2">
            <button onClick={() => setIsPropertyModalOpen(true)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm flex items-center gap-2 border border-slate-700 transition-colors"><Plus size={16} /> Obiekt</button>
            <button onClick={() => setIsStatusModalOpen(true)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm flex items-center gap-2 border border-slate-700 transition-colors"><Settings size={16} /> Statusy</button>
            <button onClick={() => setIsTaskModalOpen(true)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm flex items-center gap-2 transition-all"><Plus size={16} /> Kolumna</button>
        </div>
      </div>

      {/* TABLE */}
      <div className="flex-1 overflow-auto bg-surface rounded-xl border border-border shadow-2xl custom-scrollbar relative">
        <table className="w-max border-separate border-spacing-0">
          <thead className="sticky top-0 z-30">
            <tr>
              <th className="p-4 bg-slate-900 text-slate-400 font-bold text-xs uppercase border-b border-r border-border sticky left-0 z-40 w-64 shadow-[2px_0_5px_rgba(0,0,0,0.3)]">Obiekt</th>
              {sortedTasks.map(task => (
                <th 
                  key={task.id} 
                  onDragOver={(e) => { e.preventDefault(); if(dragType === 'task') setDropTargetId(task.id); }}
                  onDragLeave={() => setDropTargetId(null)}
                  onDrop={(e) => handleDrop(e, task.id)}
                  className={`p-3 bg-slate-900 border-b border-border border-r border-slate-800 w-[250px] group transition-all ${!task.is_active ? 'opacity-40 grayscale' : ''} ${dropTargetId === task.id && dragType === 'task' ? 'border-l-4 border-indigo-500 bg-indigo-500/10' : ''}`}
                >
                   <div className="flex justify-between items-center text-white text-sm">
                       <div className="flex items-center gap-2 truncate">
                           <div 
                             draggable 
                             onDragStart={() => { setDraggedId(task.id); setDragType('task'); }}
                             className="cursor-grab active:cursor-grabbing p-1 hover:bg-slate-700 rounded transition-colors"
                           >
                               <GripVertical size={14} className="text-slate-500" />
                           </div>
                           <span className="truncate font-bold">{task.title}</span>
                       </div>
                       <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                           <button onClick={() => handleToggleTaskActive(task.id, task.is_active)} title="Ukryj" className="p-1 hover:text-indigo-400">{task.is_active ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                           <button onClick={async () => { if(confirm("Usunąć kolumnę?")) { await supabase.from('workflow_tasks').delete().eq('id', task.id); fetchTasks(); }}} title="Usuń" className="p-1 hover:text-red-400"><Trash2 size={14} /></button>
                       </div>
                   </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredProperties.map(property => {
              const rowIsActive = property.workflow_is_active !== false;
              const isTarget = dropTargetId === property.id && dragType === 'property';
              const isSource = draggedId === property.id && dragType === 'property';

              return (
                <tr 
                  key={property.id} 
                  onDragOver={(e) => { e.preventDefault(); if(dragType === 'property') setDropTargetId(property.id); }}
                  onDragLeave={() => setDropTargetId(null)}
                  onDrop={(e) => handleDrop(e, property.id)}
                  className={`hover:bg-slate-800/30 transition-all ${!rowIsActive ? 'opacity-30 grayscale bg-slate-900/50' : ''} ${isTarget ? 'border-t-4 border-indigo-500 bg-indigo-900/10 shadow-[0_-5px_15px_-5px_rgba(79,70,229,0.5)]' : ''} ${isSource ? 'opacity-20 pointer-events-none' : ''}`}
                >
                  <td className={`p-4 bg-surface sticky left-0 z-20 border-r border-border border-b border-border h-[80px] group shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]`}>
                    <div className="flex justify-between items-center gap-2">
                        <div className="flex items-center gap-3 flex-grow truncate">
                            <div 
                              draggable 
                              onDragStart={() => { setDraggedId(property.id); setDragType('property'); }}
                              className="cursor-grab active:cursor-grabbing p-1 hover:bg-slate-700 rounded transition-colors"
                            >
                                <GripVertical size={16} className="text-slate-600" />
                            </div>
                            <div className="truncate font-medium text-white text-sm">{property.name}</div>
                        </div>
                        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleTogglePropertyActive(property.id, rowIsActive)} className="text-slate-500 hover:text-indigo-400 p-1"><Eye size={14}/></button>
                        </div>
                    </div>
                  </td>
                  {sortedTasks.map(task => {
                    const entry = getEntry(property.id, task.id);
                    const status = entry ? getStatus(entry.status_id) : null;
                    const hasComment = entry?.comment && entry.comment.trim().length > 0;
                    return (
                      <td key={task.id} className="p-1 border-r border-b border-slate-800 cursor-pointer align-middle h-[80px] w-[250px]" onClick={() => openCellModal(property.id, task.id)}>
                        <div className={`w-full h-full rounded flex flex-col justify-center px-4 py-2 transition-all border-2 ${status ? status.color + ' border-transparent shadow-lg shadow-black/40' : 'bg-transparent border-transparent hover:border-slate-700 hover:bg-slate-800'} ${status ? 'text-white font-bold' : 'text-slate-500'}`}>
                           <div className="flex items-center justify-between gap-2">
                               <span className="text-sm truncate">{status ? status.label : ''}</span>
                               {hasComment && <MessageSquare size={14} className={status ? 'text-white/80' : 'text-indigo-400'} />}
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

      {/* MODALS */}
      {isCellModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-5">
             <div className="flex justify-between items-start">
                <h3 className="font-bold text-white text-lg">Edycja komórki</h3>
                <button onClick={() => setIsCellModalOpen(false)} className="text-slate-500 hover:text-white transition-colors"><X size={20}/></button>
             </div>
             <div className="space-y-3">
                 <label className="block text-xs font-bold text-slate-400 uppercase">Wybierz status:</label>
                 <div className="grid grid-cols-1 gap-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                     <button onClick={() => setCellForm({...cellForm, statusId: ''})} className={`p-3 rounded-lg border text-sm text-left transition-all ${cellForm.statusId === '' ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-slate-700 text-slate-500 hover:bg-slate-800'}`}>Brak statusu / Wyczyść</button>
                     {statuses.map(s => (
                         <button key={s.id} onClick={() => setCellForm({...cellForm, statusId: s.id})} className={`p-3 rounded-lg border text-sm text-left flex items-center gap-3 transition-all ${cellForm.statusId === s.id ? 'border-white bg-slate-800 text-white shadow-lg ring-1 ring-indigo-500' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
                            <div className={`w-3 h-3 rounded-full ${s.color}`}></div> {s.label}
                         </button>
                     ))}
                 </div>
             </div>
             <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-400 uppercase">Notatki:</label>
                <textarea rows={4} value={cellForm.comment} onChange={e => setCellForm({...cellForm, comment: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
             </div>
             <button onClick={saveCell} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center justify-center gap-2 font-bold shadow-lg transition-all active:scale-95"><Save size={18}/> Zapisz</button>
          </div>
        </div>
      )}

      {isPropertyModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-4">
             <h3 className="font-bold text-white text-lg">Dodaj obiekt</h3>
             <input autoFocus value={newPropertyName} onChange={e => setNewPropertyName(e.target.value)} placeholder="Nazwa obiektu" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" />
             <div className="flex justify-end gap-2">
                 <button onClick={() => setIsPropertyModalOpen(false)} className="px-4 py-2 text-slate-400">Anuluj</button>
                 <button onClick={handleAddPropertyLocal} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold">Dodaj</button>
             </div>
          </div>
        </div>
      )}

      {isTaskModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-4">
             <h3 className="font-bold text-white text-lg">Nowa Kolumna</h3>
             <input autoFocus value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Nazwa kolumny" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" />
             <div className="flex justify-end gap-2">
                 <button onClick={() => setIsTaskModalOpen(false)} className="px-4 py-2 text-slate-400">Anuluj</button>
                 <button onClick={handleAddTask} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold">Utwórz</button>
             </div>
          </div>
        </div>
      )}

      {isStatusModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-lg rounded-xl border border-border shadow-2xl overflow-hidden">
             <div className="p-4 border-b border-border flex justify-between items-center bg-slate-900/50">
                <h3 className="font-bold text-white">Zarządzaj Statusami</h3>
                <button onClick={() => setIsStatusModalOpen(false)}><X className="text-slate-400 hover:text-white" /></button>
             </div>
             <div className="p-6 space-y-6">
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {statuses.map(s => (
                        <div key={s.id} className="flex items-center justify-between bg-slate-900 p-2 rounded border border-border group">
                            <div className="flex items-center gap-3"><div className={`w-4 h-4 rounded-full ${s.color}`}></div><span className="text-white text-sm">{s.label}</span></div>
                            <button onClick={async () => { if(confirm("Usunąć status?")) { await supabase.from('workflow_statuses').delete().eq('id', s.id); fetchStatuses(); }}} className="text-slate-500 hover:text-red-400"><Trash2 size={16}/></button>
                        </div>
                    ))}
                </div>
                <div className="border-t border-border pt-4 space-y-3">
                    <p className="text-xs font-bold text-slate-400 uppercase">Nowy status</p>
                    <div className="flex gap-2">
                         <input value={newStatus.label} onChange={e => setNewStatus({...newStatus, label: e.target.value})} placeholder="Nazwa" className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm outline-none focus:ring-1 focus:ring-indigo-500" />
                         <button onClick={handleAddStatus} className="px-3 bg-indigo-600 text-white rounded-lg text-sm"><Plus /></button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {COLORS.map(c => ( <button key={c.class} onClick={() => setNewStatus({...newStatus, color: c.class})} className={`w-6 h-6 rounded-full ${c.class} transition-all hover:scale-110 ${newStatus.color === c.class ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800' : ''}`} /> ))}
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};
