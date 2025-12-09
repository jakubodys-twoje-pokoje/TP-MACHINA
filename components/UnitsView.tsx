import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Plus, Trash2, Edit2, Check, X, Users } from 'lucide-react';
import { Unit } from '../types';

export const UnitsView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Edit/Add state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Unit>>({});

  useEffect(() => {
    if (propertyId) fetchUnits();
  }, [propertyId]);

  const fetchUnits = async () => {
    if (!propertyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('units')
      .select('*')
      .eq('property_id', propertyId)
      .order('name');
    
    if (!error) setUnits(data || []);
    setLoading(false);
  };

  const handleAddNew = () => {
    setEditForm({
      name: '',
      type: 'room',
      capacity: 2,
      description: ''
    });
    setEditingId('new');
  };

  const handleEdit = (unit: Unit) => {
    setEditForm(unit);
    setEditingId(unit.id);
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSave = async () => {
    if (!propertyId || !editForm.name) return;

    try {
      if (editingId === 'new') {
        const { data, error } = await supabase
          .from('units')
          .insert([{ ...editForm, property_id: propertyId }])
          .select()
          .single();
        if (error) throw error;
        setUnits([...units, data]);
      } else {
        const { error } = await supabase
          .from('units')
          .update(editForm)
          .eq('id', editingId);
        if (error) throw error;
        setUnits(units.map(u => u.id === editingId ? { ...u, ...editForm } as Unit : u));
      }
      setEditingId(null);
    } catch (err) {
      alert('Błąd zapisu kwatery');
      console.error(err);
    }
  };

  const handleDelete = async (unitId: string) => {
    if (!confirm('Usunąć kwaterę?')) return;
    const { error } = await supabase.from('units').delete().eq('id', unitId);
    if (!error) {
      setUnits(units.filter(u => u.id !== unitId));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Kwatery / Pokoje</h2>
          <p className="text-slate-400 text-sm">Zarządzaj pokojami w tym obiekcie</p>
        </div>
        <button 
          onClick={handleAddNew}
          disabled={editingId !== null}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors text-sm"
        >
          <Plus size={16} /> Dodaj kwaterę
        </button>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/50 text-slate-400 uppercase tracking-wider font-semibold border-b border-border">
            <tr>
              <th className="px-6 py-4">Nazwa</th>
              <th className="px-6 py-4">Typ</th>
              <th className="px-6 py-4">Pojemność</th>
              <th className="px-6 py-4 text-right">Akcje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* ADD NEW ROW */}
            {editingId === 'new' && (
               <tr className="bg-indigo-900/10 animate-in fade-in">
                <td className="px-6 py-4">
                  <input autoFocus className="bg-slate-900 border border-slate-600 rounded p-1 w-full text-white" placeholder="Np. Pokój 101" value={editForm.name || ''} onChange={e => setEditForm({...editForm, name: e.target.value})} />
                </td>
                <td className="px-6 py-4">
                   <select className="bg-slate-900 border border-slate-600 rounded p-1 w-full text-white" value={editForm.type} onChange={e => setEditForm({...editForm, type: e.target.value})}>
                      <option value="room">Pokój</option>
                      <option value="apartment">Apartament</option>
                      <option value="house">Domek</option>
                   </select>
                </td>
                <td className="px-6 py-4">
                   <input type="number" className="bg-slate-900 border border-slate-600 rounded p-1 w-20 text-white" value={editForm.capacity} onChange={e => setEditForm({...editForm, capacity: parseInt(e.target.value)})} />
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={handleSave} className="p-1 bg-green-600 text-white rounded hover:bg-green-700"><Check size={16} /></button>
                    <button onClick={handleCancel} className="p-1 bg-slate-600 text-white rounded hover:bg-slate-700"><X size={16} /></button>
                  </div>
                </td>
               </tr>
            )}

            {units.map(unit => {
              const isEditing = editingId === unit.id;
              return (
                <tr key={unit.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-white">
                    {isEditing ? (
                      <input className="bg-slate-900 border border-slate-600 rounded p-1 w-full text-white" value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} />
                    ) : unit.name}
                  </td>
                  <td className="px-6 py-4 text-slate-300">
                    {isEditing ? (
                       <select className="bg-slate-900 border border-slate-600 rounded p-1 w-full text-white" value={editForm.type} onChange={e => setEditForm({...editForm, type: e.target.value})}>
                        <option value="room">Pokój</option>
                        <option value="apartment">Apartament</option>
                        <option value="house">Domek</option>
                     </select>
                    ) : (
                      <span className="bg-slate-700 text-slate-200 text-xs px-2 py-1 rounded-full">{unit.type}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-slate-300">
                     {isEditing ? (
                       <input type="number" className="bg-slate-900 border border-slate-600 rounded p-1 w-20 text-white" value={editForm.capacity} onChange={e => setEditForm({...editForm, capacity: parseInt(e.target.value)})} />
                     ) : (
                       <span className="flex items-center gap-1"><Users size={14} className="text-slate-500"/> {unit.capacity}</span>
                     )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-2">
                         <button onClick={handleSave} className="p-1 bg-green-600 text-white rounded hover:bg-green-700"><Check size={16} /></button>
                         <button onClick={handleCancel} className="p-1 bg-slate-600 text-white rounded hover:bg-slate-700"><X size={16} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleEdit(unit)} className="text-slate-400 hover:text-indigo-400 p-1"><Edit2 size={16} /></button>
                        <button onClick={() => handleDelete(unit.id)} className="text-slate-400 hover:text-red-400 p-1"><Trash2 size={16} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            
            {!loading && units.length === 0 && editingId !== 'new' && (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                  Brak kwater w tym obiekcie. Dodaj pierwszą kwaterę powyżej.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};