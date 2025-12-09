import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Building, Settings, BedDouble, Calendar, Plus, Home, X, Globe, Type, Loader2 } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { Property } from '../types';

export const Sidebar: React.FC = () => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'manual' | 'import'>('manual');
  const [formData, setFormData] = useState({ name: '', oid: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  
  const pathParts = location.pathname.split('/');
  const activePropertyId = pathParts[1] === 'property' ? pathParts[2] : null;

  useEffect(() => {
    fetchProperties();
    
    const subscription = supabase
      .channel('properties_list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, fetchProperties)
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchProperties = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProperties(data || []);
    } catch (err) {
      console.error('Error fetching properties:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;
    setIsSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Brak użytkownika");

      // 1. Create Property
      const { data: propertyData, error: propError } = await supabase
        .from('properties')
        .insert([{ 
            user_id: user.id, 
            name: formData.name,
            description: modalMode === 'import' ? `Zaimportowano z Hotres OID: ${formData.oid}` : null
        }])
        .select()
        .single();

      if (propError) throw propError;
      if (!propertyData) throw new Error("Nie udało się utworzyć obiektu");

      // 2. If Import Mode -> Fetch from Hotres API
      if (modalMode === 'import' && formData.oid) {
        await importFromHotres(formData.oid, propertyData.id);
      }

      // 3. Reset and Navigate
      setIsModalOpen(false);
      setFormData({ name: '', oid: '' });
      setModalMode('manual');
      navigate(`/property/${propertyData.id}/details`);

    } catch (err: any) {
      alert(`Błąd: ${err.message}`);
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const importFromHotres = async (oid: string, propertyId: string) => {
    // We use 'allorigins' proxy to bypass CORS restrictions in the browser. 
    // Direct call to hotres.pl from a browser web app would be blocked.
    const targetUrl = `https://panel.hotres.pl/api_rooms?user=admin%40twojepokoje.com.pl&password=Admin123%40%40&oid=${oid}`;
    const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Błąd połączenia z API (Proxy): ${response.status}`);
      
      const xmlText = await response.text();
      
      // Parse XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      
      const rooms = xmlDoc.getElementsByTagName("room");
      if (rooms.length === 0) {
          console.warn("Brak pokoi w XML:", xmlText);
          throw new Error("Nie znaleziono pokoi dla podanego OID w odpowiedzi API.");
      }

      const unitsToInsert = [];

      for (let i = 0; i < rooms.length; i++) {
        const room = rooms[i];
        const name = room.getElementsByTagName("room_name")[0]?.textContent || `Pokój ${i+1}`;
        const capacityStr = room.getElementsByTagName("people")[0]?.textContent || "2";
        const desc = room.getElementsByTagName("room_desc")[0]?.textContent || "";
        
        // Basic mapping
        unitsToInsert.push({
          property_id: propertyId,
          name: name,
          type: 'room',
          capacity: parseInt(capacityStr) || 2,
          description: desc.substring(0, 500) // Limit length just in case
        });
      }

      if (unitsToInsert.length > 0) {
        const { error } = await supabase.from('units').insert(unitsToInsert);
        if (error) throw error;
      }

    } catch (err: any) {
      console.error("Import failed:", err);
      alert(`Ostrzeżenie: Obiekt utworzono, ale import pokoi nie powiódł się. Powód: ${err.message}`);
    }
  };

  return (
    <>
    <nav className="flex flex-col h-full overflow-y-auto relative z-10">
      <div className="p-6">
        <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Building size={18} className="text-white" />
          </div>
          Machina
        </h1>
        <p className="text-xs text-slate-500 mt-1 uppercase tracking-wider font-semibold">Panel Rezerwacji</p>
      </div>

      <div className="px-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase">Twoje Obiekty</span>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="text-slate-400 hover:text-white transition-colors p-1 bg-slate-800 rounded hover:bg-indigo-600"
            title="Dodaj obiekt"
          >
            <Plus size={14} />
          </button>
        </div>
        
        {loading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-8 bg-slate-800 rounded"></div>
            <div className="h-8 bg-slate-800 rounded"></div>
          </div>
        ) : properties.length === 0 ? (
          <div className="text-sm text-slate-500 italic py-2">Brak obiektów. Dodaj pierwszy!</div>
        ) : (
          <ul className="space-y-1">
            {properties.map((prop) => {
              const isActive = activePropertyId === prop.id;
              
              return (
                <li key={prop.id}>
                  <div 
                    onClick={() => navigate(`/property/${prop.id}/details`)}
                    className={`
                      group flex items-center gap-3 px-3 py-2 text-sm rounded-md cursor-pointer transition-all
                      ${isActive 
                        ? 'bg-indigo-600/10 text-indigo-400 font-medium' 
                        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}
                    `}
                  >
                    <Home size={16} className={isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'} />
                    <span className="truncate">{prop.name}</span>
                  </div>

                  {isActive && (
                    <div className="ml-4 pl-4 border-l border-border mt-1 space-y-1 mb-2">
                      <NavLink 
                        to={`/property/${prop.id}/details`}
                        className={({ isActive }) => `
                          flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-colors
                          ${isActive ? 'text-white bg-slate-700/50' : 'text-slate-500 hover:text-slate-300'}
                        `}
                      >
                        <Settings size={12} />
                        Ustawienia
                      </NavLink>
                      <NavLink 
                        to={`/property/${prop.id}/units`}
                        className={({ isActive }) => `
                          flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-colors
                          ${isActive ? 'text-white bg-slate-700/50' : 'text-slate-500 hover:text-slate-300'}
                        `}
                      >
                        <BedDouble size={12} />
                        Kwatery
                      </NavLink>
                      <NavLink 
                        to={`/property/${prop.id}/calendar`}
                        className={({ isActive }) => `
                          flex items-center gap-2 px-3 py-1.5 text-xs rounded-md transition-colors
                          ${isActive ? 'text-white bg-slate-700/50' : 'text-slate-500 hover:text-slate-300'}
                        `}
                      >
                        <Calendar size={12} />
                        Cennik & Dostępność
                      </NavLink>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>

    {/* CREATE PROPERTY MODAL */}
    {isModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="bg-surface border border-border w-full max-w-md rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between p-4 border-b border-border bg-slate-900/50">
            <h3 className="text-lg font-bold text-white">Dodaj nowy obiekt</h3>
            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
          
          <div className="p-4">
            {/* Tabs */}
            <div className="flex bg-slate-900 p-1 rounded-lg mb-6">
              <button 
                onClick={() => setModalMode('manual')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${modalMode === 'manual' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Type size={14} /> Ręcznie
              </button>
              <button 
                onClick={() => setModalMode('import')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${modalMode === 'import' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Globe size={14} /> Import OID
              </button>
            </div>

            <form onSubmit={handleCreateProperty} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">Nazwa Obiektu</label>
                <input 
                  type="text" 
                  required
                  placeholder="np. Apartamenty nad Morzem"
                  className="w-full bg-slate-900 border border-border text-white rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>

              {modalMode === 'import' && (
                <div className="animate-in fade-in slide-in-from-top-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">Hotres OID</label>
                  <input 
                    type="text" 
                    required
                    placeholder="np. 4268"
                    className="w-full bg-slate-900 border border-border text-white rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                    value={formData.oid}
                    onChange={e => setFormData({...formData, oid: e.target.value})}
                  />
                  <p className="text-xs text-slate-500 mt-2">
                    System pobierze listę pokoi z API Hotres i automatycznie utworzy je w bazie.
                  </p>
                </div>
              )}

              <div className="pt-4 flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
                >
                  Anuluj
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="animate-spin" size={14} />}
                  {modalMode === 'import' ? 'Importuj i Utwórz' : 'Utwórz Obiekt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    )}
    </>
  );
};