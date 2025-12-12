import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Building, Settings, BedDouble, Calendar, Plus, Home, X, Globe, Type, Loader2, AlertTriangle, Bell } from 'lucide-react';
import { useProperties } from '../contexts/PropertyContext';

export const Sidebar: React.FC = () => {
  const { properties, loading, error, addProperty, importFromHotres, unreadCount } = useProperties();
  const navigate = useNavigate();
  const location = useLocation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'manual' | 'import'>('manual');
  const [formData, setFormData] = useState({ name: '', oid: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const pathParts = location.pathname.split('/');
  const activePropertyId = pathParts[1] === 'property' ? pathParts[2] : null;

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || (modalMode === 'import' && !formData.oid)) return;
    setIsSubmitting(true);

    try {
      const description = modalMode === 'import' ? `Zaimportowano z Hotres` : null;
      // Przekazujemy OID do nowej kolumny, jeśli tryb importu
      const hotresId = modalMode === 'import' ? formData.oid : null;
      
      const newProperty = await addProperty(formData.name, description, null, null, hotresId);
      
      if (!newProperty) throw new Error("Nie udało się utworzyć obiektu");

      if (modalMode === 'import' && formData.oid) {
        await importFromHotres(formData.oid, newProperty.id);
      }

      setIsModalOpen(false);
      setFormData({ name: '', oid: '' });
      setModalMode('manual');
      navigate(`/property/${newProperty.id}/units`);

    } catch (err: any) {
      alert(`Błąd: ${err.message}`);
      console.error(JSON.stringify(err, null, 2));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <div className="flex flex-col h-full">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3 text-indigo-400 mb-6">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <Building size={20} />
          </div>
          <span className="font-bold text-lg tracking-tight text-white">Machina</span>
        </div>
        <div className="relative">
          <button 
            onClick={() => setIsModalOpen(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-900/20 active:scale-95"
          >
            <Plus size={18} />
            <span className="font-medium">Nowy Obiekt</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1 custom-scrollbar">
        <NavLink to="/" className={({isActive}) => `flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors mb-4 ${isActive ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}>
          <div className="flex items-center gap-3"><Bell size={16} /> Panel główny</div>
          {unreadCount > 0 && (
            <span className="bg-red-600 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </NavLink>

        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-3 mb-2">Twoje Obiekty</div>
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="animate-spin text-slate-500" /></div>
        ) : error ? (
           <div className="p-3 mx-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
             <div className="flex items-center gap-2 font-bold mb-1"><AlertTriangle size={14} /> Błąd bazy danych</div>
             {error}
           </div>
        ) : properties.length === 0 ? (
          <div className="text-slate-500 text-sm text-center py-4 italic">Brak obiektów</div>
        ) : (
          properties.map(property => (
            <div key={property.id} className="space-y-1">
               <NavLink
                to={`/property/${property.id}/details`}
                className={() => `block px-3 py-2.5 rounded-lg text-sm transition-colors ${activePropertyId === property.id ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
              >
                <div className="flex items-center gap-3"><Home size={16} /> <span className="truncate">{property.name}</span></div>
              </NavLink>
              {activePropertyId === property.id && (
                <div className="ml-4 pl-3 border-l border-slate-700 space-y-1 my-1 animate-in slide-in-from-left-2 duration-200">
                    <NavLink to={`/property/${property.id}/details`} className={({isActive}) => `flex items-center gap-2 px-3 py-2 rounded-md text-xs ${isActive ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300'}`}><Settings size={14} /> Ustawienia</NavLink>
                    <NavLink to={`/property/${property.id}/units`} className={({isActive}) => `flex items-center gap-2 px-3 py-2 rounded-md text-xs ${isActive ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300'}`}><BedDouble size={14} /> Kwatery</NavLink>
                    <NavLink to={`/property/${property.id}/calendar`} className={({isActive}) => `flex items-center gap-2 px-3 py-2 rounded-md text-xs ${isActive ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-slate-300'}`}><Calendar size={14} /> Dostępność</NavLink>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>

    {isModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-surface border border-border w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
          <div className="p-4 border-b border-border flex justify-between items-center bg-slate-900/50">
            <h3 className="font-bold text-white">Dodaj nowy obiekt</h3>
            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex bg-slate-900 p-1 rounded-lg border border-border">
              <button type="button" onClick={() => setModalMode('manual')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${modalMode === 'manual' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}><Type size={16} /> Ręcznie</button>
              <button type="button" onClick={() => setModalMode('import')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${modalMode === 'import' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}><Globe size={16} /> Hotres (Import)</button>
            </div>
            <form onSubmit={handleCreateProperty} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Nazwa obiektu</label>
                <input autoFocus required type="text" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500" placeholder="np. Willa Nadmorska" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              {modalMode === 'import' && (
                <div className="animate-in slide-in-from-top-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">ID Obiektu (OID)</label>
                  <input required type="text" className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white outline-none focus:ring-2 focus:ring-indigo-500 font-mono" placeholder="np. 4268" value={formData.oid} onChange={e => setFormData({...formData, oid: e.target.value})} />
                  <p className="text-[10px] text-slate-500 mt-2">System automatycznie pobierze listę pokoi z Hotres i doda je do bazy.</p>
                </div>
              )}
              <button disabled={isSubmitting} className="w-full bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-medium shadow-lg shadow-green-900/20 transition-all active:scale-95 flex items-center justify-center gap-2 mt-4">
                {isSubmitting ? <Loader2 className="animate-spin" /> : <Plus size={18} />}
                {modalMode === 'import' ? 'Importuj i Utwórz' : 'Utwórz Obiekt'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )}
    </>
  );
};