import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { useProperties } from '../contexts/PropertyContext';
import { WorkflowTask, WorkflowStatus, WorkflowEntry } from '../types';
import { Plus, X, Loader2, Save, Trash2, Settings, MessageSquare, RefreshCw } from 'lucide-react';

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
  const { properties, addProperty } = useProperties();
  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [statuses, setStatuses] = useState<WorkflowStatus[]>([]);
  const [entries, setEntries] = useState<WorkflowEntry[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modals
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isCellModalOpen, setIsCellModalOpen] = useState(false);
  const [isPropertyModalOpen, setIsPropertyModalOpen] = useState(false);

  // Forms & Selections
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newStatus, setNewStatus] = useState({ label: '', color: 'bg-slate-600' });
  const [selectedCell, setSelectedCell] = useState<{ propId: string, taskId: string } | null>(null);
  const [cellForm, setCellForm] = useState({ statusId: '', comment: '' });
  const [newPropertyName, setNewPropertyName] = useState('');

  useEffect(() => {
    fetchWorkflowData();

    // Realtime Subscriptions
    const channels = supabase.channel('workflow-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_tasks' }, () => {
          fetchTasks();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_statuses' }, () => {
          fetchStatuses();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_entries' }, (payload) => {
          handleEntryRealtime(payload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channels);
    };
  }, []);

  const fetchTasks = async () => {
      const { data } = await supabase.from('workflow_tasks').select('*').order('created_at', { ascending: true });
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
        supabase.from('workflow_tasks').select('*').order('created_at', { ascending: true }),
        supabase.from('workflow_statuses').select('*').order('created_at', { ascending: true }),
        supabase.from('workflow_entries').select('*')
      ]);

      if (tRes.error) throw tRes.error;
      if (sRes.error) throw sRes.error;
      if (eRes.error) throw eRes.error;

      setTasks(tRes.data || []);
      setStatuses(sRes.data || []);
      setEntries(eRes.data || []);
    } catch (e: any) {
      console.error("Workflow fetch error:", e);
      if (e.message?.includes('relation') || e.code === '42P01') {
          alert("Brakuje tabel w bazie danych. Wykonaj kod SQL podany w instrukcji.");
      }
    } finally {
      setLoading(false);
    }
  };

  // --- ACTIONS ---

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Insert only. Realtime will update the UI.
    const { error } = await supabase.from('workflow_tasks').insert({
      title: newTaskTitle,
      user_id: user.id
    });

    if (!error) {
      setNewTaskTitle('');
      setIsTaskModalOpen(false);
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (!confirm("Usunąć to zadanie (kolumnę)? Wszystkie wpisy w niej zostaną usunięte.")) return;
    await supabase.from('workflow_tasks').delete().eq('id', id);
    // UI update handled by realtime
  };

  const handleAddStatus = async () => {
    if (!newStatus.label.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('workflow_statuses').insert({
      label: newStatus.label,
      color: newStatus.color,
      user_id: user.id
    });

    if (!error) {
      setNewStatus({ label: '', color: 'bg-slate-600' });
    }
  };

  const handleDeleteStatus = async (id: string) => {
    if (!confirm("Usunąć ten status?")) return;
    await supabase.from('workflow_statuses').delete().eq('id', id);
  };

  const handleAddProperty = async () => {
    if(!newPropertyName.trim()) return;
    try {
        await addProperty(newPropertyName, 'Dodane z Workflow', null, null, null);
        setNewPropertyName('');
        setIsPropertyModalOpen(false);
    } catch(e: any) {
        alert(e.message);
    }
  }

  // --- CELL EDITING ---

  const openCellModal = (propId: string, taskId: string) => {
    const entry = entries.find(e => e.property_id === propId && e.task_id === taskId);
    setSelectedCell({ propId, taskId });
    setCellForm({
      statusId: entry?.status_id || '',
      comment: entry?.comment || ''
    });
    setIsCellModalOpen(true);
  };

  const saveCell = async () => {
    if (!selectedCell) return;
    
    // Check if entry exists
    const existing = entries.find(e => e.property_id === selectedCell.propId && e.task_id === selectedCell.taskId);
    
    if (existing) {
      // Update
      await supabase.from('workflow_entries').update({
        status_id: cellForm.statusId || null,
        comment: cellForm.comment,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id);
    } else {
      // Create
      await supabase.from('workflow_entries').insert({
        property_id: selectedCell.propId,
        task_id: selectedCell.taskId,
        status_id: cellForm.statusId || null,
        comment: cellForm.comment
      });
    }
    // UI updated via realtime
    setIsCellModalOpen(false);
  };

  // --- RENDER HELPERS ---

  const getStatus = (id: string | null) => statuses.find(s => s.id === id);
  const getEntry = (propId: string, taskId: string) => entries.find(e => e.property_id === propId && e.task_id === taskId);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-border pb-4">
        <div>
           <h2 className="text-2xl font-bold text-white flex items-center gap-2">
             <RefreshCw size={24} className="text-indigo-400"/> Workflow Zespołowy
           </h2>
           <p className="text-slate-400 text-sm">Wspólna tablica zadań dla wszystkich obiektów</p>
        </div>
        <div className="flex gap-2">
            <button onClick={() => setIsStatusModalOpen(true)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 border border-slate-700">
                <Settings size={16} /> Statusy
            </button>
            <button onClick={() => setIsTaskModalOpen(true)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                <Plus size={16} /> Dodaj kolumnę
            </button>
        </div>
      </div>

      <div className="overflow-x-auto bg-surface rounded-xl border border-border shadow-xl pb-2">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              <th className="p-4 bg-slate-900/80 text-slate-400 font-bold text-xs uppercase tracking-wider border-b border-border sticky left-0 z-10 w-64">
                Obiekt
              </th>
              {tasks.map(task => (
                <th key={task.id} className="p-4 bg-slate-900/80 text-white font-bold text-sm border-b border-border border-l border-slate-800 min-w-[200px] group relative">
                   <div className="flex justify-between items-center">
                       {task.title}
                       <button onClick={() => handleDeleteTask(task.id)} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity">
                           <Trash2 size={14} />
                       </button>
                   </div>
                </th>
              ))}
              {tasks.length === 0 && <th className="p-4 text-slate-500 italic font-normal text-sm border-b border-border">Dodaj kolumny zadań</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {properties.map(property => (
              <tr key={property.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="p-4 font-medium text-white sticky left-0 bg-surface z-10 border-r border-border shadow-[2px_0_5px_-2px_rgba(0,0,0,0.3)] align-top">
                  {property.name}
                </td>
                {tasks.map(task => {
                  const entry = getEntry(property.id, task.id);
                  const status = entry ? getStatus(entry.status_id) : null;
                  return (
                    <td 
                        key={task.id} 
                        className="p-2 border-l border-slate-800 cursor-pointer relative group align-top"
                        onClick={() => openCellModal(property.id, task.id)}
                    >
                      <div className={`w-full min-h-[42px] rounded flex flex-col justify-center px-3 py-2 transition-all gap-1 ${status ? status.color : 'bg-slate-900/50 hover:bg-slate-800'} ${status ? 'text-white shadow-sm' : 'text-slate-500'}`}>
                         <div className="flex items-center justify-between">
                             <span className="text-sm font-medium truncate">
                                 {status ? status.label : <span className="opacity-30 text-xs">Brak</span>}
                             </span>
                         </div>
                         {entry?.comment && (
                             <div className={`text-xs mt-1 break-words font-normal leading-snug whitespace-pre-wrap ${status ? 'text-white/90' : 'text-slate-400 italic'}`}>
                                 {entry.comment}
                             </div>
                         )}
                      </div>
                    </td>
                  );
                })}
                {tasks.length === 0 && <td className="p-4"></td>}
              </tr>
            ))}
            {properties.length === 0 && (
                <tr><td colSpan={tasks.length + 1} className="p-8 text-center text-slate-500 italic">Brak obiektów. Dodaj je w panelu bocznym.</td></tr>
            )}
          </tbody>
        </table>
        
        <div className="p-4 border-t border-border bg-slate-900/30">
            <button onClick={() => setIsPropertyModalOpen(true)} className="text-sm text-indigo-400 hover:text-white flex items-center gap-2 transition-colors">
                <Plus size={16} /> Dodaj nowy obiekt
            </button>
        </div>
      </div>

      {/* --- MODALS --- */}

      {/* Add Task Modal */}
      {isTaskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-4">
             <h3 className="font-bold text-white text-lg">Nowe Zadanie (Kolumna)</h3>
             <input autoFocus value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="np. Sprzątanie" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" />
             <div className="flex justify-end gap-2">
                 <button onClick={() => setIsTaskModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white">Anuluj</button>
                 <button onClick={handleAddTask} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg">Dodaj</button>
             </div>
          </div>
        </div>
      )}

      {/* Status Manager Modal */}
      {isStatusModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-surface w-full max-w-lg rounded-xl border border-border shadow-2xl overflow-hidden">
             <div className="p-4 border-b border-border flex justify-between items-center bg-slate-900/50">
                <h3 className="font-bold text-white">Zarządzaj Statusami</h3>
                <button onClick={() => setIsStatusModalOpen(false)}><X className="text-slate-400 hover:text-white" /></button>
             </div>
             <div className="p-6 space-y-6">
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {statuses.length === 0 && <p className="text-slate-500 italic text-sm text-center">Brak zdefiniowanych statusów.</p>}
                    {statuses.map(s => (
                        <div key={s.id} className="flex items-center justify-between bg-slate-900 p-2 rounded border border-border">
                            <div className="flex items-center gap-3">
                                <div className={`w-4 h-4 rounded-full ${s.color}`}></div>
                                <span className="text-white text-sm">{s.label}</span>
                            </div>
                            <button onClick={() => handleDeleteStatus(s.id)} className="text-slate-500 hover:text-red-400"><Trash2 size={16}/></button>
                        </div>
                    ))}
                </div>
                <div className="border-t border-border pt-4 space-y-3">
                    <p className="text-xs font-bold text-slate-400 uppercase">Dodaj nowy status</p>
                    <div className="flex gap-2">
                         <input value={newStatus.label} onChange={e => setNewStatus({...newStatus, label: e.target.value})} placeholder="Nazwa statusu" className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm outline-none focus:ring-1 focus:ring-indigo-500" />
                         <button onClick={handleAddStatus} className="px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm"><Plus /></button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        {COLORS.map(c => (
                            <button 
                                key={c.class} 
                                onClick={() => setNewStatus({...newStatus, color: c.class})}
                                className={`w-6 h-6 rounded-full ${c.class} transition-transform hover:scale-110 ${newStatus.color === c.class ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-800' : ''}`}
                                title={c.label}
                            />
                        ))}
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}

      {/* Cell Editor Modal */}
      {isCellModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-4">
             <h3 className="font-bold text-white text-lg">Edytuj wpis</h3>
             
             <div>
                 <label className="block text-xs font-medium text-slate-400 mb-1">Status</label>
                 <div className="grid grid-cols-1 gap-2">
                     <button 
                        onClick={() => setCellForm({...cellForm, statusId: ''})}
                        className={`p-2 rounded border text-sm text-left transition-colors ${cellForm.statusId === '' ? 'border-white bg-slate-800 text-white' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                     >
                        Brak statusu
                     </button>
                     {statuses.map(s => (
                         <button 
                            key={s.id}
                            onClick={() => setCellForm({...cellForm, statusId: s.id})}
                            className={`p-2 rounded border text-sm text-left transition-colors flex items-center gap-2 ${cellForm.statusId === s.id ? 'border-white bg-slate-800 text-white' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                         >
                            <div className={`w-3 h-3 rounded-full ${s.color}`}></div>
                            {s.label}
                         </button>
                     ))}
                 </div>
             </div>

             <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Komentarz</label>
                <textarea 
                    rows={3}
                    value={cellForm.comment}
                    onChange={e => setCellForm({...cellForm, comment: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    placeholder="Dodaj opcjonalny komentarz..."
                />
             </div>

             <div className="flex justify-end gap-2 pt-2">
                 <button onClick={() => setIsCellModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white">Anuluj</button>
                 <button onClick={saveCell} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2"><Save size={16}/> Zapisz</button>
             </div>
          </div>
        </div>
      )}

      {/* Add Property Modal */}
      {isPropertyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-surface w-full max-w-sm rounded-xl border border-border shadow-2xl p-6 space-y-4">
             <h3 className="font-bold text-white text-lg">Dodaj nowy obiekt</h3>
             <input autoFocus value={newPropertyName} onChange={e => setNewPropertyName(e.target.value)} placeholder="Nazwa obiektu" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" />
             <div className="flex justify-end gap-2">
                 <button onClick={() => setIsPropertyModalOpen(false)} className="px-4 py-2 text-slate-400 hover:text-white">Anuluj</button>
                 <button onClick={handleAddProperty} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg">Dodaj</button>
             </div>
          </div>
        </div>
      )}

    </div>
  );
};
