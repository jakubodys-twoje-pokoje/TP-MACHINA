import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  { label: 'Żółty', class: 'bg-yellow-500 text-black' },
  { label: 'Zielony', class: 'bg-green-600' },
  { label: 'Niebieski', class: 'bg-blue-600' },
  { label: 'Indygo', class: 'bg-indigo-600' },
  { label: 'Fioletowy', class: 'bg-purple-600' },
  { label: 'Różowy', class: 'bg-pink-600' },
];

export const WorkflowView: React.FC = () => {
  const { properties, fetchProperties } = useProperties();
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);
  const [entries, setEntries] = useState<WorkflowEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Ref for persistence logic
  const tasksRef = useRef<WorkflowTask[]>([]);
  const isSavingRef = useRef(false);
  
  // Sync tasksRef with tasks state
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  // Sync isSavingRef with isSavingOrder state
  useEffect(() => { isSavingRef.current = isSavingOrder; }, [isSavingOrder]);

  const [localProperties, setLocalProperties] = useState<Property[]>([]);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [draggedPropId, setDraggedPropId] = useState<string | null>(null);

  // Modals
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isCellModalOpen, setIsCellModalOpen] = useState(false);
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);

  // Forms
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newStatus, setNewStatus] = useState({ label: '', color: 'bg-slate-600' });
  const [selectedCell, setSelectedCell] = useState<{ propId: string, taskId: string } | null>(null);
  const [cellForm, setCellForm] = useState({ statusId: '', comment: '' });

  useEffect(() => {
    fetchWorkflowData();

    // Stable realtime channel - no dependency on isSavingOrder to prevent flickering
    const channel = supabase.channel('workflow-realtime-v7')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_tasks' }, () => {
          if (!isSavingRef.current) fetchTasks();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_statuses' }, () => fetchStatuses())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_entries' }, (p) => handleEntryRealtime(p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, () => {
          if (!isSavingRef.current) fetchProperties();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []); // Run only once

  useEffect(() => {
    if (!draggedPropId) {
        setLocalProperties([...properties]);
    }
  }, [properties, draggedPropId]);

  const fetchTasks = async () => {
      const { data } = await supabase.from('workflow_tasks').select('*').order('position', { ascending: true });
      if (data) setTasks(data);
  }

  const fetchStatuses = async () => {
      const { data } = await supabase.from('workflow_statuses').select('*').order('created_at', { ascending: true });
      if (data) setStatuses(data);
  }

  const handleEntryRealtime = (payload: any) => {
      if (payload.eventType === 'INSERT') {
          setEntries(prev => [...prev, payload.new]);
      } else if (payload.eventType === 'UPDATE') {
          setEntries(prev => prev.map(e => e.id === payload.new.id ? payload.new : e));
      } else if (payload.eventType === 'DELETE') {
          setEntries(prev => prev.filter(e => e.id !== payload.old.id));
      }
  }

  const fetchWorkflowData = async () => {
    setLoading(true);
    try {
      const [tRes, sRes, eRes] = await Promise.all([
        supabase.from('workflow_tasks').select('*').order('position', { ascending: true }),
        supabase.from('workflow_statuses').select('*').order('created_at', { ascending: true }),
        supabase.from('workflow_entries').select('*')
      ]);
      setTasks(tRes.data || []);
      setStatuses(sRes.data || []);
      setEntries(eRes.data || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const sortedProperties = useMemo(() => {
    const list = localProperties.length > 0 ? localProperties : properties;
    return [...list].sort((a, b) => {
        const activeA = a.workflow_is_active === false ? 0 : 1;
        const activeB = b.workflow_is_active === false ? 0 : 1;
        if (activeA !== activeB) return activeB - activeA;
        if ((a.workflow_position || 0) !== (b.workflow_position || 0)) {
            return (a.workflow_position || 0) - (b.workflow_position || 0);
        }
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [properties, localProperties]);

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [tasks]);

  const filteredProperties = useMemo(() => {
    return sortedProperties.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [sortedProperties, searchQuery]);

  // --- DRAG AND DROP TASKS ---
  const onTaskDragStart = (id: string) => setDraggedTaskId(id);
  
  const onTaskDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedTaskId || draggedTaskId === targetId) return;
    
    const currentTasks = [...tasks];
    const draggedIdx = currentTasks.findIndex(t => t.id === draggedTaskId);
    const targetIdx = currentTasks.findIndex(t => t.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const [removed] = currentTasks.splice(draggedIdx, 1);
    currentTasks.splice(targetIdx, 0, removed);
    
    // Update locally for smooth UI
    setTasks(currentTasks.map((t, i) => ({ ...t, position: i })));
  };

  const onTaskDrop = async () => {
    if (!draggedTaskId) return;
    setIsSavingOrder(true);
    try {
        // Use the current state captured in the ref
        const finalTasks = tasksRef.current.map((t, i) => ({
            ...t,
            position: i
        }));
        
        // Single batch upsert
        const { error } = await supabase
            .from('workflow_tasks')
            .upsert(finalTasks, { onConflict: 'id' });
            
        if (error) throw error;
        console.log("Kolejność kolumn zapisana pomyślnie.");
    } catch (e) {
        console.error("Column save failed:", e);
        fetchTasks(); // Restore from server on error
    } finally {
        setDraggedTaskId(null);
        setIsSavingOrder(false);
    }
  };

  // --- DRAG AND DROP PROPERTIES ---
  const onPropDragStart = (id: string) => setDraggedPropId(id);

  const onPropDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedPropId || draggedPropId === targetId) return;

    const list = [...localProperties];
    const draggedIdx = list.findIndex(p => p.id === draggedPropId);
    const targetIdx = list.findIndex(p => p.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const [removed] = list.splice(draggedIdx, 1);
    list.splice(targetIdx, 0, removed);
    
    setLocalProperties(list.map((p, i) => ({ ...p, workflow_position: i })));
  };

  const onPropDrop = async () => {
    if (!draggedPropId) return;
    setIsSavingOrder(true);
    try {
        const finalProps = localProperties.map((p, i) => ({
            ...p,
            workflow_position: i
        }));
        
        const { error } = await supabase
            .from('properties')
            .upsert(finalProps, { onConflict: 'id' });
            
        if (error) throw error;
    } catch (e) {
        console.error("Row save failed:", e);
    } finally {
        setDraggedPropId(null);
        setIsSavingOrder(false);
        fetchProperties();
    }
  };

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
    await supabase.from('workflow_tasks').insert({ 
        title: newTaskTitle, 
        user_id: user.id, 
        position: maxPos + 1,
        is_active: true
    });
    setNewTaskTitle(''); setIsTaskModalOpen(false);
    fetchTasks();
  };

  const handleAddPropertyLocal = async () => {
      if (!newPropertyName.trim()) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const maxPos = properties.length > 0 ? Math.max(...properties.map(p => p.workflow_position || 0)) : 0;
      
      await supabase.from('properties').insert({
          user_id: user.id,
          name: newPropertyName,
          description: 'Dodane z Workflow',
          workflow_position: maxPos + 1,
          workflow_is_active: true
      });
      
      setNewPropertyName('');
      setIsPropertyModalOpen(false);
      fetchProperties();
  };

  const handleDeleteTask = async (id: string) => {
    if (!confirm("Trwale usunąć tę kolumnę danych?")) return;
    await supabase.from('workflow_tasks').delete().eq('id', id);
    fetchTasks();
  };

  const handleDeleteStatus = async (id: string) => {
    if (!confirm("Czy na pewno chcesz usunąć ten status?")) return;
    await supabase.from('workflow_statuses').delete().eq('id', id);
    fetchStatuses();
  };

  const handleAddStatus = async () => {
    if (!newStatus.label.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('workflow_statuses').insert({
      label: newStatus.label,
      color: newStatus.color,
      user_id: user.id
    });
    setNewStatus({ label: '', color: 'bg-slate-600' });
    fetchStatuses();
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
      await supabase.from('workflow_entries').insert({
        ...payload,
        property_id: selectedCell.propId,
        task_id: selectedCell.taskId,
      });
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
              <div className="flex items-center gap-2 text-green-400 text-xs font-bold animate-pulse">
                  <Loader2 size={14} className="animate-spin" /> Zapis trwały...
              </div>
          )}
        </div>
        <div className="flex gap-2">
            <button onClick={() => setIsPropertyModalOpen(true)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm flex items-center gap-2 border border-slate-700 transition-colors"><Plus size={16} /> Dodaj Obiekt</button>
            <button onClick={() => setIsStatusModalOpen(true)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm flex items-center gap-2 border border-slate-700 transition-colors"><Settings size={16} /> Statusy</button>
            <button onClick={() => setIsTaskModalOpen(true)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm flex items-center gap-2 transition-all"><Plus size={16} /> Nowa Kolumna</button>
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
                  draggable
                  onDragStart={() => onTaskDragStart(task.id)}
                  onDragOver={(e) => onTaskDragOver(e, task.id)}
                  onDrop={onTaskDrop}
                  onDragEnd={() => setDraggedTaskId(null)}
                  className={`p-3 bg-slate-900 border-b border-border border-r border-slate-800 w-[250px] group transition-all cursor-grab active:cursor-grabbing ${!task.is_active ? 'opacity-40 grayscale' : ''} ${draggedTaskId === task.id ? 'bg-indigo-900/60 border-indigo-400' : ''}`}
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
                       <div className="text-[9px] uppercase font-bold text-slate-600 tracking-widest text-center">Zmień kolejność</div>
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
                  onDragOver={(e) => onPropDragOver(e, property.id)}
                  onDrop={onPropDrop}
                  className={`hover:bg-slate-800/30 transition-colors ${!rowIsActive ? 'opacity-40 bg-slate-900/50' : ''} ${draggedPropId === property.id ? 'bg-indigo-900/20' : ''}`}
                >
                  <td 
                    className={`p-4 bg-surface sticky left-0 z-20 border-r border-border border-b border-border h-[80px] group shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)] transition-colors ${draggedPropId === property.id ? 'bg-indigo-900/40' : ''}`}
                  >
                    <div className="flex justify-between items-center gap-2">
                        <div 
                          draggable 
                          onDragStart={() => onPropDragStart(property.id)}
                          onDragEnd={() => setDraggedPropId(null)}
                          className="flex items-center gap-3 cursor-grab active:cursor-grabbing flex-grow truncate"
                        >
                            <GripVertical size={16} className="text-slate-600 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="truncate font-medium text-white text-sm" title={property.name}>{property.name}</div>
                        </div>
                        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleTogglePropertyActive(property.id, rowIsActive)} className="text-slate-500 hover:text-indigo-400" title="Aktywuj/Dezaktywuj"><Eye size={12}/></button>
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
                           {!status && !hasComment && <span className="text-[10px] uppercase font-black opacity-0 hover:opacity-10 transition-opacity text-center">Edytuj</span>}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-5 animate-in zoom-in-95">
             <div className="flex justify-between items-start">
                <h3 className="font-bold text-white text-lg">Edycja komórki</h3>
                <button onClick={() => setIsCellModalOpen(false)} className="text-slate-500 hover:text-white transition-colors"><X size={20}/></button>
             </div>

             {selectedCell && (
                 <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                        <Clock size={12} /> Ostatnia zmiana
                    </div>
                    {getEntry(selectedCell.propId, selectedCell.taskId) ? (
                        <div className="text-xs text-slate-300">
                            <div className="flex items-center gap-1.5 truncate"><User size={12} className="text-indigo-400 flex-shrink-0" /> {getEntry(selectedCell.propId, selectedCell.taskId)?.last_updated_by_email || 'Nieznany'}</div>
                            <div className="mt-1 text-slate-500 pl-4">{new Date(getEntry(selectedCell.propId, selectedCell.taskId)!.updated_at).toLocaleString()}</div>
                        </div>
                    ) : (
                        <div className="text-xs text-slate-600 italic">Brak wcześniejszych wpisów</div>
                    )}
                 </div>
             )}

             <div>
                 <label className="block text-xs font-bold text-slate-400 uppercase mb-3">Wybierz status:</label>
                 <div className="grid grid-cols-1 gap-2 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
                     <button onClick={() => setCellForm({...cellForm, statusId: ''})} className={`p-2.5 rounded-lg border text-sm text-left ${cellForm.statusId === '' ? 'border-indigo-500 bg-indigo-500/10 text-white shadow-lg' : 'border-slate-700 text-slate-500 hover:bg-slate-800'}`}>Brak statusu / Wyczyść</button>
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
                 <button onClick={saveCell} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center justify-center gap-2 font-bold shadow-lg transition-all active:scale-95"><Save size={18}/> Zapisz zmiany</button>
             </div>
          </div>
        </div>
      )}

      {isPropertyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-4">
             <h3 className="font-bold text-white text-lg">Dodaj nowy obiekt</h3>
             <input autoFocus value={newPropertyName} onChange={e => setNewPropertyName(e.target.value)} placeholder="Nazwa obiektu (np. Willa Widok)" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={e => e.key === 'Enter' && handleAddPropertyLocal()} />
             <div className="flex justify-end gap-2">
                 <button onClick={() => setIsPropertyModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white transition-colors">Anuluj</button>
                 <button onClick={handleAddPropertyLocal} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold transition-all active:scale-95">Dodaj Obiekt</button>
             </div>
          </div>
        </div>
      )}

      {isTaskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-4">
             <h3 className="font-bold text-white text-lg">Nowa Kolumna Zadań</h3>
             <input autoFocus value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="np. Sprzątanie końcowe" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" onKeyDown={e => e.key === 'Enter' && handleAddTask()} />
             <div className="flex justify-end gap-2">
                 <button onClick={() => setIsTaskModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white transition-colors">Anuluj</button>
                 <button onClick={handleAddTask} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold transition-all active:scale-95">Utwórz Kolumnę</button>
             </div>
          </div>
        </div>
      )}

      {isStatusModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-lg rounded-xl border border-border shadow-2xl overflow-hidden animate-in zoom-in-95">
             <div className="p-4 border-b border-border flex justify-between items-center bg-slate-900/50">
                <h3 className="font-bold text-white">Zarządzaj Statusami</h3>
                <button onClick={() => setIsStatusModalOpen(false)}><X className="text-slate-400 hover:text-white" /></button>
             </div>
             <div className="p-6 space-y-6">
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {statuses.map(s => (
                        <div key={s.id} className="flex items-center justify-between bg-slate-900 p-2 rounded border border-border group transition-colors hover:border-slate-500">
                            <div className="flex items-center gap-3">
                                <div className={`w-4 h-4 rounded-full ${s.color}`}></div>
                                <span className="text-white text-sm">{s.label}</span>
                            </div>
                            <button onClick={() => handleDeleteStatus(s.id)} className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={16}/></button>
                        </div>
                    ))}
                </div>
                <div className="border-t border-border pt-4 space-y-3">
                    <p className="text-xs font-bold text-slate-400 uppercase">Dodaj nowy status</p>
                    <div className="flex gap-2">
                         <input value={newStatus.label} onChange={e => setNewStatus({...newStatus, label: e.target.value})} placeholder="Nazwa statusu" className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm outline-none focus:ring-1 focus:ring-indigo-500" />
                         <button onClick={handleAddStatus} className="px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm transition-colors"><Plus /></button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {COLORS.map(c => (
                            <button key={c.class} onClick={() => setNewStatus({...newStatus, color: c.class})} className={`w-6 h-6 rounded-full ${c.class} transition-transform hover:scale-110 ${newStatus.color === c.class ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800 shadow-lg' : ''}`} />
                        ))}
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};