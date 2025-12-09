import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Unit, Pricing, Availability } from '../types';
import { Plus, Trash2, Calendar as CalIcon, DollarSign, X, AlertCircle } from 'lucide-react';

export const CalendarView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [pricingList, setPricingList] = useState<Pricing[]>([]);
  const [availabilityList, setAvailabilityList] = useState<Availability[]>([]);
  
  // Forms
  const [showPricingForm, setShowPricingForm] = useState(false);
  const [newPrice, setNewPrice] = useState({ start: '', end: '', price: 0 });

  const [showAvailForm, setShowAvailForm] = useState(false);
  const [newAvail, setNewAvail] = useState({ date: '', status: 'booked' });

  useEffect(() => {
    if (propertyId) fetchUnits();
  }, [propertyId]);

  useEffect(() => {
    if (selectedUnitId) {
      fetchPricing(selectedUnitId);
      fetchAvailability(selectedUnitId);
    }
  }, [selectedUnitId]);

  const fetchUnits = async () => {
    if (!propertyId) return;
    const { data } = await supabase
      .from('units')
      .select('*')
      .eq('property_id', propertyId)
      .order('name'); // Sort for consistency

    if (data && data.length > 0) {
      setUnits(data);
      // If we don't have a selected unit yet, or the selected unit is not in the new list (unlikely but possible), pick the first one
      if (!selectedUnitId || !data.find(u => u.id === selectedUnitId)) {
          setSelectedUnitId(data[0].id);
      }
    } else {
        setUnits([]);
        setSelectedUnitId('');
    }
  };

  const fetchPricing = async (unitId: string) => {
    const { data } = await supabase.from('pricing').select('*').eq('unit_id', unitId).order('start_date');
    if (data) setPricingList(data);
  };

  const fetchAvailability = async (unitId: string) => {
    // Only fetching booked/blocked for simplicity list
    const { data } = await supabase.from('availability').select('*').eq('unit_id', unitId).neq('status', 'available').order('date');
    if (data) setAvailabilityList(data);
  };

  const addPricing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUnitId) return;
    const { error } = await supabase.from('pricing').insert([{
      unit_id: selectedUnitId,
      start_date: newPrice.start,
      end_date: newPrice.end,
      price_per_night: newPrice.price
    }]);

    if (!error) {
      fetchPricing(selectedUnitId);
      setShowPricingForm(false);
      setNewPrice({ start: '', end: '', price: 0 });
    } else {
      alert('Błąd dodawania ceny (sprawdź czy daty są poprawne)');
    }
  };

  const deletePricing = async (id: string) => {
    await supabase.from('pricing').delete().eq('id', id);
    fetchPricing(selectedUnitId);
  };

  const addAvailability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUnitId) return;
    
    // Upsert logic for availability
    const { error } = await supabase.from('availability').upsert({
      unit_id: selectedUnitId,
      date: newAvail.date,
      status: newAvail.status
    }, { onConflict: 'unit_id, date' });

    if (!error) {
      fetchAvailability(selectedUnitId);
      setShowAvailForm(false);
    } else {
      alert('Błąd zmiany statusu');
    }
  };

   const deleteAvailability = async (id: string) => {
    // Deleting actually means setting it back to available (or removing record)
    await supabase.from('availability').delete().eq('id', id);
    fetchAvailability(selectedUnitId);
  };

  if (units.length === 0) return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
          <AlertCircle size={48} className="mb-4 text-slate-600" />
          <p className="text-lg font-medium">Brak kwater w tym obiekcie.</p>
          <p className="text-sm">Przejdź do zakładki "Kwatery", aby dodać pokoje.</p>
      </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h2 className="text-2xl font-bold text-white">Cennik i Dostępność</h2>
        
        {/* Unit Selector */}
        <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400 uppercase font-bold tracking-wider">Wybierz kwaterę:</span>
            <select 
            className="bg-slate-900 border border-slate-700 text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 min-w-[200px]"
            value={selectedUnitId}
            onChange={(e) => setSelectedUnitId(e.target.value)}
            >
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* PRICING SECTION */}
        <div className="bg-surface rounded-xl border border-border p-6 flex flex-col h-full shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                 <DollarSign className="text-green-400" size={18} /> 
              </div>
              Cennik
            </h3>
            <button 
              onClick={() => setShowPricingForm(true)}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg transition-colors font-medium flex items-center gap-1 shadow-lg shadow-indigo-900/20"
            >
              <Plus size={14} /> Dodaj zakres
            </button>
          </div>

          {showPricingForm && (
            <form onSubmit={addPricing} className="mb-6 bg-slate-900/50 p-4 rounded-xl border border-indigo-500/30 animate-in fade-in slide-in-from-top-2">
              <div className="grid grid-cols-2 gap-3 mb-3">
                 <div>
                   <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">Od</label>
                   <input required type="date" className="w-full bg-slate-800 border-border rounded-lg text-white text-sm p-2 outline-none focus:ring-1 focus:ring-indigo-500" value={newPrice.start} onChange={e => setNewPrice({...newPrice, start: e.target.value})} />
                 </div>
                 <div>
                   <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">Do</label>
                   <input required type="date" className="w-full bg-slate-800 border-border rounded-lg text-white text-sm p-2 outline-none focus:ring-1 focus:ring-indigo-500" value={newPrice.end} onChange={e => setNewPrice({...newPrice, end: e.target.value})} />
                 </div>
              </div>
              <div className="mb-4">
                 <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">Cena (PLN)</label>
                 <input required type="number" className="w-full bg-slate-800 border-border rounded-lg text-white text-sm p-2 outline-none focus:ring-1 focus:ring-indigo-500" value={newPrice.price} onChange={e => setNewPrice({...newPrice, price: Number(e.target.value)})} />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowPricingForm(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors">Anuluj</button>
                <button type="submit" className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-500 text-white rounded-md font-medium shadow-lg shadow-green-900/20 transition-colors">Zapisz</button>
              </div>
            </form>
          )}

          <div className="flex-1 overflow-auto pr-2 custom-scrollbar">
            {pricingList.length === 0 ? <p className="text-sm text-slate-500 italic text-center py-8">Brak zdefiniowanych cen dla tego pokoju.</p> : (
              <table className="w-full text-sm border-collapse">
                <thead className="text-xs text-slate-500 border-b border-slate-700/50 uppercase tracking-wider">
                  <tr>
                    <th className="text-left py-2 font-semibold">Zakres dat</th>
                    <th className="text-right py-2 font-semibold">Cena</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {pricingList.map(p => (
                    <tr key={p.id} className="group hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 text-slate-300 font-medium">{p.start_date} <span className="text-slate-600 mx-1">➜</span> {p.end_date}</td>
                      <td className="py-3 text-right font-mono text-green-400 font-bold">{p.price_per_night} PLN</td>
                      <td className="text-right py-3">
                        <button onClick={() => deletePricing(p.id)} className="text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 p-1"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* AVAILABILITY SECTION */}
        <div className="bg-surface rounded-xl border border-border p-6 flex flex-col h-full shadow-lg">
           <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                <CalIcon className="text-orange-400" size={18} />
              </div>
               Wyjątki dostępności
            </h3>
            <button 
              onClick={() => setShowAvailForm(true)}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg transition-colors font-medium flex items-center gap-1 shadow-lg shadow-indigo-900/20"
            >
              <Plus size={14} /> Zmień status
            </button>
          </div>

          {showAvailForm && (
            <form onSubmit={addAvailability} className="mb-6 bg-slate-900/50 p-4 rounded-xl border border-indigo-500/30 animate-in fade-in slide-in-from-top-2">
               <div className="mb-3">
                   <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">Data</label>
                   <input required type="date" className="w-full bg-slate-800 border-border rounded-lg text-white text-sm p-2 outline-none focus:ring-1 focus:ring-indigo-500" value={newAvail.date} onChange={e => setNewAvail({...newAvail, date: e.target.value})} />
               </div>
               <div className="mb-4">
                   <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">Status</label>
                   <select className="w-full bg-slate-800 border-border rounded-lg text-white text-sm p-2 outline-none focus:ring-1 focus:ring-indigo-500" value={newAvail.status} onChange={e => setNewAvail({...newAvail, status: e.target.value})}>
                     <option value="booked">Zarezerwowane (Booked)</option>
                     <option value="blocked">Zablokowane (Blocked)</option>
                     <option value="available">Dostępne (Available)</option>
                   </select>
               </div>
               <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAvailForm(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors">Anuluj</button>
                <button type="submit" className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-500 text-white rounded-md font-medium shadow-lg shadow-green-900/20 transition-colors">Zapisz</button>
              </div>
            </form>
          )}

          <div className="flex-1 overflow-auto pr-2 custom-scrollbar">
             <p className="text-xs text-slate-500 mb-4 bg-slate-900/30 p-2 rounded border border-slate-800">
               <span className="font-bold text-slate-400">INFO:</span> Domyślnie wszystkie terminy są <span className="text-green-500">dostępne</span>. Poniższa lista pokazuje dni wyłączone ze sprzedaży (rezerwacje lub blokady).
             </p>
             {availabilityList.length === 0 ? <p className="text-sm text-slate-500 italic text-center py-4">Brak blokad. Cały kalendarz dostępny.</p> : (
               <div className="space-y-2">
                 {availabilityList.map(a => (
                   <div key={a.id} className="flex items-center justify-between p-3 bg-slate-900/40 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors group">
                      <span className="text-slate-200 text-sm font-medium flex items-center gap-2">
                        <CalIcon size={14} className="text-slate-500" />
                        {a.date}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2.5 py-1 rounded-md uppercase font-bold tracking-wider ${a.status === 'booked' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                          {a.status}
                        </span>
                        <button onClick={() => deleteAvailability(a.id)} className="text-slate-600 hover:text-red-400 transition-colors p-1 opacity-0 group-hover:opacity-100"><X size={14} /></button>
                      </div>
                   </div>
                 ))}
               </div>
             )}
          </div>
        </div>

      </div>
    </div>
  );
};