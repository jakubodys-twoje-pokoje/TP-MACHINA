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
    // Proste proxy, bez kombinacji - wersja stabilna
    const noCacheUrl = `${targetUrl}&_t=${Date.now()}`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(noCacheUrl)}`;
    
    try {
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`Proxy HTTP error: ${res.status}`);
        return await res.text();
    } catch (e: any) {
        console.warn("Proxy failed, trying direct fetch...");
        // Fallback dla wtyczek CORS lub localhost
        const resDirect = await fetch(noCacheUrl);
        if (!resDirect.ok) throw new Error(`Direct HTTP error: ${resDirect.status}`);
        return await resDirect.text();
    }
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
      const externalTypeId = room.getElementsByTagName("id_typu")[0]?.textContent || null;
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
            external_type_id: externalTypeId,
            description: `Import z Hotres (OID: ${oid})`
          });
        }
      }
    }
  };

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

  // Prosty generator UUID v4
  const uuidv4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const syncAvailability = async (oid: string, propertyId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Brak autoryzacji");

    await supabase.from('properties').update({ availability_sync_in_progress: true }).eq('id', propertyId);

    try {
        const apiUser = "admin@twojepokoje.com.pl";
        const apiPass = "Admin123@@";

        // 1. Pobierz Kwatery
        const { data: units } = await supabase.from('units').select('id, name, external_id, external_type_id').eq('property_id', propertyId);
        if (!units || units.length === 0) throw new Error("Brak kwater w bazie.");

        // Mapa ID -> Unit UUID
        const unitMap = new Map<string, string>();
        units.forEach((u: any) => {
            if (u.external_id) unitMap.set(String(u.external_id).trim(), u.id);
            if (u.external_type_id) unitMap.set(String(u.external_type_id).trim(), u.id);
        });

        // 2. Pobierz dane z Hotres (tylko 2026)
        const year = 2026;
        const fromDate = `${year}-01-01`;
        const tillDate = `${year}-12-31`;
        
        console.log(`[SYNC] Pobieranie danych dla roku ${year}...`);
        
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

        console.log(`[SYNC] Znaleziono ${itemsToProcess.length} kwater w API.`);

        // 3. Pobierz aktualny stan z bazy
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
        const processedKeys = new Set<string>(); // Unikamy duplikatów w ramach jednego wsadu

        // 4. Mapowanie
        for (const item of itemsToProcess) {
            const extId = String(item.type_id).trim();
            const unitId = unitMap.get(extId);
            
            if (unitId && item.dates && Array.isArray(item.dates)) {
                for (const d of item.dates) {
                    const dateStr = normalizeDate(d.date);
                    
                    // Deduplikacja w pamięci
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

        // 5. Zapis (w paczkach po 500)
        if (rowsToUpsert.length > 0) {
            const BATCH_SIZE = 500;
            for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
                const batch = rowsToUpsert.slice(i, i + BATCH_SIZE);
                // FIX: Dodano onConflict aby obsłużyć błąd "duplicate key value"
                // Mówimy bazie: jeśli para (unit_id, date) już istnieje, zrób update, zamiast krzyczeć.
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