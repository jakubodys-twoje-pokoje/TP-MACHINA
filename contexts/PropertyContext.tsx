import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
import { Property, Unit, Availability, Notification } from '../types';
import { facilitiesMap } from '../data/facilities';

interface PropertyContextType {
  properties: Property[];
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  fetchProperties: () => Promise<void>;
  addProperty: (name: string, description: string | null) => Promise<Property | null>;
  deleteProperty: (id: string) => Promise<void>;
  importFromHotres: (oid: string, propertyId: string) => Promise<void>;
  syncAvailability: (oid: string, propertyId: string) => Promise<void>;
  fetchNotifications: () => Promise<void>;
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
}

const PropertyContext = createContext<PropertyContextType | undefined>(undefined);

export const PropertyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
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

  const fetchNotifications = async () => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error("Błąd pobierania powiadomień:", error);
      return;
    }

    setNotifications(data || []);
    setUnreadCount(data?.filter(n => !n.is_read).length || 0);
  };
  
  useEffect(() => {
    fetchProperties();
    fetchNotifications();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
           setLoading(true);
           fetchProperties();
           fetchNotifications();
        }
      }
    );
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const markNotificationAsRead = async (id: string) => {
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    if (error) throw error;
    await fetchNotifications();
  };

  const markAllNotificationsAsRead = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if(!user) return;
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    if (error) throw error;
    await fetchNotifications();
  };

  const deleteNotification = async (id: string) => {
      const { error } = await supabase.from('notifications').delete().eq('id', id);
      if (error) throw error;
      await fetchNotifications();
  };


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

        const floorValue = roomDetails.floor;
        const parsedFloor = parseInt(floorValue, 10);
        
        // Translate facility IDs to names
        const facilityIds = (roomDetails.facilities || '').split(',').map((id: string) => id.trim()).filter(Boolean);
        const facilityNames = facilityIds.map((id: string) => facilitiesMap[id] || id).join(', ');


        // Merge data from both APIs
        const mergedUnitData = {
          property_id: propertyId,
          name: roomDetails.title || room.code || `Pokój ${room.room_id}`,
          type: roomDetails.category || 'room',
          capacity,
          description: roomDetails.description || roomDetails.advert || `ID z Hotres: ${room.room_id}`, 
          external_id: room.room_id || null,
          external_type_id: room.type_id || null,
          beds_single: single,
          beds_double: double,
          beds_sofa: sofa,
          beds_sofa_single: sofa_single,
          area: parseInt(roomDetails.area) || null,
          max_adults: parseInt(roomDetails.max_adults) || null,
          bathroom_count: parseInt(roomDetails.bathroom_cnt) || null,
          floor: !isNaN(parsedFloor) ? parsedFloor : null,
          facilities: facilityNames,
          photos: roomDetails.photos || null,
          photo_url: roomDetails.photo || null,
        };
        return mergedUnitData;
    }));

    const validUnits = unitsToInsert.filter(Boolean);

    if (validUnits.length > 0) {
      const { error: deleteError } = await supabase.from('units').delete().eq('property_id', propertyId);
      if (deleteError) throw new Error(`Błąd czyszczenia starych kwater: ${deleteError.message}`);

      const { error: insertError } = await supabase.from('units').insert(validUnits);
      if (insertError) throw new Error(`Błąd importu kwater: ${insertError.message}`);
      
      alert(`Pomyślnie zsynchronizowano ${validUnits.length} kwater.`);
    } else {
      alert('Nie udało się pobrać szczegółów dla żadnej z kwater.');
    }
  };

  const syncAvailability = async (oid: string, propertyId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Brak użytkownika");

      const property = properties.find(p => p.id === propertyId);
      if (!property) throw new Error("Nie znaleziono obiektu");

      // 1. Get all units for this property for mapping
      const { data: units, error: unitsError } = await supabase.from('units').select('id, name, external_type_id').eq('property_id', propertyId);
      if (unitsError) throw unitsError;
      if (!units || units.length === 0) throw new Error("Brak kwater do synchronizacji.");

      const typeIdToUnitMap = new Map<string, { id: string; name: string }>();
      units.forEach(unit => {
          if (unit.external_type_id) typeIdToUnitMap.set(unit.external_type_id, { id: unit.id, name: unit.name });
      });

      // 2. Get current availability from DB
      const { data: currentAvailData } = await supabase.from('availability').select('unit_id, date, status').in('unit_id', units.map(u => u.id));
      const currentAvailMap = new Map<string, 'available' | 'blocked'>();
      currentAvailData?.forEach(a => currentAvailMap.set(`${a.unit_id}-${a.date}`, a.status as any));
      
      // 3. Fetch availability data from Hotres
      const fromDate = '2026-01-01';
      const tillDate = '2026-12-31';
      const availUrl = `https://panel.hotres.pl/api_availability?user=admin%40twojepokoje.com.pl&password=Admin123%40%40&oid=${oid}&from=${fromDate}&till=${tillDate}`;
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(availUrl)}`;
      
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error(`API Dostępności: ${response.status}`);
      const newAvailData = await response.json();
      if (!Array.isArray(newAvailData)) throw new Error("API Dostępności: Zły format danych.");

      // 4. Compare and find changes
      const allChanges: { unitId: string, unitName: string, date: string, newStatus: 'available' | 'blocked' }[] = [];
      const recordsToUpsert: Omit<Availability, 'id' | 'reservation_id'>[] = [];

      for (const typeData of newAvailData) {
          const unit = typeIdToUnitMap.get(String(typeData.type_id));
          if (unit && typeData.dates && Array.isArray(typeData.dates)) {
              for (const dateInfo of typeData.dates) {
                  const newStatus = dateInfo.available === "1" ? 'available' : 'blocked';
                  recordsToUpsert.push({ unit_id: unit.id, date: dateInfo.date, status: newStatus });

                  const oldStatus = currentAvailMap.get(`${unit.id}-${dateInfo.date}`);
                  if (oldStatus !== newStatus) {
                      allChanges.push({ unitId: unit.id, unitName: unit.name, date: dateInfo.date, newStatus });
                  }
              }
          }
      }

      // 5. Group changes and create notifications
      const notificationsToInsert: Omit<Notification, 'id' | 'created_at' | 'is_read' | 'user_id'>[] = [];
      const changesByUnit = allChanges.reduce((acc, change) => {
          (acc[change.unitId] = acc[change.unitId] || []).push(change);
          return acc;
      }, {} as Record<string, typeof allChanges>);

      for (const unitId in changesByUnit) {
          const unitChanges = changesByUnit[unitId].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          if (unitChanges.length === 0) continue;

          let group = { change_type: unitChanges[0].newStatus, start_date: unitChanges[0].date, end_date: unitChanges[0].date };
          for (let i = 1; i < unitChanges.length; i++) {
              const prevDate = new Date(unitChanges[i - 1].date);
              const currentDate = new Date(unitChanges[i].date);
              const diffDays = (currentDate.getTime() - prevDate.getTime()) / (1000 * 3600 * 24);

              if (unitChanges[i].newStatus === group.change_type && diffDays === 1) {
                  group.end_date = unitChanges[i].date;
              } else {
                  notificationsToInsert.push({ property_id: propertyId, property_name: property.name, unit_id: unitId, unit_name: unitChanges[0].unitName, ...group });
                  group = { change_type: unitChanges[i].newStatus, start_date: unitChanges[i].date, end_date: unitChanges[i].date };
              }
          }
          notificationsToInsert.push({ property_id: propertyId, property_name: property.name, unit_id: unitId, unit_name: unitChanges[0].unitName, ...group });
      }

      // 6. Execute DB operations
      if (recordsToUpsert.length > 0) {
          const { error: upsertError } = await supabase.from('availability').upsert(recordsToUpsert, { onConflict: 'unit_id, date' });
          if (upsertError) throw upsertError;
      }
      if (notificationsToInsert.length > 0) {
          const { error: notifError } = await supabase.from('notifications').insert(notificationsToInsert.map(n => ({...n, user_id: user.id })));
          if (notifError) throw notifError;
          await fetchNotifications(); // Refresh notifications in UI
      }
  };

  const value = {
    properties,
    notifications,
    unreadCount,
    loading,
    error,
    fetchProperties,
    addProperty,
    deleteProperty,
    importFromHotres,
    syncAvailability,
    fetchNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification
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