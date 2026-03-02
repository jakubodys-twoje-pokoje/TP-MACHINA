
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { useProperties } from '../contexts/PropertyContext';
import { WorkflowTask, WorkflowStatus, WorkflowEntry, WorkflowPerson, Property, WorkflowEntryHistory } from '../types';
import {
  Plus, X, Loader2, Save, Trash2, Settings, MessageSquare,
  Search, Eye, EyeOff, GripVertical, Move, History
} from 'lucide-react';

const COLORS = [
  { name: 'Gray', class: 'bg-slate-600' },
  { name: 'Red', class: 'bg-red-600' },
  { name: 'Orange', class: 'bg-orange-600' },
  { name: 'Amber', class: 'bg-amber-600' },
  { name: 'Yellow', class: 'bg-yellow-600' },
  { name: 'Lime', class: 'bg-lime-600' },
  { name: 'Green', class: 'bg-green-600' },
  { name: 'Emerald', class: 'bg-emerald-600' },
  { name: 'Teal', class: 'bg-teal-600' },
  { name: 'Cyan', class: 'bg-cyan-600' },
  { name: 'Sky', class: 'bg-sky-600' },
  { name: 'Blue', class: 'bg-blue-600' },
  { name: 'Indigo', class: 'bg-indigo-600' },
  { name: 'Violet', class: 'bg-violet-600' },
  { name: 'Purple', class: 'bg-purple-600' },
  { name: 'Fuchsia', class: 'bg-fuchsia-600' },
  { name: 'Pink', class: 'bg-pink-600' },
  { name: 'Rose', class: 'bg-rose-600' },
];

export const WorkflowView: React.FC = () => {
  const { properties, fetchProperties } = useProperties();
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);
  const [persons, setPersons] = useState<WorkflowPerson[]>([]);
  const [entries, setEntries] = useState<WorkflowEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<'task' | 'property' | null>(null);

  // Krytyczny ref do blokowania odświeżania podczas zapisu pozycji
  const isSavingRef = useRef(false);

  const fetchTasks = useCallback(async () => {
    const { data } = await supabase.from('workflow_tasks').select('*').order('position', { ascending: true });
    if (data) setTasks(data);
  }, []);

  const fetchStatuses = useCallback(async () => {
    const { data } = await supabase.from('workflow_statuses').select('*').order('created_at', { ascending: true });
    if (data) setStatuses(data);
  }, []);

  const fetchPersons = useCallback(async () => {
    const { data } = await supabase.from('workflow_persons').select('*').order('created_at', { ascending: true });
    if (data) setPersons(data);
  }, []);

  const fetchEntries = useCallback(async () => {
    const { data } = await supabase.from('workflow_entries').select('*');
    if (data) setEntries(data);
  }, []);

  // Inicjalizacja i subskrypcje
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      await Promise.all([fetchTasks(), fetchStatuses(), fetchPersons(), fetchEntries(), fetchProperties()]);
      setLoading(false);
    };
    loadAll();

    // Słuchamy zmian w bazie, ale ignorujemy powiadomienia, gdy sami właśnie przesuwamy elementy
    const channel = supabase.channel('workflow-stable')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_entries' }, () => {
        if (!isSavingRef.current) fetchEntries();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_statuses' }, () => {
        if (!isSavingRef.current) fetchStatuses();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_persons' }, () => {
        if (!isSavingRef.current) fetchPersons();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_tasks' }, () => {
        if (!isSavingRef.current) fetchTasks();
      })
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [fetchTasks, fetchStatuses, fetchPersons, fetchEntries, fetchProperties]);

  // --- RDZEŃ DRAG & DROP ---

  const handleDragStart = (id: string, type: 'task' | 'property') => {
    if (!isReorderMode) return;
    setDraggedId(id);
    setDragType(type);
  };

  const handleDragOver = (e: React.DragEvent, id: string, type: 'task' | 'property') => {
    e.preventDefault();
    if (isReorderMode && dragType === type && draggedId !== id) {
      setDropTargetId(id);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const type = dragType;
    const sourceId = draggedId;

    setDraggedId(null);
    setDropTargetId(null);
    setDragType(null);

    if (!sourceId || sourceId === targetId || !type || !isReorderMode) return;

    setIsSavingOrder(true);
    isSavingRef.current = true; // BLOKADA REALTIME

    try {
      if (type === 'task') {
        const newList = [...tasks].sort((a,b) => a.position - b.position);
        const sIdx = newList.findIndex(t => t.id === sourceId);
        const tIdx = newList.findIndex(t => t.id === targetId);
        const [moved] = newList.splice(sIdx, 1);
        newList.splice(tIdx, 0, moved);
        
        // Optimistic UI
        const updatedList = newList.map((t, i) => ({ ...t, position: i }));
        setTasks(updatedList);

        // Zapisz pozycje w DB
        for (let i = 0; i < updatedList.length; i++) {
           await supabase.from('workflow_tasks').update({ position: i }).eq('id', updatedList[i].id);
        }
        await fetchTasks(); // Re-sync
      } 
      else if (type === 'property') {
        const newList = [...properties];
        const sIdx = newList.findIndex(p => p.id === sourceId);
        const tIdx = newList.findIndex(p => p.id === targetId);
        const [moved] = newList.splice(sIdx, 1);
        newList.splice(tIdx, 0, moved);

        // Zapisz pozycje w DB
        for (let i = 0; i < newList.length; i++) {
           await supabase.from('properties').update({ workflow_position: i }).eq('id', newList[i].id);
        }
        await fetchProperties(); // Re-sync
      }
    } catch (err: any) {
      console.error("Critical Reorder Error:", err);
      alert("Błąd zapisu kolejności.");
    } finally {
      setIsSavingOrder(false);
      // Odblokuj Realtime z lekkim lagiem
      setTimeout(() => {
        isSavingRef.current = false;
      }, 800);
    }
  };

  // --- SORTOWANIE I FILTROWANIE ---
  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => a.position - b.position), [tasks]);
  
  const filteredProperties = useMemo(() => {
    let list = [...properties];
    
    // Sortujemy tylko gdy nie jesteśmy w trakcie DnD
    if (!dragType) {
        list.sort((a, b) => {
            const activeA = a.workflow_is_active === false ? 0 : 1;
            const activeB = b.workflow_is_active === false ? 0 : 1;
            if (activeA !== activeB) return activeB - activeA;
            return (a.workflow_position ?? 999) - (b.workflow_position ?? 999);
        });
    }

    if (searchQuery) {
      list = list.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return list;
  }, [properties, searchQuery, dragType]);

  // --- MODALE I AKCJE ---
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isPersonsModalOpen, setIsPersonsModalOpen] = useState(false);
  const [isCellModalOpen, setIsCellModalOpen] = useState(false);
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);

  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newStatus, setNewStatus] = useState({ label: '', color: 'bg-slate-600' });
  const [newPersonName, setNewPersonName] = useState('');
  const [selectedCell, setSelectedCell] = useState<{ propId: string, taskId: string } | null>(null);
  const [cellForm, setCellForm] = useState({ statusId: '', comment: '', assignedTo: '' });

  // Confirmation modal for changes
  const [isConfirmChangeModalOpen, setIsConfirmChangeModalOpen] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [pendingCellData, setPendingCellData] = useState<{
    oldEntry: WorkflowEntry | null;
    newData: { statusId: string; comment: string; assignedTo: string };
  } | null>(null);

  // History modal
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<WorkflowEntryHistory[]>([]);
  const [historyCell, setHistoryCell] = useState<{ propId: string; taskId: string } | null>(null);

  const handleToggleTaskActive = async (taskId: string, currentState: boolean) => {
    await supabase.from('workflow_tasks').update({ is_active: !currentState }).eq('id', taskId);
    fetchTasks();
  };

  const handleTogglePropertyActive = async (propId: string, currentState: boolean) => {
    await supabase.from('properties').update({ workflow_is_active: !currentState }).eq('id', propId);
    fetchProperties();
  };

  const handleUpdatePropertyAssignedTo = async (propId: string, personName: string) => {
    await supabase.from('properties').update({ workflow_assigned_to: personName || null }).eq('id', propId);
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

  const handleAddPerson = async () => {
    if (!newPersonName.trim()) return;
    await supabase.from('workflow_persons').insert({ name: newPersonName.trim() });
    setNewPersonName(''); fetchPersons();
  };

  const openCellModal = (propId: string, taskId: string) => {
    const entry = entries.find(e => e.property_id === propId && e.task_id === taskId);
    setSelectedCell({ propId, taskId });
    setCellForm({ statusId: entry?.status_id || '', comment: entry?.comment || '', assignedTo: entry?.assigned_to || '' });
    setIsCellModalOpen(true);
  };

  const saveCell = async () => {
    if (!selectedCell) return;
    const existing = entries.find(e => e.property_id === selectedCell.propId && e.task_id === selectedCell.taskId);

    // Check if anything changed
    const hasChanges =
      (existing?.status_id || '') !== cellForm.statusId ||
      (existing?.comment || '') !== cellForm.comment ||
      (existing?.assigned_to || '') !== cellForm.assignedTo;

    if (!hasChanges) {
      // No changes, just close modal
      setIsCellModalOpen(false);
      return;
    }

    // Store pending data and show confirmation modal
    setPendingCellData({
      oldEntry: existing || null,
      newData: { statusId: cellForm.statusId, comment: cellForm.comment, assignedTo: cellForm.assignedTo }
    });
    setChangeReason('');
    setIsConfirmChangeModalOpen(true);
  };

  const saveCellWithHistory = async () => {
    if (!selectedCell || !pendingCellData) return;

    const { data: { user } } = await supabase.auth.getUser();
    const { oldEntry, newData } = pendingCellData;

    const payload = {
      status_id: newData.statusId || null,
      comment: newData.comment,
      assigned_to: newData.assignedTo || null,
      last_updated_by_email: user?.email || 'System',
      updated_at: new Date().toISOString()
    };

    try {
      let entryId = oldEntry?.id;

      // Save to workflow_entries
      if (oldEntry) {
        await supabase.from('workflow_entries').update(payload).eq('id', oldEntry.id);
      } else {
        const { data: newEntry } = await supabase
          .from('workflow_entries')
          .insert({ ...payload, property_id: selectedCell.propId, task_id: selectedCell.taskId })
          .select()
          .single();
        entryId = newEntry?.id;
      }

      // Save to workflow_entry_history
      if (entryId) {
        await supabase.from('workflow_entry_history').insert({
          entry_id: entryId,
          property_id: selectedCell.propId,
          task_id: selectedCell.taskId,
          old_status_id: oldEntry?.status_id || null,
          old_comment: oldEntry?.comment || null,
          old_assigned_to: oldEntry?.assigned_to || null,
          new_status_id: newData.statusId || null,
          new_comment: newData.comment || null,
          new_assigned_to: newData.assignedTo || null,
          change_reason: changeReason || 'Brak opisu',
          changed_by_email: user?.email || 'System'
        });
      }

      setIsCellModalOpen(false);
      setIsConfirmChangeModalOpen(false);
      setPendingCellData(null);
      setChangeReason('');
      fetchEntries();
    } catch (err) {
      console.error('Error saving cell with history:', err);
      alert('Błąd podczas zapisywania zmian.');
    }
  };

  const openHistoryModal = async (propId: string, taskId: string) => {
    setHistoryCell({ propId, taskId });
    const { data } = await supabase
      .from('workflow_entry_history')
      .select('*')
      .eq('property_id', propId)
      .eq('task_id', taskId)
      .order('changed_at', { ascending: false });
    setHistoryEntries(data || []);
    setIsHistoryModalOpen(true);
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
            <div className="flex items-center gap-2 text-indigo-400 text-xs font-bold animate-pulse bg-indigo-500/10 px-3 py-1 rounded-full">
              <Loader2 size={14} className="animate-spin" /> ZAPISYWANIE KOLEJNOŚCI...
            </div>
          )}
        </div>
        <div className="flex gap-2">
            <button 
              onClick={() => setIsReorderMode(!isReorderMode)} 
              className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 border transition-all ${isReorderMode ? 'bg-indigo-600 border-white text-white shadow-[0_0_20px_rgba(99,102,241,0.6)] font-bold' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
            >
                <Move size={16} /> {isReorderMode ? 'Zakończ układanie' : 'Zmień kolejność'}
            </button>
            <button onClick={() => setIsPropertyModalOpen(true)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm flex items-center gap-2 border border-slate-700 transition-colors"><Plus size={16} /> Obiekt</button>
            <button onClick={() => setIsStatusModalOpen(true)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm flex items-center gap-2 border border-slate-700 transition-colors"><Settings size={16} /> Statusy</button>
            <button onClick={() => setIsPersonsModalOpen(true)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm flex items-center gap-2 border border-slate-700 transition-colors"><Settings size={16} /> Osoby</button>
            <button onClick={() => setIsTaskModalOpen(true)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm flex items-center gap-2 transition-all"><Plus size={16} /> Kolumna</button>
        </div>
      </div>

      {/* TABLE */}
      <div className={`flex-1 overflow-auto bg-surface rounded-xl border border-border shadow-2xl custom-scrollbar relative ${isReorderMode ? 'ring-2 ring-indigo-500 ring-inset cursor-crosshair' : ''}`}>
        <table className="w-max border-separate border-spacing-0">
          <thead className="sticky top-0 z-30">
            <tr>
              <th className="p-4 bg-slate-900 text-slate-400 font-bold text-xs uppercase border-b border-r border-border sticky left-0 z-40 w-64 shadow-[2px_0_5px_rgba(0,0,0,0.3)]">Obiekt</th>
              {sortedTasks.map(task => (
                <th 
                  key={task.id} 
                  onDragOver={(e) => handleDragOver(e, task.id, 'task')}
                  onDrop={(e) => handleDrop(e, task.id)}
                  className={`p-3 bg-slate-900 border-b border-border border-r border-slate-800 w-[250px] group transition-all ${!task.is_active ? 'opacity-40 grayscale' : ''} ${dropTargetId === task.id && dragType === 'task' ? 'bg-indigo-500/30 ring-4 ring-inset ring-indigo-400' : ''}`}
                >
                   <div className="flex justify-between items-center text-white text-sm">
                       <div className="flex items-center gap-2 truncate">
                           {isReorderMode && (
                               <div 
                                 draggable 
                                 onDragStart={() => handleDragStart(task.id, 'task')}
                                 className="cursor-grab active:cursor-grabbing p-1.5 bg-indigo-500/20 hover:bg-indigo-500/40 rounded transition-colors"
                               >
                                   <GripVertical size={16} className="text-indigo-400" />
                               </div>
                           )}
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
                  onDragOver={(e) => handleDragOver(e, property.id, 'property')}
                  onDrop={(e) => handleDrop(e, property.id)}
                  className={`hover:bg-slate-800/30 transition-all ${!rowIsActive ? 'opacity-30 grayscale bg-slate-900/50' : ''} ${isTarget ? 'bg-indigo-500/20 shadow-[inset_0_4px_0_0_#818cf8,inset_0_-4px_0_0_#818cf8]' : ''} ${isSource ? 'opacity-20 bg-indigo-500/10' : ''}`}
                >
                  <td className={`p-3 bg-surface sticky left-0 z-20 border-r border-border border-b border-border h-[80px] group shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]`}>
                    <div className="flex justify-between items-start gap-2 h-full">
                        <div className="flex items-start gap-2 flex-grow min-w-0">
                            {isReorderMode && (
                                <div
                                  draggable
                                  onDragStart={() => handleDragStart(property.id, 'property')}
                                  className="cursor-grab active:cursor-grabbing p-1.5 bg-indigo-500/20 hover:bg-indigo-500/40 rounded transition-colors mt-0.5"
                                >
                                    <GripVertical size={16} className="text-indigo-400" />
                                </div>
                            )}
                            <div className="flex flex-col gap-1 flex-grow min-w-0">
                                <div className="truncate font-medium text-white text-sm">{property.name}</div>
                                <select
                                  value={property.workflow_assigned_to || ''}
                                  onChange={(e) => handleUpdatePropertyAssignedTo(property.id, e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-slate-300 outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer hover:bg-slate-700 transition-colors"
                                >
                                  <option value="">Opiekun: —</option>
                                  {persons.map(p => (
                                    <option key={p.id} value={p.name}>{p.name}</option>
                                  ))}
                                </select>
                            </div>
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
                      <td key={task.id} className="p-1 border-r border-b border-slate-800 cursor-pointer align-middle h-[80px] w-[250px] relative group" onClick={() => !isReorderMode && openCellModal(property.id, task.id)}>
                        <div className={`w-full h-full rounded flex flex-col justify-center px-4 py-2 transition-all border-2 ${status ? status.color + ' border-transparent shadow-lg shadow-black/40' : 'bg-transparent border-transparent hover:border-slate-700 hover:bg-slate-800'} ${status ? 'text-white font-bold' : 'text-slate-500'} ${isReorderMode ? 'opacity-40 pointer-events-none' : ''}`}>
                           <div className="flex items-center justify-between gap-2">
                               <span className="text-sm truncate">{status ? status.label : ''}</span>
                               <div className="flex items-center gap-1">
                                 {hasComment && <MessageSquare size={14} className={status ? 'text-white/80' : 'text-indigo-400'} />}
                               </div>
                           </div>
                           {entry?.assigned_to && (
                             <div className={`mt-1 flex items-center gap-1 text-[11px] font-normal ${status ? 'text-white/70' : 'text-slate-400'}`}>
                               <span className="truncate">👤 {entry.assigned_to}</span>
                             </div>
                           )}
                        </div>
                        {/* History button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openHistoryModal(property.id, task.id);
                          }}
                          className="absolute top-2 right-2 p-1 rounded bg-slate-900/70 hover:bg-indigo-600/80 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                          title="Zobacz historię zmian"
                        >
                          <History size={14} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* MODALE */}
      {/* Confirmation Modal */}
      {isConfirmChangeModalOpen && pendingCellData && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-md rounded-xl border border-border shadow-2xl p-6 space-y-5">
            <div className="flex justify-between items-start">
              <h3 className="font-bold text-white text-lg">Potwierdź zmianę</h3>
              <button
                onClick={() => {
                  setIsConfirmChangeModalOpen(false);
                  setPendingCellData(null);
                }}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <p className="text-slate-400 font-semibold">Podsumowanie zmian:</p>

              {/* Status change */}
              {(pendingCellData.oldEntry?.status_id || '') !== pendingCellData.newData.statusId && (
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                  <div className="text-xs text-slate-500 uppercase font-bold mb-1">Status</div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-300">
                      {pendingCellData.oldEntry?.status_id
                        ? getStatus(pendingCellData.oldEntry.status_id)?.label || 'Brak'
                        : 'Brak'}
                    </span>
                    <span className="text-indigo-400">→</span>
                    <span className="text-white font-bold">
                      {pendingCellData.newData.statusId
                        ? getStatus(pendingCellData.newData.statusId)?.label || 'Brak'
                        : 'Brak'}
                    </span>
                  </div>
                </div>
              )}

              {/* Comment change */}
              {(pendingCellData.oldEntry?.comment || '') !== pendingCellData.newData.comment && (
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                  <div className="text-xs text-slate-500 uppercase font-bold mb-1">Komentarz</div>
                  <div className="text-slate-400 text-xs">Zmieniono notatki</div>
                </div>
              )}

              {/* Assignment change */}
              {(pendingCellData.oldEntry?.assigned_to || '') !== pendingCellData.newData.assignedTo && (
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                  <div className="text-xs text-slate-500 uppercase font-bold mb-1">Osoba</div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-300">
                      {pendingCellData.oldEntry?.assigned_to || 'Brak'}
                    </span>
                    <span className="text-indigo-400">→</span>
                    <span className="text-white font-bold">
                      {pendingCellData.newData.assignedTo || 'Brak'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-400 uppercase">
                Powód zmiany: <span className="text-red-400">*</span>
              </label>
              <textarea
                autoFocus
                rows={3}
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                placeholder="Opisz dlaczego ta zmiana została dokonana..."
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsConfirmChangeModalOpen(false);
                  setPendingCellData(null);
                }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={saveCellWithHistory}
                disabled={!changeReason.trim()}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg font-bold transition-all flex items-center justify-center gap-2"
              >
                <Save size={18} /> Potwierdź
              </button>
            </div>
          </div>
        </div>
      )}

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
                     <button onClick={() => setCellForm({...cellForm, statusId: ''})} className={`p-3 rounded-lg border text-sm text-left transition-all ${cellForm.statusId === '' ? 'border-indigo-500 bg-indigo-500/10 text-white font-bold' : 'border-slate-700 text-slate-500 hover:bg-slate-800'}`}>Brak statusu / Wyczyść</button>
                     {statuses.map(s => (
                         <button key={s.id} onClick={() => setCellForm({...cellForm, statusId: s.id})} className={`p-3 rounded-lg border text-sm text-left flex items-center gap-3 transition-all ${cellForm.statusId === s.id ? 'border-white bg-slate-800 text-white shadow-lg ring-1 ring-indigo-500 font-bold' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}>
                            <div className={`w-3 h-3 rounded-full ${s.color}`}></div> {s.label}
                         </button>
                     ))}
                 </div>
             </div>
             <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-400 uppercase">Osoba odpowiedzialna:</label>
                <select
                  value={cellForm.assignedTo}
                  onChange={e => setCellForm({...cellForm, assignedTo: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="">— Brak —</option>
                  {persons.map(p => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
                {persons.length === 0 && (
                  <p className="text-xs text-slate-500">Dodaj osoby w sekcji "Osoby" w nagłówku.</p>
                )}
             </div>
             <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-400 uppercase">Notatki:</label>
                <textarea rows={4} value={cellForm.comment} onChange={e => setCellForm({...cellForm, comment: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none" placeholder="Dodaj uwagi do tego zadania..." />
             </div>
             <button onClick={saveCell} className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center justify-center gap-2 font-bold shadow-lg transition-all active:scale-95"><Save size={18}/> Zapisz zmiany</button>
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
                        {COLORS.map(c => ( <button key={c.class} onClick={() => setNewStatus({...newStatus, color: c.class})} className={`w-6 h-6 rounded-full ${c.class} transition-all hover:scale-110 ${newStatus.color === c.class ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800' : ''}`} title={c.name} /> ))}
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}

      {isPersonsModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-lg rounded-xl border border-border shadow-2xl overflow-hidden">
             <div className="p-4 border-b border-border flex justify-between items-center bg-slate-900/50">
                <h3 className="font-bold text-white">Zarządzaj Osobami</h3>
                <button onClick={() => setIsPersonsModalOpen(false)}><X className="text-slate-400 hover:text-white" /></button>
             </div>
             <div className="p-6 space-y-6">
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {persons.length === 0 && (
                      <p className="text-slate-500 text-sm text-center py-4">Brak osób. Dodaj pierwszą osobę poniżej.</p>
                    )}
                    {persons.map(p => (
                        <div key={p.id} className="flex items-center justify-between bg-slate-900 p-2 rounded border border-border group">
                            <span className="text-white text-sm">{p.name}</span>
                            <button onClick={async () => { if(confirm("Usunąć osobę?")) { await supabase.from('workflow_persons').delete().eq('id', p.id); fetchPersons(); }}} className="text-slate-500 hover:text-red-400"><Trash2 size={16}/></button>
                        </div>
                    ))}
                </div>
                <div className="border-t border-border pt-4 space-y-3">
                    <p className="text-xs font-bold text-slate-400 uppercase">Nowa osoba</p>
                    <div className="flex gap-2">
                         <input
                           value={newPersonName}
                           onChange={e => setNewPersonName(e.target.value)}
                           onKeyDown={e => { if (e.key === 'Enter') handleAddPerson(); }}
                           placeholder="Imię i nazwisko"
                           className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                         />
                         <button onClick={handleAddPerson} className="px-3 bg-indigo-600 text-white rounded-lg text-sm"><Plus /></button>
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {isHistoryModalOpen && historyCell && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-surface w-full max-w-2xl rounded-xl border border-border shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-border flex justify-between items-center bg-slate-900/50">
              <div className="flex items-center gap-2">
                <History className="text-indigo-400" size={20} />
                <h3 className="font-bold text-white">Historia zmian</h3>
              </div>
              <button onClick={() => setIsHistoryModalOpen(false)}>
                <X className="text-slate-400 hover:text-white" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
              {historyEntries.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-8">Brak historii zmian dla tej komórki.</p>
              )}
              {historyEntries.map((h) => (
                <div key={h.id} className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="text-xs text-slate-400">
                      <div className="font-bold">{h.changed_by_email}</div>
                      <div>{new Date(h.changed_at).toLocaleString('pl-PL')}</div>
                    </div>
                  </div>

                  {/* Status change */}
                  {h.old_status_id !== h.new_status_id && (
                    <div className="bg-slate-800/50 p-2 rounded border border-slate-600">
                      <div className="text-xs text-slate-500 uppercase font-bold mb-1">Status</div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-300">
                          {h.old_status_id ? getStatus(h.old_status_id)?.label || 'Brak' : 'Brak'}
                        </span>
                        <span className="text-indigo-400">→</span>
                        <span className="text-white font-bold">
                          {h.new_status_id ? getStatus(h.new_status_id)?.label || 'Brak' : 'Brak'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Comment change */}
                  {h.old_comment !== h.new_comment && (
                    <div className="bg-slate-800/50 p-2 rounded border border-slate-600">
                      <div className="text-xs text-slate-500 uppercase font-bold mb-1">Komentarz</div>
                      <div className="text-xs text-slate-400">Zmieniono notatki</div>
                    </div>
                  )}

                  {/* Assignment change */}
                  {h.old_assigned_to !== h.new_assigned_to && (
                    <div className="bg-slate-800/50 p-2 rounded border border-slate-600">
                      <div className="text-xs text-slate-500 uppercase font-bold mb-1">Osoba</div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-300">{h.old_assigned_to || 'Brak'}</span>
                        <span className="text-indigo-400">→</span>
                        <span className="text-white font-bold">{h.new_assigned_to || 'Brak'}</span>
                      </div>
                    </div>
                  )}

                  {/* Reason */}
                  <div className="bg-indigo-500/10 p-3 rounded border border-indigo-500/30">
                    <div className="text-xs text-indigo-400 uppercase font-bold mb-1">Powód</div>
                    <div className="text-sm text-white">{h.change_reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
