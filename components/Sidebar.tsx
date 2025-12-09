import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation, useParams } from 'react-router-dom';
import { Building, Settings, BedDouble, Calendar, Plus, Home } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { Property } from '../types';

export const Sidebar: React.FC = () => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  
  // Extract property ID from URL hash path if present
  // HashRouter format: #/property/:id/...
  const pathParts = location.pathname.split('/');
  const activePropertyId = pathParts[1] === 'property' ? pathParts[2] : null;

  useEffect(() => {
    fetchProperties();
    
    // Subscribe to changes in properties list
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

  const createProperty = async () => {
    const name = prompt('Podaj nazwę nowego obiektu:');
    if (!name) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('properties')
        .insert([{ user_id: user.id, name }])
        .select()
        .single();

      if (error) throw error;
      if (data) {
        navigate(`/property/${data.id}/details`);
      }
    } catch (err) {
      alert('Błąd podczas tworzenia obiektu');
      console.error(err);
    }
  };

  return (
    <nav className="flex flex-col h-full overflow-y-auto">
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
            onClick={createProperty}
            className="text-slate-400 hover:text-white transition-colors p-1"
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

                  {/* Nested Menu */}
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
  );
};