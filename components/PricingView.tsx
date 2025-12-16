import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { RefreshCw, Trash2, Edit2, Loader2, ImageOff, ChevronDown, Save, X, Utensils, CalendarClock } from 'lucide-react';
import { RatePlan, Property } from '../types';
import { useProperties } from '../contexts/PropertyContext';

const BoardTypeBadge: React.FC<{ type: string | null }> = ({ type }) => {
    const map: Record<string, string> = {
        'RO': 'Bez wyżywienia',
        'BB': 'Śniadanie',
        'DI': 'Obiadokolacja',
        'HB': 'Śniadanie + Obiadokolacja',
        'FB': 'Pełne wyżywienie',
        'AI': 'All Inclusive'
    };
    const label = type && map[type] ? map[type] : (type || 'Brak danych');
    
    return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 text-indigo-300 border border-slate-700">
            <Utensils size={12} /> {label} ({type || '-'})
        </span>
    );
};

export const PricingView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [rates, setRates] = useState<RatePlan[]>([]);
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedRateId, setExpandedRateId] = useState<string | null>(null);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<RatePlan>>({});

  const { syncRates } = useProperties();

  useEffect(() => {
    if (propertyId) {
      fetchProperty();
      fetchRates();
    }
  }, [propertyId]);

  const fetchProperty = async () => {
    if (!propertyId) return;
    const { data } = await supabase.from('properties').select('*').eq('id', propertyId).single();
    setProperty(data);
  }

  const fetchRates = async () => {
    if (!propertyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('rate_plans')
      .select('*')
      .eq('property_id', propertyId)
      .order('name');
    
    if (!error) setRates(data || []);
    setLoading(false);
  };
  
  const handleEditClick = (rate: RatePlan) => {
    setEditingRateId(rate.id);
    setEditFormData({ ...rate }); 
    setExpandedRateId(rate.id); 
  };

  const handleCancelEdit = () => {
    setEditingRateId(null);
    setEditFormData({});
  };
  
  const handleSaveEdit = async () => {
    if (!editingRateId) return;
    const { error } = await supabase
      .from('rate_plans')
      .update({
          name: editFormData.name,
          description: editFormData.description,
          board_type: editFormData.board_type,
          min_stay: editFormData.min_stay,
          max_stay: editFormData.max_stay,
          photo_url: editFormData.photo_url
      })
      .eq('id', editingRateId);

    if (error) {
      alert('Błąd zapisu: ' + error.message);
    } else {
      setRates(rates.map(r => r.id === editingRateId ? { ...r, ...editFormData } as RatePlan : r));
      handleCancelEdit();
    }
  };
  
  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    // Bezpieczne sprawdzanie typu
    const isNumber = type === 'number';
    setEditFormData(prev => ({
      ...prev,
      [name]: isNumber ? (value === '' ? null : Number(value)) : value
    }));
  };

  const handleSync = async () => {
    if (!property) return;
    
    if (!property.hotres_id) {
      alert("Nie znaleziono OID w ustawieniach obiektu. Przejdź do 'Ustawień' i wpisz ID Hotres.");
      return;
    }
    
    setIsSyncing(true);
    try {
      const msg = await syncRates(property.hotres_id, property.id);
      alert(msg);
      await fetchRates();
    } catch (err: any) {
      alert(`Błąd synchronizacji: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  }

  const handleDelete = async (e: React.MouseEvent, rateId: string) => {
    e.stopPropagation();
    if (!confirm('Usunąć cennik?')) return;
    const { error } = await supabase.from('rate_plans').delete().eq('id', rateId);
    if (!error) {
      setRates(rates.filter(r => r.id !== rateId));
    }
  };

  const handleToggleRow = (rateId: string) => {
    if (editingRateId === rateId) return; // Don't collapse while editing
    setExpandedRateId(currentId => (currentId === rateId ? null : rateId));
  };
  
  const isImported = !!property?.hotres_id;

  const renderDisplayRow = (rate: RatePlan) => (
    <tr onClick={() => handleToggleRow(rate.id)} className="hover:bg-slate-800/50 transition-colors cursor-pointer group">
      <td className="px-4 py-3 text-center">
        <ChevronDown size={16} className={`text-slate-600 transition-transform duration-200 ${expandedRateId === rate.id ? 'rotate-180' : ''}`} />
      </td>
      <td className="px-4 py-3">
        {rate.photo_url ? (
          <img src={rate.photo_url} alt={rate.name} className="w-16 h-10 object-cover rounded bg-slate-800" />
        ) : (
          <div className="w-16 h-10 flex items-center justify-center bg-slate-800 rounded">
            <ImageOff size={16} className="text-slate-600" />
          </div>
        )}
      </td>
      <td className="px-4 py-4 font-medium text-white">
        {rate.name}
        <div className="text-[10px] font-mono text-slate-500 mt-0.5">ID: {rate.external_id || 'lokalne'}</div>
      </td>
      <td className="px-4 py-4">
        <BoardTypeBadge type={rate.board_type} />
      </td>
      <td className="px-4 py-4 text-slate-300 text-sm">
        <div className="flex items-center gap-2" title="Min/Max długość pobytu">
            <CalendarClock size={14} className="text-slate-500"/>
            {rate.min_stay} - {rate.max_stay} dni
        </div>
      </td>
      <td className="px-4 py-4 text-right">
        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); handleEditClick(rate); }} title="Edytuj" className="text-slate-400 hover:text-indigo-400 p-2 rounded-md transition-colors hover:bg-indigo-500/10"><Edit2 size={16} /></button>
          <button onClick={(e) => handleDelete(e, rate.id)} title="Usuń" className="text-slate-400 hover:text-red-400 p-2 rounded-md transition-colors hover:bg-red-500/10"><Trash2 size={16} /></button>
        </div>
      </td>
    </tr>
  );

  const renderEditRow = (rate: RatePlan) => (
    <tr className="bg-slate-800">
       <td className="px-4 py-3 text-center"><Edit2 size={16} className="text-indigo-400" /></td>
       <td className="px-4 py-3">
         <input type="text" name="photo_url" value={editFormData.photo_url || ''} onChange={handleFormChange} className="w-24 bg-slate-900 border border-border text-white rounded p-1 text-xs" placeholder="URL zdjęcia"/>
       </td>
       <td className="px-4 py-3"><input type="text" name="name" value={editFormData.name || ''} onChange={handleFormChange} className="w-full bg-slate-900 border border-border text-white rounded p-1 text-sm"/></td>
       <td className="px-4 py-3">
         <select name="board_type" value={editFormData.board_type || ''} onChange={handleFormChange} className="bg-slate-900 border border-border text-white rounded p-1 text-xs w-full">
            <option value="">Wybierz...</option>
            <option value="RO">Bez wyżywienia (RO)</option>
            <option value="BB">Śniadanie (BB)</option>
            <option value="DI">Obiadokolacja (DI)</option>
            <option value="HB">Śniadanie + Obiadokolacja (HB)</option>
            <option value="FB">Pełne (FB)</option>
            <option value="AI">All Inclusive (AI)</option>
         </select>
       </td>
       <td className="px-4 py-3">
           <div className="flex items-center gap-1">
               <input type="number" name="min_stay" value={editFormData.min_stay ?? ''} onChange={handleFormChange} className="w-12 bg-slate-900 border border-border text-white rounded p-1 text-sm text-center"/>
               <span className="text-slate-500">-</span>
               <input type="number" name="max_stay" value={editFormData.max_stay ?? ''} onChange={handleFormChange} className="w-12 bg-slate-900 border border-border text-white rounded p-1 text-sm text-center"/>
           </div>
       </td>
       <td className="px-4 py-3 text-right">
         <div className="flex items-center justify-end gap-2">
           <button onClick={handleSaveEdit} title="Zapisz" className="text-green-400 hover:text-green-300 p-2 rounded-md transition-colors hover:bg-green-500/10"><Save size={16} /></button>
           <button onClick={handleCancelEdit} title="Anuluj" className="text-slate-400 hover:text-white p-2 rounded-md transition-colors hover:bg-slate-700"><X size={16} /></button>
         </div>
       </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white">Cenniki i Oferty</h2>
          <p className="text-slate-400 text-sm mt-1">Zarządzaj ofertami specjalnymi i planami cenowymi.</p>
        </div>
        {isImported && (
          <div className="flex-shrink-0">
            <button 
              onClick={handleSync}
              disabled={isSyncing}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-wait text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors text-sm"
            >
              {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {isSyncing ? 'Pobieram...' : 'Pobierz z Hotres'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/50 text-slate-400 uppercase tracking-wider font-semibold border-b border-border">
            <tr>
              <th className="px-4 py-4 w-10"></th>
              <th className="px-4 py-4 w-20">Foto</th>
              <th className="px-4 py-4">Nazwa Oferty</th>
              <th className="px-4 py-4">Wyżywienie</th>
              <th className="px-4 py-4">Pobyt (dni)</th>
              <th className="px-4 py-4 text-right">Akcje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rates.map(rate => (
              <React.Fragment key={rate.id}>
                {editingRateId === rate.id ? renderEditRow(rate) : renderDisplayRow(rate)}
                
                {expandedRateId === rate.id && (
                  <tr className="bg-slate-900/70">
                    <td colSpan={6} className="p-0">
                      <div className="p-6 border-t-2 border-indigo-500">
                        <h4 className="text-sm font-bold text-white mb-2">Opis oferty / Reklama</h4>
                         {editingRateId === rate.id ? (
                              <textarea
                                name="description"
                                value={editFormData.description || ''}
                                onChange={handleFormChange}
                                rows={4}
                                className="w-full bg-slate-900 border border-border text-white rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none resize-y text-sm"
                              />
                           ) : (
                             <div className="text-sm prose max-w-none text-slate-300" dangerouslySetInnerHTML={{ __html: rate.description || '<p class="italic text-slate-500">Brak opisu.</p>' }} />
                           )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            
            {!loading && rates.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-500 italic">
                  {isImported ? "Brak cenników. Użyj przycisku 'Pobierz z Hotres', aby je zaimportować." : "Brak cenników."}
                </td>
              </tr>
            )}
             {loading && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                  <Loader2 className="animate-spin inline-block mr-2" /> Ładowanie cenników...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};