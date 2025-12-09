import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Unit, Pricing, Availability } from '../types';
import { Plus, Trash2, Calendar as CalIcon, DollarSign, X } from 'lucide-react';

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
    const { data } = await supabase.from('units').select('*').eq('property_id', propertyId);
    if (data && data.length > 0) {
      setUnits(data);
      setSelectedUnitId(data[0].id);
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

  if (units.length === 0) return <div className="text-slate-500">Brak kwater. Dodaj najpierw kwatery.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <h2 className="text-2xl font-bold text-white">Cennik i Dostępność</h2>
        
        {/* Unit Selector */}
        <select 
          className="bg-slate-900 border border-border text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
          value={selectedUnitId}
          onChange={(e) => setSelectedUnitId(e.target.value)}
        >
          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* PRICING SECTION */}
        <div className="bg-surface rounded-xl border border-border p-6 flex flex-col h-full">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <DollarSign className="text-green-400" size={18} /> Cennik
            </h3>
            <button 
              onClick={() => setShowPricingForm(true)}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-md transition-colors"
            >
              + Dodaj zakres
            </button>
          </div>

          {showPricingForm && (
            <form onSubmit={addPricing} className="mb-4 bg-slate-900/50 p-4 rounded-lg border border-indigo-500/30">
              <div className="grid grid-cols-2 gap-2 mb-2">
                 <div>
                   <label className="text-xs text-slate-400">Od</label>
                   <input required type="date" className="w-full bg-slate-800 border-border rounded text-white text-xs p-1" value={newPrice.start} onChange={e => setNewPrice({...newPrice, start: e.target.value})} />
                 </div>
                 <div>
                   <label className="text-xs text-slate-400">Do</label>
                   <input required type="date" className="w-full bg-slate-800 border-border rounded text-white text-xs p-1" value={newPrice.end} onChange={e => setNewPrice({...newPrice, end: e.target.value})} />
                 </div>
              </div>
              <div className="mb-2">
                 <label className="text-xs text-slate-400">Cena (PLN)</label>
                 <input required type="number" className="w-full bg-slate-800 border-border rounded text-white text-sm p-1" value={newPrice.price} onChange={e => setNewPrice({...newPrice, price: Number(e.target.value)})} />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowPricingForm(false)} className="text-xs text-slate-400">Anuluj</button>
                <button type="submit" className="text-xs bg-green-600 text-white px-3 py-1 rounded">Zapisz</button>
              </div>
            </form>
          )}

          <div className="flex-1 overflow-auto">
            {pricingList.length === 0 ? <p className="text-sm text-slate-500 italic">Brak cenników.</p> : (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500 border-b border-border">
                  <tr>
                    <th className="text-left py-2">Zakres dat</th>
                    <th className="text-right py-2">Cena</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pricingList.map(p => (
                    <tr key={p.id}>
                      <td className="py-2 text-slate-300">{p.start_date} - {p.end_date}</td>
                      <td className="py-2 text-right font-mono text-green-400">{p.price_per_night} PLN</td>
                      <td className="text-right">
                        <button onClick={() => deletePricing(p.id)} className="text-slate-500 hover:text-red-400"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* AVAILABILITY SECTION */}
        <div className="bg-surface rounded-xl border border-border p-6 flex flex-col h-full">
           <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <CalIcon className="text-orange-400" size={18} /> Wyjątki dostępności
            </h3>
            <button 
              onClick={() => setShowAvailForm(true)}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-md transition-colors"
            >
              + Zmień status
            </button>
          </div>

          {showAvailForm && (
            <form onSubmit={addAvailability} className="mb-4 bg-slate-900/50 p-4 rounded-lg border border-indigo-500/30">
               <div className="mb-2">
                   <label className="text-xs text-slate-400">Data</label>
                   <input required type="date" className="w-full bg-slate-800 border-border rounded text-white text-sm p-1" value={newAvail.date} onChange={e => setNewAvail({...newAvail, date: e.target.value})} />
               </div>
               <div className="mb-2">
                   <label className="text-xs text-slate-400">Status</label>
                   <select className="w-full bg-slate-800 border-border rounded text-white text-sm p-1" value={newAvail.status} onChange={e => setNewAvail({...newAvail, status: e.target.value})}>
                     <option value="booked">Zarezerwowane (Booked)</option>
                     <option value="blocked">Zablokowane (Blocked)</option>
                     <option value="available">Dostępne</option>
                   </select>
               </div>
               <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAvailForm(false)} className="text-xs text-slate-400">Anuluj</button>
                <button type="submit" className="text-xs bg-green-600 text-white px-3 py-1 rounded">Zapisz</button>
              </div>
            </form>
          )}

          <div className="flex-1 overflow-auto">
             <p className="text-xs text-slate-500 mb-2">Domyślnie kwatera jest dostępna. Tutaj widać dni zablokowane.</p>
             {availabilityList.length === 0 ? <p className="text-sm text-slate-500 italic">Brak blokad.</p> : (
               <div className="space-y-2">
                 {availabilityList.map(a => (
                   <div key={a.id} className="flex items-center justify-between p-2 bg-slate-900/50 rounded border border-border">
                      <span className="text-slate-300 text-sm">{a.date}</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-0.5 rounded uppercase font-bold ${a.status === 'booked' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'}`}>
                          {a.status}
                        </span>
                        <button onClick={() => deleteAvailability(a.id)} className="text-slate-500 hover:text-red-400"><X size={14} /></button>
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