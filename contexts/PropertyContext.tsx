
import React, { createContext, useState, useEffect, useContext, ReactNode, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { Property, Unit, Availability, Notification, RatePlan } from '../types';

interface PropertyContextType {
  properties: Property[];
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  fetchProperties: () => Promise<void>;
  addProperty: (name: string, description: string | null, email: string | null, phone: string | null, hotresId: string | null) => Promise<Property | null>;
  deleteProperty: (id: string) => Promise<void>;
  importFromHotres: (oid: string, propertyId: string) => Promise<void>;
  syncAvailability: (oid: string, propertyId: string) => Promise<string>;
  syncRates: (oid: string, propertyId: string) => Promise<string>;
  fetchNotifications: () => Promise<void>;
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  deleteAllReadNotifications: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
}

const PropertyContext = createContext<PropertyContextType | undefined>(undefined);

export const PropertyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProperties = useCallback(async () => {
    // Nie resetujemy loading do true przy każdym odświeżeniu, aby uniknąć migania UI
    setError(null);
    try {
      const { data, error: dbError } = await supabase
        .from('properties')
        .select('*')
        .order('workflow_position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      
      if (dbError) throw dbError;
      setProperties(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (data) {
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.is_read).length);
    }
  }, []);

  useEffect(() => {
    fetchProperties();
    fetchNotifications();

    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const newNotification = payload.new as Notification;
          setNotifications(prev => [newNotification, ...prev]);
          setUnreadCount(prev => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchProperties, fetchNotifications]);

  const addProperty = useCallback(async (name: string, description: string | null, email: string | null, phone: string | null, hotresId: string | null) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Musisz być zalogowany");

    const maxPos = properties.length > 0 ? Math.max(...properties.map(p => p.workflow_position || 0)) : 0;

    const { data, error } = await supabase
      .from('properties')
      .insert([{ 
        user_id: user.id, 
        name, 
        description,
        email,
        phone,
        hotres_id: hotresId,
        workflow_position: maxPos + 1,
        workflow_is_active: true
      }])
      .select()
      .single();

    if (error) throw error;
    setProperties(prev => [data, ...prev]);
    return data;
  }, [properties]);

  const deleteProperty = useCallback(async (id: string) => {
    const { error } = await supabase.from('properties').delete().eq('id', id);
    if (error) throw error;
    setProperties(prev => prev.filter(p => p.id !== id));
  }, []);

  const fetchWithProxy = useCallback(async (targetUrl: string): Promise<string> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const functionUrl = 'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/hotres-proxy';

      const res = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: targetUrl })
      });

      if (!res.ok) {
        throw new Error(`Proxy error: ${res.status} ${res.statusText}`);
      }

      const json = await res.json();

      if (json.error) {
        throw new Error(json.error);
      }

      if (!json.data || json.data.length === 0) {
        throw new Error('Empty response from server');
      }

      return json.data;
    } catch (e: any) {
      console.error(`Fetch via proxy failed for ${targetUrl}:`, e.message);
      throw new Error(`Failed to fetch data: ${e.message}`);
    }
  }, []);

  const importFromHotres = useCallback(async (oid: string, propertyId: string) => {
    const apiUser = "admin@twojepokoje.com.pl";
    const apiPass = "Admin123@@";

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Musisz być zalogowany");

    // 1. Pobierz informacje o obiekcie (opcjonalne, dla logu)
    const objectUrl = `https://panel.hotres.pl/api_object?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&lang=pl`;
    const objectResponse = await fetchWithProxy(objectUrl);
    const objectData = JSON.parse(objectResponse);
    console.log('Object info:', objectData);

    // 2. Pobierz typy pokoi
    const roomTypesUrl = `https://panel.hotres.pl/api_roomstypes?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&lang=pl`;
    const roomTypesResponse = await fetchWithProxy(roomTypesUrl);
    const roomTypes = JSON.parse(roomTypesResponse);

    if (!Array.isArray(roomTypes)) {
      throw new Error('Nieprawidłowy format odpowiedzi z api_roomstypes');
    }

    console.log(`Found ${roomTypes.length} room types`);

    // 3. Dla każdego typu pokoju, pobierz szczegóły
    for (const roomType of roomTypes) {
      const typeId = roomType.type_id;
      if (!typeId) {
        console.warn('Skipping room type without type_id:', roomType);
        continue;
      }

      console.log(`Fetching details for room type ${typeId}:`, roomType);

      const roomTypeUrl = `https://panel.hotres.pl/api_roomtype?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&lang=pl&type_id=${typeId}`;
      const roomTypeResponse = await fetchWithProxy(roomTypeUrl);
      const roomTypeData = JSON.parse(roomTypeResponse);

      console.log(`Room type ${typeId} data:`, roomTypeData);

      // roomTypeData może zawierać tablicę pokoi lub pojedynczy pokój
      const rooms = Array.isArray(roomTypeData) ? roomTypeData : [roomTypeData];
      console.log(`Processing ${rooms.length} rooms for type ${typeId}`);

      for (const room of rooms) {
        // W API Hotres type_id jest unikalnym identyfikatorem pokoju
        const externalId = room.type_id || typeId;
        const externalTypeId = typeId;
        const name = room.title || room.name || `Pokój ${externalId}`;
        const type = roomType.title || roomType.name || 'Standard';

        // Liczba łóżek
        const single = parseInt(room.single || '0');
        const double = parseInt(room.double || '0');
        const sofa = parseInt(room.sofa || '0');
        const sofaSingle = parseInt(room.sofa_single || '0');
        const capacity = single + (double * 2) + sofa + sofaSingle;

        // Dane techniczne
        const area = room.area ? parseInt(room.area) : null;
        const maxAdults = room.max_adults ? parseInt(room.max_adults) : null;
        const bathroomCount = room.bathroom_cnt ? parseInt(room.bathroom_cnt) : null;
        const floorNum = room.floor ? parseInt(room.floor) : null;

        // Opis i udogodnienia
        const description = room.description || room.advert || null;
        const facilities = room.facilities || null;
        const photoUrl = room.photo || null;
        const photos = room.photos || null;

        console.log('Importing:', { externalId, name, type, capacity, area, floor: floorNum, bathrooms: bathroomCount });

        if (externalId && name) {
          const { data: existingUnit } = await supabase
            .from('units')
            .select('id')
            .eq('property_id', propertyId)
            .eq('external_id', String(externalId))
            .single();

          if (!existingUnit) {
            const insertData = {
              property_id: propertyId,
              name: name,
              type: type,
              capacity: capacity,
              area: area,
              external_id: String(externalId),
              external_type_id: String(externalTypeId),
              description: description,
              beds_single: single,
              beds_double: double,
              beds_sofa: sofa,
              beds_sofa_single: sofaSingle,
              max_adults: maxAdults,
              bathroom_count: bathroomCount,
              floor: floorNum,
              facilities: facilities,
              photo_url: photoUrl,
              photos: photos
            };

            console.log('Inserting data:', insertData);

            const { data: insertedRoom, error: insertError } = await supabase
              .from('units')
              .insert(insertData)
              .select()
              .single();

            if (insertError) {
              console.error(`Failed to insert room ${name}:`, insertError);
              throw insertError;
            }

            console.log(`✓ Imported room: ${name} (ID: ${externalId})`, insertedRoom);
          } else {
            console.log(`⊘ Room already exists: ${name} (ID: ${externalId})`);
          }
        }
      }
    }
  }, [fetchWithProxy]);

  const normalizeDate = (dateInput: string): string => {
      try {
          if (!dateInput) return "";
          if (dateInput.includes('T')) {
              return dateInput.split('T')[0];
          }
          return dateInput.substring(0, 10);
      } catch (e) {
          return String(dateInput).substring(0, 10);
      }
  };

  const uuidv4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const syncAvailability = useCallback(async (oid: string, propertyId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Brak autoryzacji");

    await supabase.from('properties').update({ availability_sync_in_progress: true }).eq('id', propertyId);

    try {
        const apiUser = "admin@twojepokoje.com.pl";
        const apiPass = "Admin123@@";

        const { data: units } = await supabase.from('units').select('id, name, external_id, external_type_id').eq('property_id', propertyId);
        if (!units || units.length === 0) throw new Error("Brak kwater w bazie.");

        const unitMap = new Map<string, string>();
        units.forEach((u: any) => {
            if (u.external_id) unitMap.set(String(u.external_id).trim(), u.id);
            if (u.external_type_id) unitMap.set(String(u.external_type_id).trim(), u.id);
        });

        const year = 2026;
        const fromDate = `${year}-01-01`;
        const tillDate = `${year}-12-31`;
        
        const targetUrl = `https://panel.hotres.pl/api_availability?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&from=${fromDate}&till=${tillDate}`;
        const rawResponse = await fetchWithProxy(targetUrl);
        
        const jsonText = rawResponse.trim().replace(/^\uFEFF/, '');
        let jsonData: any;
        try {
            jsonData = JSON.parse(jsonText);
            if (typeof jsonData === 'string') jsonData = JSON.parse(jsonData);
        } catch (e) {
            throw new Error("Błąd parsowania odpowiedzi z Hotres.");
        }

        if (jsonData && jsonData.result === 'error') {
            throw new Error(`Hotres API Error: ${jsonData.message}`);
        }

        let itemsToProcess: any[] = [];
        if (Array.isArray(jsonData)) {
            itemsToProcess = jsonData;
        } else if (typeof jsonData === 'object' && jsonData !== null) {
            const vals = Object.values(jsonData);
            const foundArr = vals.find(v => Array.isArray(v) && v.length > 0 && (v[0].type_id || v[0].dates));
            itemsToProcess = foundArr ? (foundArr as any[]) : vals.filter((v: any) => v && (v.type_id || v.dates));
        }

        const unitIds = units.map(u => u.id);
        const { data: existingRows } = await supabase
            .from('availability')
            .select('id, unit_id, date, status, reservation_id')
            .in('unit_id', unitIds)
            .gte('date', fromDate)
            .lte('date', tillDate);
        
        const dbMap = new Map<string, any>();
        existingRows?.forEach(row => {
            dbMap.set(`${row.unit_id}_${normalizeDate(row.date)}`, row);
        });

        const rowsToUpsert: any[] = [];
        const processedKeys = new Set<string>(); 

        for (const item of itemsToProcess) {
            const extId = String(item.type_id).trim();
            const unitId = unitMap.get(extId);
            
            if (unitId && item.dates && Array.isArray(item.dates)) {
                for (const d of item.dates) {
                    const dateStr = normalizeDate(d.date);
                    const key = `${unitId}_${dateStr}`;
                    if (processedKeys.has(key)) continue;
                    processedKeys.add(key);

                    const isBooked = (d.available === 0 || d.available === '0' || d.available === false);
                    const targetStatus = isBooked ? 'booked' : 'available';
                    const existingRow = dbMap.get(key);

                    rowsToUpsert.push({
                        id: existingRow ? existingRow.id : uuidv4(),
                        unit_id: unitId,
                        date: dateStr,
                        status: targetStatus,
                        reservation_id: existingRow?.reservation_id || null
                    });
                }
            }
        }

        if (rowsToUpsert.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
                const batch = rowsToUpsert.slice(i, i + BATCH_SIZE);
                const { error: upsertError } = await supabase
                    .from('availability')
                    .upsert(batch, { onConflict: 'unit_id,date' });
                if (upsertError) throw upsertError;
            }
        }

        await supabase.from('properties').update({ 
            availability_last_synced_at: new Date().toISOString(),
            availability_sync_in_progress: false
        }).eq('id', propertyId);

        return `Zapisano ${rowsToUpsert.length} zmian dla roku ${year}.`;

    } catch (e: any) {
        await supabase.from('properties').update({ availability_sync_in_progress: false }).eq('id', propertyId);
        console.error("Sync Exception:", e);
        throw e;
    }
  }, [fetchWithProxy]);

  const syncRates = useCallback(async (oid: string, propertyId: string) => {
    const apiUser = "admin@twojepokoje.com.pl";
    const apiPass = "Admin123@@";
    
    const targetUrl = `https://panel.hotres.pl/api_rates?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&lang=pl`;
    
    try {
      const rawResponse = await fetchWithProxy(targetUrl);
      const jsonText = rawResponse.trim().replace(/^\uFEFF/, '');
      let jsonData: any;
      
      try {
          jsonData = JSON.parse(jsonText);
      } catch (e) {
          throw new Error("Błąd parsowania JSON z API cenników.");
      }

      if (!Array.isArray(jsonData)) {
          throw new Error("Nieprawidłowy format danych z API cenników (oczekiwano tablicy).");
      }

      const ratesToUpsert = jsonData.map((item: any) => ({
          property_id: propertyId,
          external_id: item.rate_id,
          name: item.title,
          description: item.advert,
          board_type: item.board,
          min_stay: parseInt(item.minimum_stay) || 1,
          max_stay: parseInt(item.maximum_stay) || 365,
          photo_url: item.photo,
      }));

      if (ratesToUpsert.length > 0) {
          const { error } = await supabase
              .from('rate_plans')
              .upsert(ratesToUpsert, { onConflict: 'property_id,external_id' });
          
          if (error) throw error;
      }
      
      return `Zaktualizowano ${ratesToUpsert.length} cenników.`;

    } catch (e: any) {
        console.error("Sync Rates Exception:", e);
        throw e;
    }
  }, [fetchWithProxy]);

  const markNotificationAsRead = useCallback(async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  }, []);

  const markAllNotificationsAsRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id);
    }
  }, []);
  
  const deleteAllReadNotifications = useCallback(async () => {
    setNotifications(prev => prev.filter(n => !n.is_read));
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        await supabase.from('notifications').delete().eq('user_id', user.id).eq('is_read', true);
    }
  }, []);

  const deleteNotification = useCallback(async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await supabase.from('notifications').delete().eq('id', id);
  }, []);

  return (
    <PropertyContext.Provider value={{ 
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
      syncRates,
      fetchNotifications,
      markNotificationAsRead,
      markAllNotificationsAsRead,
      deleteAllReadNotifications,
      deleteNotification
    }}>
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
