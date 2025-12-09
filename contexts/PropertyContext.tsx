import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
import { Property, Unit } from '../types';

interface PropertyContextType {
  properties: Property[];
  loading: boolean;
  error: string | null;
  fetchProperties: () => Promise<void>;
  addProperty: (name: string, description: string | null) => Promise<Property | null>;
  deleteProperty: (id: string) => Promise<void>;
  importFromHotres: (oid: string, propertyId: string) => Promise<void>;
}

const PropertyContext = createContext<PropertyContextType | undefined>(undefined);

export const PropertyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProperties = async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProperties([]);
        return;
      }
      const { data, error: dbError } = await supabase
        .from('properties')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (dbError) throw dbError;
      setProperties(data || []);
    } catch (err: any) {
      setError(err.message || 'Błąd pobierania danych.');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchProperties();
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
           setLoading(true);
           fetchProperties();
        }
      }
    );
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const addProperty = async (name: string, description: string | null): Promise<Property | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Użytkownik nie jest zalogowany");
    const { data, error: insertError } = await supabase
      .from('properties')
      .insert([{ name, description, user_id: user.id }])
      .select()
      .single();
    if (insertError) throw insertError;
    setProperties(prev => [data, ...prev]);
    return data;
  };

  const deleteProperty = async (id: string) => {
    const { error: deleteError } = await supabase.from('properties').delete().eq('id', id);
    if (deleteError) throw deleteError;
    setProperties(prev => prev.filter(p => p.id !== id));
  };
  
  const importFromHotres = async (oid: string, propertyId: string) => {
    const targetUrl = `https://panel.hotres.pl/api_rooms?user=admin%40twojepokoje.com.pl&password=Admin123%40%40&oid=${oid}`;
    const url = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Błąd połączenia z API (Proxy): ${response.status}`);
    
    const responseText = await response.text();
    const jsonData = JSON.parse(responseText);
    const roomsList = Array.isArray(jsonData) ? jsonData : (jsonData.room_id ? [jsonData] : Object.values(jsonData));
    
    if (roomsList.length > 0) {
      const unitsToInsert = roomsList.map((room: any) => {
        const single = parseInt(room.single || '0');
        const double = parseInt(room.double || '0');
        const sofa = parseInt(room.sofa || '0');
        const sofa_single = parseInt(room.sofa_single || '0');
        let capacity = (double * 2) + single + (sofa * 2) + sofa_single;
        if (capacity === 0) capacity = 2;

        return {
          property_id: propertyId,
          name: room.code || `Pokój ${room.room_id}`,
          type: 'room',
          capacity: capacity,
          description: `ID z Hotres: ${room.room_id}`, 
          external_id: room.room_id || null,
          external_type_id: room.type_id || null,
          beds_single: single,
          beds_double: double,
          beds_sofa: sofa,
          beds_sofa_single: sofa_single
        };
      });

      // Clear existing units for this property before inserting new ones to sync
      const { error: deleteError } = await supabase.from('units').delete().eq('property_id', propertyId);
      if (deleteError) throw new Error(`Błąd czyszczenia starych kwater: ${deleteError.message}`);

      const { error: insertError } = await supabase.from('units').insert(unitsToInsert);
      if (insertError) throw new Error(`Błąd importu kwater: ${insertError.message}`);
      
      alert(`Pomyślnie zsynchronizowano ${unitsToInsert.length} kwater.`);
    } else {
      alert('Nie znaleziono kwater dla podanego OID lub odpowiedź API jest pusta.');
    }
  };


  const value = {
    properties,
    loading,
    error,
    fetchProperties,
    addProperty,
    deleteProperty,
    importFromHotres,
  };

  return (
    <PropertyContext.Provider value={value}>
      {children}
    </PropertyContext.Provider>
  );
};

export const useProperties = () => {
  const context = useContext(PropertyContext);
  if (context === undefined) {
    throw new Error('useProperties must be used within a PropertyProvider');
  }
  return context;
};
