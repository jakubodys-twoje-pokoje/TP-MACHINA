import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { useProperties } from '../contexts/PropertyContext';
import { WorkflowTask, WorkflowStatus, WorkflowEntry, Property } from '../types';
import { 
  Plus, X, Loader2, Save, Trash2, Settings, MessageSquare, 
  Search, Eye, EyeOff, User, Clock, GripVertical 
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
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [draggedPropId, setDraggedPropId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const tasksRef = useRef<WorkflowTask[]>([]);
  const propsRef = useRef<Property[]>([]);
  const isLocked = useRef<boolean>(false);
  const cooldownTimer = useRef<number | null>(null);

  // Synchronizacja stanu lokalnego z globalnym, jeśli nie trwa przeciąganie
  useEffect(() => {
    if (!isDragging && !isLocked.current) {
        setLocalProperties([...properties]);
        propsRef.current = [...properties];
    }
  }, [properties, isDragging]);

  const fetchTasks = useCallback(async () => {
      if (isLocked.current) return;
      const { data } = await supabase.from('workflow_tasks').select('*').order('position', { ascending: true });
      if (data) {
          setTasks(data);
          tasksRef.current = data;
      }
  }, []);

  const fetchStatuses = useCallback(async () => {
      const { data } = await supabase.from('workflow_statuses').select('*').order('created_at', { ascending: true });
      if (data) setStatuses(data);
  }, []);

  const handleEntryRealtime = useCallback((payload: any) => {
      if (payload.eventType === 'INSERT') {
          setEntries(prev => [...prev, payload.new]);
      } else if (payload.eventType === 'UPDATE') {
          setEntries(prev => prev.map(e => e.id === payload.new.id ? payload.new : e));
      } else if (payload.eventType === 'DELETE') {
          setEntries(prev => prev.filter(e => e.id !== payload.old.id));
      }
  }, []);

  useEffect(() => {
    fetchWorkflowData();
    const channel = supabase.channel('workflow-v14-rls-fix')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_tasks' }, () => { if (!isLocked.current) fetchTasks(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_statuses' }, () => fetchStatuses())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_entries' }, (p) => handleEntryRealtime(p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, () => { if (!isLocked.current) fetchProperties(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchTasks, fetchStatuses, handleEntryRealtime, fetchProperties]);

  const fetchWorkflowData = async () => {
    setLoading(true);
    try {
      const [tRes, sRes, eRes] = await Promise.all([
        supabase.from('workflow_tasks').select('*').order('position', { ascending: true }),
        supabase.from('workflow_statuses').select('*').order('created_at', { ascending: true }),
        supabase.from('workflow_entries').select('*')
      ]);
      setTasks(tRes.data || []);
      tasksRef.current = tRes.data || [];
      setStatuses(sRes.data || []);
      setEntries(eRes.data || []);
      setLocalProperties([...properties]);
      propsRef.current = [...properties];
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const lockSync = () => {
      isLocked.current = true;
      if (cooldownTimer.current) window.clearTimeout(cooldownTimer.current);
  };

  const releaseSync = () => {
      cooldownTimer.current = window.setTimeout(() => {
          isLocked.current = false;
          setIsSavingOrder(false);
      }, 3000); 
  };

  // --- KOLUMNY ---
  const onTaskDragStart = (id: string) => { setIsDragging(true); setDraggedTaskId(id); lockSync(); };
  
  const onTaskDragEnter = (targetId: string) => {
    if (!draggedTaskId || draggedTaskId === targetId) return;
    setTasks(prev => {
        const dIdx = prev.findIndex(t => t.id === draggedTaskId);
        const tIdx = prev.findIndex(t => t.id === targetId);
        if (dIdx === -1 || tIdx === -1) return prev;
        const updated = [...prev];
        const [moved] = updated.splice(dIdx, 1);
        updated.splice(tIdx, 0, moved);
        tasksRef.current = updated;
        return updated;
    });
  };

  const handleSaveColumnOrder = async (e?: React.DragEvent) => {
    if (e) e.preventDefault();
    if (!draggedTaskId) return;
    setIsSavingOrder(true);
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // GWARANCJA RLS: Wysyłamy TYLKO niezbędne pola
        const payload = tasksRef.current.map((t, i) => ({ 
            id: t.id,
            user_id: user.id,
            position: i 
        }));

        const { error } = await supabase
            .from('workflow_tasks')
            .upsert(payload, { onConflict: 'id' });

        if (error) throw error;
        await fetchTasks();
    } catch (e: any) { 
        console.error("Column RLS Error:", e);
        alert("Błąd zapisu kolumn (RLS): " + e.message);
        fetchTasks(); 
    } finally { 
        setDraggedTaskId(null); 
        setIsDragging(false); 
        releaseSync(); 
    }
  };

  // --- RZĘDY ---
  const onPropDragStart = (id: string) => { 
    setIsDragging(true); 
    setDraggedPropId(id); 
    lockSync(); 
  };

  const onPropDragEnter = (targetId: string) => {
    if (!draggedPropId || draggedPropId === targetId) return;
    setLocalProperties(prev => {
        const list = [...prev];
        const dIdx = list.findIndex(p => p.id === draggedPropId);
        const tIdx = list.findIndex(p => p.id === targetId);
        if (dIdx === -1 || tIdx === -1) return prev;
        const [moved] = list.splice(dIdx, 1);
        list.splice(tIdx, 0, moved);
        propsRef.current = list;
        return list;
    });
  };

  const handleSaveRowOrder = async (e?: React.DragEvent) => {
    if (e) e.preventDefault();
    if (!draggedPropId) return;
    setIsSavingOrder(true);
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // GWARANCJA RLS: Wysyłamy TYLKO niezbędne pola
        const payload = propsRef.current.map((p, i) => ({
            id: p.id,
            user_id: user.id,
            workflow_position: i
        }));

        const { error } = await supabase
            .from('properties')
            .upsert(payload, { onConflict: 'id' });

        if (error) throw error;
        await fetchProperties();
    } catch (e: any) {
        console.error("Row RLS Error:", e);
        alert("Błąd zapisu rzędów (RLS): " + e.message);
        fetchProperties();
    } finally {
        setDraggedPropId(null);
        setIsDragging(false);
        releaseSync();
    }
  };

  // --- WIDOK ---
  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => a.position - b.position), [tasks]);
  
  const filteredProperties = useMemo(() => {
    // Podczas przeciągania WYŁĄCZAMY sortowanie bazodanowe, 
    // polegamy na kolejności w tablicy localProperties uzyskanej przez splice
    let list = [...localProperties];
    
    if (!isDragging) {
        list.sort((a, b) => {
            const activeA = a.workflow_is_active === false ? 0 : 1;
            const activeB = b.workflow_is_active === false ? 0 : 1;
            if (activeA !== activeB) return activeB - activeA;
            return (a.workflow_position || 0) - (b.workflow_position || 0);
        });
    }

    if (searchQuery) {
        list = list.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    
    return list;
  }, [localProperties, searchQuery, isDragging]);

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
      await supabase.from('properties').insert({ user_id: user.id, name: newPropertyName, workflow_position: maxPos + 1, workflow_is_active: true });
      setNewPropertyName(''); setIsPropertyModalOpen(false); fetchProperties();
  };

  const handleDeleteTask = async (id: string) => {
    if (!confirm("Trwale usunąć tę kolumnę danych?")) return;
    await supabase.from('workflow_tasks').delete().eq('id', id); fetchTasks();
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

  const handleDeleteStatus = async (id: string) => {
    if (!confirm("Czy na pewno chcesz usunąć ten status?")) return;
    await supabase.from('workflow_statuses').delete().eq('id', id);
    fetchStatuses();
  };

  const saveCell = async () => {
    if (!selectedCell) return;
    const { data: { user } } = await supabase.auth.getUser();
    const existing = entries.find(e => e.property_id === selectedCell.propId && e.task_id === selectedCell.taskId);
    const payload = { status_id: cellForm.statusId || null, comment: cellForm.comment, last_updated_by_email: user?.email || 'System', updated_at: new Date().toISOString() };
    if (existing) { await supabase.from('workflow_entries').update(payload).eq('id', existing.id); } 
    else { await supabase.from('workflow_entries').insert({ ...payload, property_id: selectedCell.propId, task_id: selectedCell.taskId }); }
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
                  <Loader2 size={14} className="animate-spin" /> SYNCHRONIZACJA KOLEJNOŚCI...
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
            <tr onDrop={handleSaveColumnOrder} onDragOver={(e) => e.preventDefault()}>
              <th className="p-4 bg-slate-900 text-slate-400 font-bold text-xs uppercase border-b border-r border-border sticky left-0 z-40 w-64 shadow-[2px_0_5px_rgba(0,0,0,0.3)]">Obiekt</th>
              {sortedTasks.map(task => (
                <th 
                  key={task.id} 
                  draggable
                  onDragStart={() => onTaskDragStart(task.id)}
                  onDragEnter={() => onTaskDragEnter(task.id)}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDragEnd={() => { setDraggedTaskId(null); setIsDragging(false); if(!isSavingOrder) isLocked.current = false; }}
                  className={`p-3 bg-slate-900 border-b border-border border-r border-slate-800 w-[250px] group transition-all cursor-grab active:cursor-grabbing ${!task.is_active ? 'opacity-40 grayscale' : ''} ${draggedTaskId === task.id ? 'bg-indigo-900/60 border-indigo-400 ring-2 ring-indigo-500 z-50 scale-[1.02]' : ''}`}
                >
                   <div className="flex flex-col gap-2 pointer-events-none">
                       <div className="flex justify-between items-center text-white text-sm">
                           <div className="flex items-center gap-2 truncate">
                               <GripVertical size={14} className="text-slate-600 flex-shrink-0" />
                               <span className="truncate font-bold" title={task.title}>{task.title}</span>
                           </div>
                           <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
                               <button onClick={(e) => { e.stopPropagation(); handleToggleTaskActive(task.id, task.is_active); }} className="p-1 hover:text-indigo-400 transition-colors">
                                   {task.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
                               </button>
                               <button onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }} className="p-1 hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
                           </div>
                       </div>
                   </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredProperties.map(property => {
              const rowIsActive = property.workflow_is_active !== false;
              return (
                <tr 
                  key={property.id} 
                  draggable
                  onDragStart={() => onPropDragStart(property.id)}
                  onDragEnter={() => onPropDragEnter(property.id)}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDragEnd={() => { setDraggedPropId(null); setIsDragging(false); if(!isSavingOrder) isLocked.current = false; }}
                  onDrop={(e) => { e.preventDefault(); handleSaveRowOrder(e); }}
                  className={`hover:bg-slate-800/30 transition-colors cursor-grab active:cursor-grabbing ${!rowIsActive ? 'opacity-40 bg-slate-900/50' : ''} ${draggedPropId === property.id ? 'bg-indigo-900/40 ring-2 ring-indigo-500 z-10 relative' : ''}`}
                >
                  <td 
                    className={`p-4 bg-surface sticky left-0 z-20 border-r border-border border-b border-border h-[80px] group shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)] transition-colors ${draggedPropId === property.id ? 'bg-indigo-900/40' : ''}`}
                  >
                    <div className="flex justify-between items-center gap-2 pointer-events-none">
                        <div className="flex items-center gap-3 flex-grow truncate">
                            <GripVertical size={16} className="text-slate-600 flex-shrink-0" />
                            <div className="truncate font-medium text-white text-sm" title={property.name}>{property.name}</div>
                        </div>
                        <div className="flex flex-col gap-0.5 pointer-events-auto">
                            <button onClick={(e) => { e.stopPropagation(); handleTogglePropertyActive(property.id, rowIsActive); }} className="text-slate-500 hover:text-indigo-400" title="Aktywuj/Dezaktywuj"><Eye size={12}/></button>
                        </div>
                    </div>
                  </td>
                  {sortedTasks.map(task => {
                    const entry = getEntry(property.id, task.id);
                    const status = entry ? getStatus(entry.status_id) : null;
                    const hasComment = entry?.comment && entry.comment.trim().length > 0;
                    return (
                      <td key={task.id} className="p-1 border-r border-b border-slate-800 cursor-pointer align-middle h-[80px] w-[250px]" onClick={() => openCellModal(property.id, task.id)}>
                        <div className={`w-full h-full rounded flex flex-col justify-center px-4 py-2 transition-all border-2 ${status ? status.color + ' border-transparent shadow-lg' : 'bg-transparent border-transparent hover:border-slate-700 hover:bg-slate-800'} ${status ? 'text-white' : 'text-slate-500'}`}>
                           <div className="flex items-center justify-between gap-2">
                               <span className="text-sm font-bold truncate">{status ? status.label : ''}</span>
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
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-5 animate-in zoom-in-95">
             <div className="flex justify-between items-start">
                <h3 className="font-bold text-white text-lg">Edycja komórki</h3>
                <button onClick={() => setIsCellModalOpen(false)} className="text-slate-500 hover:text-white transition-colors"><X size={20}/></button>
             </div>
             <div>
                 <label className="block text-xs font-bold text-slate-400 uppercase mb-3">Status:</label>
                 <div className="grid grid-cols-1 gap-2 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
                     <button onClick={() => setCellForm({...cellForm, statusId: ''})} className={`p-2.5 rounded-lg border text-sm text-left ${cellForm.statusId === '' ? 'border-indigo-500 bg-indigo-500/10 text-white shadow-lg' : 'border-slate-700 text-slate-500 hover:bg-slate-800'}`}>Wyczyść</button>
                     {statuses.map(s => (
                         <button key={s.id} onClick={() => setCellForm({...cellForm, statusId: s.id})} className={`p-2.5 rounded-lg border text-sm text-left flex items-center gap-3 transition-all ${cellForm.statusId === s.id ? 'border-white bg-slate-800 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
                            <div className={`w-3 h-3 rounded-full ${s.color}`}></div> {s.label}
                         </button>
                     ))}
                 </div>
             </div>
             <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Notatki:</label>
                <textarea rows={4} value={cellForm.comment} onChange={e => setCellForm({...cellForm, comment: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none transition-all" placeholder="Wpisz uwagi..." />
             </div>
             <div className="flex justify-end gap-2 pt-2">
                 <button onClick={saveCell} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center justify-center gap-2 font-bold shadow-lg transition-all active:scale-95"><Save size={18}/> Zapisz</button>
             </div>
          </div>
        </div>
      )}

      {isPropertyModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-4">
             <h3 className="font-bold text-white text-lg">Dodaj obiekt</h3>
             <input autoFocus value={newPropertyName} onChange={e => setNewPropertyName(e.target.value)} placeholder="Nazwa obiektu" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={e => e.key === 'Enter' && handleAddPropertyLocal()} />
             <div className="flex justify-end gap-2">
                 <button onClick={() => setIsPropertyModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white">Anuluj</button>
                 <button onClick={handleAddPropertyLocal} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold">Dodaj</button>
             </div>
          </div>
        </div>
      )}

      {isTaskModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-4">
             <h3 className="font-bold text-white text-lg">Nowa Kolumna</h3>
             <input autoFocus value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Nazwa kolumny" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={e => e.key === 'Enter' && handleAddTask()} />
             <div className="flex justify-end gap-2">
                 <button onClick={() => setIsTaskModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white">Anuluj</button>
                 <button onClick={handleAddTask} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold">Utwórz</button>
             </div>
          </div>
        </div>
      )}

      {isStatusModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-lg rounded-xl border border-border shadow-2xl overflow-hidden animate-in zoom-in-95">
             <div className="p-4 border-b border-border flex justify-between items-center bg-slate-900/50">
                <h3 className="font-bold text-white">Zarządzaj Statusami</h3>
                <button onClick={() => setIsStatusModalOpen(false)}><X className="text-slate-400 hover:text-white" /></button>
             </div>
             <div className="p-6 space-y-6">
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {statuses.map(s => (
                        <div key={s.id} className="flex items-center justify-between bg-slate-900 p-2 rounded border border-border group transition-colors hover:border-slate-500">
                            <div className="flex items-center gap-3"><div className={`w-4 h-4 rounded-full ${s.color}`}></div><span className="text-white text-sm">{s.label}</span></div>
                            <button onClick={() => handleDeleteStatus(s.id)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={16}/></button>
                        </div>
                    ))}
                </div>
                <div className="border-t border-border pt-4 space-y-3">
                    <p className="text-xs font-bold text-slate-400 uppercase">Nowy status</p>
                    <div className="flex gap-2">
                         <input value={newStatus.label} onChange={e => setNewStatus({...newStatus, label: e.target.value})} placeholder="Nazwa" className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm outline-none focus:ring-1 focus:ring-indigo-500" />
                         <button onClick={handleAddStatus} className="px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm transition-colors"><Plus /></button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {COLORS.map(c => ( <button key={c.class} onClick={() => setNewStatus({...newStatus, color: c.class})} className={`w-6 h-6 rounded-full ${c.class} transition-transform hover:scale-110 ${newStatus.color === c.class ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800 shadow-lg' : ''}`} /> ))}
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};