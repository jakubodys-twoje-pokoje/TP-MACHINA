import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { RefreshCw, Trash2, Edit2, Users, Key, Bed, Sofa, Loader2, ImageOff, Ruler, Layers, Bath, ChevronDown, Save, X, Plus, Tag } from 'lucide-react';
import { Unit, Property } from '../types';
import { useProperties } from '../contexts/PropertyContext';

const BedDetails: React.FC<{ unit: Unit }> = ({ unit }) => {
  const details = [
    { count: unit.beds_double, icon: Bed, label: 'Podwójne' },
    { count: unit.beds_single, icon: Bed, label: 'Pojedyncze' },
    { count: unit.beds_sofa, icon: Sofa, label: 'Sofa' },
    { count: unit.beds_sofa_single, icon: Sofa, label: 'Sofa poj.' },
  ].filter(d => d.count && d.count > 0);

  if (details.length === 0) return <span className="text-slate-500">—</span>;

  return (
    <div className="flex items-center gap-3 text-xs">
      {details.map((d, i) => (
        <span key={i} className="flex items-center gap-1 text-slate-400" title={`${d.count} x ${d.label}`}>
          <d.icon size={14} />
          {d.count}
        </span>
      ))}
    </div>
  );
}

export const UnitsView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [units, setUnits] = useState<Unit[]>([]);
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<Unit>>({});
  const [newFacility, setNewFacility] = useState('');
  const [newTag, setNewTag] = useState('');

  const { importFromHotres } = useProperties();

  useEffect(() => {
    if (propertyId) {
      fetchProperty();
      fetchUnits();
    }
  }, [propertyId]);

  const fetchProperty = async () => {
    if (!propertyId) return;
    const { data } = await supabase.from('properties').select('*').eq('id', propertyId).single();
    setProperty(data);
  }

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
  
  const handleEditClick = (unit: Unit) => {
    setEditingUnitId(unit.id);
    setEditFormData({ ...unit }); 
    setExpandedUnitId(unit.id); 
  };

  const handleCancelEdit = () => {
    setEditingUnitId(null);
    setEditFormData({});
    setNewFacility('');
    setNewTag('');
  };
  
  const handleSaveEdit = async () => {
    if (!editingUnitId) return;
    const { error } = await supabase
      .from('units')
      .update(editFormData)
      .eq('id', editingUnitId);

    if (error) {
      alert('Błąd zapisu: ' + error.message);
    } else {
      setUnits(units.map(u => u.id === editingUnitId ? { ...u, ...editFormData } as Unit : u));
      handleCancelEdit();
    }
  };
  
  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    // Bezpieczne sprawdzanie typu
    const isNumber = type === 'number';
    setEditFormData(prev => ({
      ...prev,
      [name]: isNumber ? (value === '' ? null : Number(value)) : value
    }));
  };
  
  // Facilities Logic
  const handleDeleteFacility = (facilityToRemove: string) => {
    const currentFacilities = (editFormData.facilities || '').split(',').map(f => f.trim());
    const newFacilities = currentFacilities.filter(f => f !== facilityToRemove).join(', ');
    setEditFormData(prev => ({ ...prev, facilities: newFacilities }));
  };

  const handleAddFacility = () => {
      if (!newFacility.trim()) return;
      const currentFacilities = (editFormData.facilities || '').split(',').map(f => f.trim()).filter(Boolean);
      if (currentFacilities.map(f => f.toLowerCase()).includes(newFacility.trim().toLowerCase())) {
          alert("To udogodnienie już istnieje.");
          return;
      }
      const newFacilities = [...currentFacilities, newFacility.trim()].join(', ');
      setEditFormData(prev => ({ ...prev, facilities: newFacilities }));
      setNewFacility('');
  };

  // Tags Logic
  const handleDeleteTag = (tagToRemove: string) => {
    const currentTags = (editFormData.tags || '').split(',').map(t => t.trim());
    const newTags = currentTags.filter(t => t !== tagToRemove).join(', ');
    setEditFormData(prev => ({ ...prev, tags: newTags }));
  };

  const handleAddTag = () => {
      if (!newTag.trim()) return;
      const currentTags = (editFormData.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      if (currentTags.map(t => t.toLowerCase()).includes(newTag.trim().toLowerCase())) {
          alert("Ten tag już istnieje.");
          return;
      }
      const newTags = [...currentTags, newTag.trim()].join(', ');
      setEditFormData(prev => ({ ...prev, tags: newTags }));
      setNewTag('');
  };


  const handleSync = async () => {
    if (!property) return;
    
    // Bezpośrednie użycie hotres_id
    if (!property.hotres_id) {
      alert("Nie znaleziono OID w ustawieniach obiektu. Przejdź do 'Ustawień' i wpisz ID Hotres.");
      return;
    }
    
    setIsSyncing(true);
    try {
      await importFromHotres(property.hotres_id, property.id);
      await fetchUnits();
    } catch (err: any) {
      alert(`Błąd synchronizacji: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  }

  const handleDelete = async (e: React.MouseEvent, unitId: string) => {
    e.stopPropagation();
    if (!confirm('Usunąć kwaterę? Ta akcja jest nieodwracalna.')) return;
    const { error } = await supabase.from('units').delete().eq('id', unitId);
    if (!error) {
      setUnits(units.filter(u => u.id !== unitId));
    }
  };

  const handleToggleRow = (unitId: string) => {
    if (editingUnitId === unitId) return; // Don't collapse while editing
    setExpandedUnitId(currentId => (currentId === unitId ? null : unitId));
  };
  
  const isImported = !!property?.hotres_id; // Sprawdzamy czy OID istnieje w nowym polu

  const renderDisplayRow = (unit: Unit) => (
    <tr onClick={() => handleToggleRow(unit.id)} className="hover:bg-slate-800/50 transition-colors cursor-pointer group">
      <td className="px-4 py-3 text-center">
        <ChevronDown size={16} className={`text-slate-600 transition-transform duration-200 ${expandedUnitId === unit.id ? 'rotate-180' : ''}`} />
      </td>
      <td className="px-4 py-3">
        {unit.photo_url ? (
          <img src={unit.photo_url} alt={unit.name} className="w-12 h-12 object-cover rounded-md bg-slate-800" />
        ) : (
          <div className="w-12 h-12 flex items-center justify-center bg-slate-800 rounded-md">
            <ImageOff size={20} className="text-slate-600" />
          </div>
        )}
      </td>
      <td className="px-4 py-4 font-medium text-white">
        {unit.name}
        {unit.tags && (
          <div className="flex flex-wrap gap-1 mt-1">
             {unit.tags.split(',').slice(0, 2).map(tag => (
                <span key={tag} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">{tag.trim()}</span>
             ))}
             {unit.tags.split(',').length > 2 && <span className="text-[10px] text-slate-600">+{unit.tags.split(',').length - 2}</span>}
          </div>
        )}
      </td>
      <td className="px-4 py-4 text-slate-400 font-mono text-xs">
        <span className="flex items-center gap-2">
            <Key size={14}/>
            <div>
                <div>{unit.external_id} <span className="text-slate-600">(pokój)</span></div>
                <div className="mt-1 font-bold text-indigo-300">{unit.external_type_id} <span className="text-slate-500 font-normal">(typ)</span></div>
            </div>
        </span>
      </td>
      <td className="px-4 py-4 text-slate-300">
        {unit.max_adults ? <span className="flex items-center gap-1.5"><Users size={14} className="text-slate-500"/> {unit.max_adults}</span> : <span className="text-slate-500">—</span>}
      </td>
      <td className="px-4 py-4 text-slate-300"><BedDetails unit={unit} /></td>
      <td className="px-4 py-4 text-slate-300">
        {unit.area ? <span className="flex items-center gap-1.5"><Ruler size={14} className="text-slate-500"/> {unit.area} m²</span> : <span className="text-slate-500">—</span>}
      </td>
      <td className="px-4 py-4 text-slate-300">
        {unit.floor !== null && unit.floor !== undefined ? <span className="flex items-center gap-1.5"><Layers size={14} className="text-slate-500"/> {unit.floor}</span> : <span className="text-slate-500">—</span>}
      </td>
      <td className="px-4 py-4 text-slate-300">
        {unit.bathroom_count ? <span className="flex items-center gap-1.5"><Bath size={14} className="text-slate-500"/> {unit.bathroom_count}</span> : <span className="text-slate-500">—</span>}
      </td>
      <td className="px-4 py-4 text-right">
        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); handleEditClick(unit); }} title="Edytuj" className="text-slate-400 hover:text-indigo-400 p-2 rounded-md transition-colors hover:bg-indigo-500/10"><Edit2 size={16} /></button>
          <button onClick={(e) => handleDelete(e, unit.id)} title="Usuń" className="text-slate-400 hover:text-red-400 p-2 rounded-md transition-colors hover:bg-red-500/10"><Trash2 size={16} /></button>
        </div>
      </td>
    </tr>
  );

  const renderEditRow = (unit: Unit) => (
    <tr className="bg-slate-800">
       <td className="px-4 py-3 text-center"><Edit2 size={16} className="text-indigo-400" /></td>
       <td className="px-4 py-3">
         <input type="text" name="photo_url" value={editFormData.photo_url || ''} onChange={handleFormChange} className="w-24 bg-slate-900 border border-border text-white rounded p-1 text-xs" placeholder="URL zdjęcia"/>
       </td>
       <td className="px-4 py-3"><input type="text" name="name" value={editFormData.name || ''} onChange={handleFormChange} className="w-full bg-slate-900 border border-border text-white rounded p-1 text-sm"/></td>
       <td className="px-4 py-3">
          <div className="space-y-1">
             <input type="text" name="external_id" value={editFormData.external_id || ''} onChange={handleFormChange} className="w-20 bg-slate-900 border border-border text-white rounded p-1 text-xs font-mono" placeholder="ID Pokój"/>
             <input type="text" name="external_type_id" value={editFormData.external_type_id || ''} onChange={handleFormChange} className="w-20 bg-slate-900 border border-indigo-500/50 text-indigo-200 rounded p-1 text-xs font-mono" placeholder="ID Typ"/>
          </div>
       </td>
       <td className="px-4 py-3"><input type="number" name="max_adults" value={editFormData.max_adults ?? ''} onChange={handleFormChange} className="w-16 bg-slate-900 border border-border text-white rounded p-1 text-sm"/></td>
       <td className="px-4 py-3"></td>
       <td className="px-4 py-3"><input type="number" name="area" value={editFormData.area ?? ''} onChange={handleFormChange} className="w-16 bg-slate-900 border border-border text-white rounded p-1 text-sm"/></td>
       <td className="px-4 py-3"><input type="number" name="floor" value={editFormData.floor ?? ''} onChange={handleFormChange} className="w-16 bg-slate-900 border border-border text-white rounded p-1 text-sm"/></td>
       <td className="px-4 py-3"><input type="number" name="bathroom_count" value={editFormData.bathroom_count ?? ''} onChange={handleFormChange} className="w-16 bg-slate-900 border border-border text-white rounded p-1 text-sm"/></td>
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
          <h2 className="text-2xl font-bold text-white">Kwatery / Pokoje</h2>
          <p className="text-slate-400 text-sm mt-1">Zarządzaj pokojami w tym obiekcie</p>
        </div>
        {isImported && (
          <div className="flex-shrink-0">
            <button 
              onClick={handleSync}
              disabled={isSyncing}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-wait text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors text-sm"
            >
              {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {isSyncing ? 'Synchronizuję...' : 'Synchronizuj z Hotres'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/50 text-slate-400 uppercase tracking-wider font-semibold border-b border-border">
            <tr>
              <th className="px-4 py-4 w-10"></th>
              <th className="px-4 py-4 w-16">Zdjęcie</th>
              <th className="px-4 py-4">Nazwa</th>
              <th className="px-4 py-4">ID Hotres</th>
              <th className="px-4 py-4">Max. Osób</th>
              <th className="px-4 py-4">Szczegóły łóżek</th>
              <th className="px-4 py-4">Metraż</th>
              <th className="px-4 py-4">Piętro</th>
              <th className="px-4 py-4">Łazienki</th>
              <th className="px-4 py-4 text-right">Akcje</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {units.map(unit => (
              <React.Fragment key={unit.id}>
                {editingUnitId === unit.id ? renderEditRow(unit) : renderDisplayRow(unit)}
                
                {expandedUnitId === unit.id && (
                  <tr className="bg-slate-900/70">
                    <td colSpan={10} className="p-0">
                      <div className="p-6 flex flex-col gap-6 border-t-2 border-indigo-500">
                        
                        {/* DESCRIPTION SECTION */}
                        <div>
                           <h4 className="text-sm font-bold text-white mb-3">Opis kwatery</h4>
                           {editingUnitId === unit.id ? (
                              <textarea
                                name="description"
                                value={editFormData.description || ''}
                                onChange={handleFormChange}
                                rows={6}
                                className="w-full bg-slate-900 border border-border text-white rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none resize-y text-sm"
                              />
                           ) : (
                             <div className="text-sm prose" dangerouslySetInnerHTML={{ __html: unit.description || '<p class="italic text-slate-500">Brak opisu.</p>' }} />
                           )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-border pt-6">
                            {/* FACILITIES SECTION */}
                            <div>
                                <h4 className="text-sm font-bold text-white mb-3">Udogodnienia</h4>
                                {editingUnitId === unit.id ? (
                                    <div>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        {(editFormData.facilities || '').split(',').filter(f => f.trim()).map(facility => (
                                        <div key={facility} className="bg-slate-700 text-slate-300 text-xs font-medium pl-3 pr-2 py-1 rounded-full flex items-center gap-2">
                                            {facility.trim()}
                                            <button onClick={() => handleDeleteFacility(facility.trim())} className="text-slate-400 hover:text-white transition-colors">
                                            <X size={14} />
                                            </button>
                                        </div>
                                        ))}
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        <input
                                        type="text"
                                        value={newFacility}
                                        onChange={(e) => setNewFacility(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddFacility())}
                                        placeholder="Nowe udogodnienie"
                                        className="flex-grow bg-slate-800 border border-border text-white rounded-lg p-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                                        />
                                        <button type="button" onClick={handleAddFacility} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-1 transition-colors">
                                        <Plus size={16} />
                                        </button>
                                    </div>
                                    </div>
                                ) : (
                                    unit.facilities ? (
                                    <div className="flex flex-wrap gap-2">
                                        {unit.facilities.split(',').map(name => (
                                        <span key={name} className="bg-slate-700 text-slate-300 text-xs font-medium px-2.5 py-1.5 rounded-full">
                                            {name.trim()}
                                        </span>
                                        ))}
                                    </div>
                                    ) : (
                                    <p className="italic text-slate-500 text-sm">Brak danych o udogodnieniach.</p>
                                    )
                                )}
                            </div>

                            {/* TAGS SECTION */}
                            <div>
                                <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Tag size={16}/> Tagi (wewnętrzne)</h4>
                                {editingUnitId === unit.id ? (
                                    <div>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        {(editFormData.tags || '').split(',').filter(t => t.trim()).map(tag => (
                                        <div key={tag} className="bg-indigo-900/40 text-indigo-200 border border-indigo-500/30 text-xs font-medium pl-3 pr-2 py-1 rounded-md flex items-center gap-2">
                                            {tag.trim()}
                                            <button onClick={() => handleDeleteTag(tag.trim())} className="text-indigo-400 hover:text-white transition-colors">
                                            <X size={14} />
                                            </button>
                                        </div>
                                        ))}
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        <input
                                        type="text"
                                        value={newTag}
                                        onChange={(e) => setNewTag(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                                        placeholder="Nowy tag (np. VIP, Remont)"
                                        className="flex-grow bg-slate-800 border border-border text-white rounded-lg p-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                                        />
                                        <button type="button" onClick={handleAddTag} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 text-sm font-medium rounded-lg flex items-center gap-1 transition-colors">
                                        <Plus size={16} />
                                        </button>
                                    </div>
                                    </div>
                                ) : (
                                    unit.tags ? (
                                    <div className="flex flex-wrap gap-2">
                                        {unit.tags.split(',').map(tag => (
                                        <span key={tag} className="bg-indigo-900/30 border border-indigo-500/30 text-indigo-300 text-xs font-medium px-2.5 py-1.5 rounded-md">
                                            {tag.trim()}
                                        </span>
                                        ))}
                                    </div>
                                    ) : (
                                    <p className="italic text-slate-500 text-sm">Brak tagów.</p>
                                    )
                                )}
                            </div>
                        </div>

                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
              )
            )}
            
            {!loading && units.length === 0 && (
              <tr>
                <td colSpan={10} className="px-6 py-12 text-center text-slate-500 italic">
                  {isImported ? "Brak kwater. Użyj przycisku 'Synchronizuj z Hotres', aby je pobrać." : "Brak kwater w tym obiekcie."}
                </td>
              </tr>
            )}
             {loading && (
              <tr>
                <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                  <Loader2 className="animate-spin inline-block mr-2" /> Ładowanie kwater...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
