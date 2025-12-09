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
    // Step 1: Get the list of rooms
    const roomsListUrl = `https://panel.hotres.pl/api_rooms?user=admin%40twojepokoje.com.pl&password=Admin123%40%40&oid=${oid}`;
    const proxyRoomsUrl = `https://corsproxy.io/?${encodeURIComponent(roomsListUrl)}`;
    
    const roomsResponse = await fetch(proxyRoomsUrl);
    if (!roomsResponse.ok) throw new Error(`Błąd połączenia z API (Rooms): ${roomsResponse.status}`);
    
    const roomsData = await roomsResponse.json();
    const roomsList = Array.isArray(roomsData) ? roomsData : (roomsData.room_id ? [roomsData] : Object.values(roomsData));

    if (roomsList.length === 0) {
      alert('Nie znaleziono kwater dla podanego OID lub odpowiedź API jest pusta.');
      return;
    }

    // Step 2: Fetch details for each room and create a combined unit object
    const unitsToInsert = await Promise.all(roomsList.map(async (room: any) => {
        const roomDetailsUrl = `https://panel.hotres.pl/api_roomtype?user=admin%40twojepokoje.com.pl&password=Admin123%40%40&oid=${oid}&type_id=${room.type_id}&lang=pl`;
        const proxyDetailsUrl = `https://corsproxy.io/?${encodeURIComponent(roomDetailsUrl)}`;

        const detailsResponse = await fetch(proxyDetailsUrl);
        if (!detailsResponse.ok) {
            console.warn(`Nie udało się pobrać szczegółów dla type_id: ${room.type_id}`);
            return null; // Skip if details fail
        }
        const roomDetails = await detailsResponse.json();

        // Calculate capacity from the main rooms list
        const single = parseInt(room.single || '0');
        const double = parseInt(room.double || '0');
        const sofa = parseInt(room.sofa || '0');
        const sofa_single = parseInt(room.sofa_single || '0');
        let capacity = (double * 2) + single + (sofa * 2) + sofa_single;
        if (capacity === 0) capacity = parseInt(roomDetails.max_adults || '2');

        // Merge data from both APIs
        const mergedUnitData = {
          property_id: propertyId,
          name: roomDetails.title || room.code || `Pokój ${room.room_id}`,
          type: roomDetails.category || 'room',
          capacity,
          description: roomDetails.advert || `ID z Hotres: ${room.room_id}`, 
          external_id: room.room_id || null,
          external_type_id: room.type_id || null,
          beds_single: single,
          beds_double: double,
          beds_sofa: sofa,
          beds_sofa_single: sofa_single,
          area: parseInt(roomDetails.area) || null,
          max_adults: parseInt(roomDetails.max_adults) || null,
          bathroom_count: parseInt(roomDetails.bathroom_cnt) || null,
          floor: parseInt(roomDetails.floor) || null,
          facilities: roomDetails.facilities || null,
          photos: roomDetails.photos || null,
          photo_url: roomDetails.photo || null,
        };
        return mergedUnitData;
    }));

    const validUnits = unitsToInsert.filter(Boolean); // Remove any nulls from failed fetches

    if (validUnits.length > 0) {
      // Clear existing units before sync
      const { error: deleteError } = await supabase.from('units').delete().eq('property_id', propertyId);
      if (deleteError) throw new Error(`Błąd czyszczenia starych kwater: ${deleteError.message}`);

      // Insert new units
      const { error: insertError } = await supabase.from('units').insert(validUnits);
      if (insertError) throw new Error(`Błąd importu kwater: ${insertError.message}`);
      
      alert(`Pomyślnie zsynchronizowano ${validUnits.length} kwater.`);
    } else {
      alert('Nie udało się pobrać szczegółów dla żadnej z kwater.');
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
