import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';
import { Property, Unit, Availability, Notification } from '../types';

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

  const fetchProperties = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbError } = await supabase
        .from('properties')
        .select('*')
        .order('created_at', { ascending: false });
      if (dbError) throw dbError;
      setProperties(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
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
  };

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
  }, []);

  const addProperty = async (name: string, description: string | null, email: string | null, phone: string | null, hotresId: string | null) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Musisz być zalogowany");

    const { data, error } = await supabase
      .from('properties')
      .insert([{ 
        user_id: user.id, 
        name, 
        description,
        email,
        phone,
        hotres_id: hotresId
      }])
      .select()
      .single();

    if (error) throw error;
    setProperties(prev => [data, ...prev]);
    return data;
  };

  const deleteProperty = async (id: string) => {
    const { error } = await supabase.from('properties').delete().eq('id', id);
    if (error) throw error;
    setProperties(prev => prev.filter(p => p.id !== id));
  };

  const fetchWithProxy = async (targetUrl: string): Promise<string> => {
    // Dodajemy timestamp, aby uniknąć cache'owania przez proxy
    const noCacheUrl = `${targetUrl}&_t=${Date.now()}`;
    
    const proxies = [
      async () => {
        const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(noCacheUrl)}`);
        if (!res.ok) throw new Error(`AllOrigins status: ${res.status}`);
        const data = await res.json();
        return data.contents; 
      },
      async () => {
        const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(noCacheUrl)}`);
        if (!res.ok) throw new Error(`CodeTabs status: ${res.status}`);
        return await res.text();
      },
      async () => {
         const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(noCacheUrl)}`);
         if (!res.ok) throw new Error(`CorsProxy status: ${res.status}`);
         return await res.text();
      }
    ];

    let lastError: any;
    for (const proxyFetch of proxies) {
      try {
        const text = await proxyFetch();
        if (text && text.trim().length > 0 && !text.includes('Access Denied') && !text.includes('404 Not Found')) {
             return text;
        }
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(`Nie udało się połączyć z Hotres. Błąd: ${lastError?.message || 'Brak danych'}`);
  };

  const importFromHotres = async (oid: string, propertyId: string) => {
    const xmlText = await fetchWithProxy(`https://hotres.pl/xml/cennik_xml.php?oid=${oid}&kod_waluty=PLN`);
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");

    const rooms = Array.from(xmlDoc.getElementsByTagName("pokoj"));
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    for (const room of rooms) {
      const externalId = room.getElementsByTagName("id_pokoju")[0]?.textContent;
      const name = room.getElementsByTagName("nazwa")[0]?.textContent;
      const type = room.getElementsByTagName("typ")[0]?.textContent || 'Standard';
      
      const structure = room.getElementsByTagName("struktura")[0];
      let capacity = 2;
      let area = null;
      if (structure) {
        capacity = parseInt(structure.getElementsByTagName("osob")[0]?.textContent || "2");
        area = parseInt(structure.getElementsByTagName("metraz")[0]?.textContent || "0");
      }

      if (externalId && name) {
        const { data: existingUnit } = await supabase
          .from('units')
          .select('id')
          .eq('property_id', propertyId)
          .eq('external_id', externalId)
          .single();

        if (!existingUnit) {
          await supabase.from('units').insert({
            property_id: propertyId,
            name: name,
            type: type,
            capacity: capacity,
            area: area,
            external_id: externalId,
            description: `Import z Hotres (OID: ${oid})`
          });
        }
      }
    }
  };

  const normalizeDate = (dateInput: string): string => {
      try {
          if (!dateInput) return "";
          // Format YYYY-MM-DD
          if (dateInput.includes('T')) {
              return dateInput.split('T')[0];
          }
          return dateInput.substring(0, 10);
      } catch (e) {
          return String(dateInput).substring(0, 10);
      }
  };

  const syncAvailability = async (oid: string, propertyId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Brak autoryzacji");

    await supabase.from('properties').update({ availability_sync_in_progress: true }).eq('id', propertyId);

    try {
        const apiUser = "admin@twojepokoje.com.pl";
        const apiPass = "Admin123@@";

        // Sztywny zakres dat
        const fromDate = '2024-01-01';
        const tillDate = '2026-12-31';

        const targetUrl = `https://panel.hotres.pl/api_availability?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&from=${fromDate}&till=${tillDate}`;
        
        console.log(`[SYNC START] Range: ${fromDate} - ${tillDate}, OID: ${oid}`);

        const rawResponse = await fetchWithProxy(targetUrl);
        const jsonText = rawResponse.trim().replace(/^\uFEFF/, '');
        
        let jsonData: any;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            console.error("JSON Parse Error. Raw text prefix:", jsonText.substring(0, 100));
            throw new Error("Błąd parsowania odpowiedzi z Hotres.");
        }

        // --- NAPRAWA LOGIKI PARSOWANIA JSON ---
        let itemsToProcess: any[] = [];
        
        if (Array.isArray(jsonData)) {
            itemsToProcess = jsonData;
        } else if (typeof jsonData === 'object' && jsonData !== null) {
             // Jeśli to obiekt, wyciągamy wartości i sprawdzamy czy wyglądają na dane pokoi
             const potentialItems = Object.values(jsonData);
             itemsToProcess = potentialItems.filter((val: any) => {
                 // Sprawdzamy czy element ma strukturę danych pokoju (type_id lub dates)
                 return val && typeof val === 'object' && (val.type_id || Array.isArray(val.dates));
             });
        }

        if (itemsToProcess.length === 0) {
            console.warn("Received Data Structure:", jsonData);
            throw new Error("Otrzymano dane z Hotres, ale nie znaleziono w nich listy pokoi. (jsonData is not iterable fix)");
        }
        
        // 1. Pobierz Unit-y z bazy
        const { data: units } = await supabase.from('units').select('id, name, external_id').eq('property_id', propertyId);
        if (!units || units.length === 0) throw new Error("Brak kwater (Units) w bazie. Najpierw wykonaj Import/Dodaj kwatery.");

        // Mapa ExternalID -> UnitUUID
        const unitMap = new Map<string, string>();
        units.forEach((u: any) => {
            if (u.external_id) {
                unitMap.set(String(u.external_id).trim(), u.id);
            }
        });

        // 2. Pobierz ISTNIEJĄCE wpisy w bazie availability
        const unitIds = units.map(u => u.id);
        const { data: existingRows } = await supabase
            .from('availability')
            .select('id, unit_id, date, status, reservation_id')
            .in('unit_id', unitIds)
            .gte('date', fromDate)
            .lte('date', tillDate);
        
        const dbMap = new Map<string, { id: string, status: string, reservation_id: any }>();
        existingRows?.forEach(row => {
            const dateKey = normalizeDate(row.date);
            dbMap.set(`${row.unit_id}_${dateKey}`, row);
        });

        const rowsToUpsert: any[] = [];
        let matchedUnits = 0;
        let processedDates = 0;

        // 3. Iterujemy po poprawnie sparsowanej tablicy itemsToProcess
        for (const item of itemsToProcess) {
            const extId = String(item.type_id).trim();
            const unitId = unitMap.get(extId);

            if (!unitId) {
                console.warn(`[Sync] Pominięto Hotres ID: ${extId} - brak w bazie.`);
                continue;
            }
            matchedUnits++;

            if (item.dates && Array.isArray(item.dates)) {
                item.dates.forEach((d: any) => {
                    const dateStr = normalizeDate(d.date);
                    
                    const val = d.available;
                    let isBooked = false;
                    // Logika statusu: 0/false -> booked
                    if (val === 0 || val === '0' || val === false) isBooked = true;
                    
                    const targetStatus = isBooked ? 'booked' : 'available';

                    const key = `${unitId}_${dateStr}`;
                    const existingRow = dbMap.get(key);

                    const payload: any = {
                        unit_id: unitId,
                        date: dateStr,
                        status: targetStatus,
                        reservation_id: existingRow?.reservation_id || null
                    };

                    if (existingRow) {
                        payload.id = existingRow.id; // UPDATE
                    }
                    // else INSERT

                    rowsToUpsert.push(payload);
                    processedDates++;
                });
            }
        }

        if (matchedUnits === 0) {
            throw new Error(`Nie dopasowano żadnych pokoi! Sprawdź ID w bazie. (Dostępne ID w Hotres: ${itemsToProcess.map((i: any) => i.type_id).join(', ')})`);
        }

        console.log(`[SYNC PREPARE] Matched: ${matchedUnits}. Dates: ${processedDates}.`);

        // 4. Batch Upsert
        const BATCH_SIZE = 500;
        for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
            const batch = rowsToUpsert.slice(i, i + BATCH_SIZE);
            const { error: upsertError } = await supabase.from('availability').upsert(batch);
            if (upsertError) {
                console.error("Upsert Batch Error:", upsertError);
                throw new Error(`Błąd zapisu do bazy: ${upsertError.message}`);
            }
        }

        await supabase.from('properties').update({ 
            availability_last_synced_at: new Date().toISOString(),
            availability_sync_in_progress: false
        }).eq('id', propertyId);

        return `Sukces! Zapisano ${rowsToUpsert.length} dni. (Zakres: ${fromDate} - ${tillDate})`;

    } catch (e: any) {
        await supabase.from('properties').update({ availability_sync_in_progress: false }).eq('id', propertyId);
        console.error("Sync Exception:", e);
        throw e;
    }
  };

  const markNotificationAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  };

  const markAllNotificationsAsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadCount(0);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id);
    }
  };
  
  const deleteAllReadNotifications = async () => {
    setNotifications(prev => prev.filter(n => !n.is_read));
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        await supabase.from('notifications').delete().eq('user_id', user.id).eq('is_read', true);
    }
  }

  const deleteNotification = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await supabase.from('notifications').delete().eq('id', id);
  };

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