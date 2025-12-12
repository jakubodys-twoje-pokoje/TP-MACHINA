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
      // Pobieramy wszystkie properties (współdzielona baza)
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

  // Improved Helper function to fetch data (text) via robust multi-proxy fallback
  const fetchWithProxy = async (targetUrl: string): Promise<string> => {
    const proxies = [
      // 1. AllOrigins (JSON wrapper)
      async () => {
        const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`);
        if (!res.ok) throw new Error(`AllOrigins status: ${res.status}`);
        const data = await res.json();
        return data.contents; 
      },
      // 2. CodeTabs
      async () => {
        const res = await fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`);
        if (!res.ok) throw new Error(`CodeTabs status: ${res.status}`);
        return await res.text();
      },
      // 3. CorsProxy.io
      async () => {
         const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`);
         if (!res.ok) throw new Error(`CorsProxy status: ${res.status}`);
         return await res.text();
      }
    ];

    let lastError: any;
    
    for (const proxyFetch of proxies) {
      try {
        const text = await proxyFetch();
        // Basic validation that we got something meaningful
        if (text && text.trim().length > 0 && !text.includes('Access Denied') && !text.includes('404 Not Found')) {
             return text;
        }
      } catch (e) {
        console.warn("Proxy attempt failed:", e);
        lastError = e;
      }
    }

    throw new Error(`Nie udało się połączyć z Hotres przez żaden serwer pośredniczący. Błąd: ${lastError?.message || 'Brak danych'}`);
  };

  const importFromHotres = async (oid: string, propertyId: string) => {
    // Import korzysta z XML (cennik_xml.php)
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
        // Upsert unit
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

  const groupDatesIntoRanges = (dates: string[]) => {
    if (dates.length === 0) return [];
    const sortedDates = dates.sort();
    const ranges: { start: string, end: string }[] = [];
    let rangeStart = sortedDates[0];
    let prevDate = new Date(sortedDates[0]);

    for (let i = 1; i < sortedDates.length; i++) {
        const currentDate = new Date(sortedDates[i]);
        const diffTime = Math.abs(currentDate.getTime() - prevDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

        if (diffDays > 1) {
            ranges.push({ start: rangeStart, end: sortedDates[i-1] });
            rangeStart = sortedDates[i];
        }
        prevDate = currentDate;
    }
    ranges.push({ start: rangeStart, end: sortedDates[sortedDates.length - 1] });
    return ranges;
  };

  const syncAvailability = async (oid: string, propertyId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Brak autoryzacji");

    // Check if sync is already in progress
    const { data: propCheck } = await supabase.from('properties').select('availability_sync_in_progress, availability_last_synced_at').eq('id', propertyId).single();
    if (propCheck?.availability_sync_in_progress) {
        console.warn("Synchronizacja już trwa.");
        return "Pominięto (inna synchronizacja w toku)";
    }

    // Set flag
    await supabase.from('properties').update({ availability_sync_in_progress: true }).eq('id', propertyId);

    try {
        const apiUser = "admin@twojepokoje.com.pl";
        const apiPass = "Admin123@@";

        // TWARDA DATA: Cały rok 2026
        const fromDate = '2026-01-01';
        const tillDate = '2026-12-31';

        const targetUrl = `https://panel.hotres.pl/api_availability?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&from=${fromDate}&till=${tillDate}`;
        
        console.log(`Fetching availability for fixed range: ${fromDate} to ${tillDate}`);

        const rawResponse = await fetchWithProxy(targetUrl);
        const jsonText = rawResponse.trim().replace(/^\uFEFF/, '');
        
        let jsonData: any;
        try {
            jsonData = JSON.parse(jsonText);
        } catch (e) {
            console.error("JSON Parse Error", jsonText);
            throw new Error("Błąd parsowania JSON z Hotres.");
        }

        if (!Array.isArray(jsonData)) {
            if (jsonData && typeof jsonData === 'object' && 'error' in jsonData) {
                throw new Error(`Hotres API Error: ${jsonData.error}`);
            }
            const values = Object.values(jsonData);
            if (values.length > 0 && typeof values[0] === 'object') {
                jsonData = values;
            } else {
                throw new Error(`Zły format danych (nie jest tablicą)`);
            }
        }

        let changesCount = 0;
        let matchedUnitsCount = 0;
        
        // 1. Pobierz kwatery z bazy
        const { data: units } = await supabase.from('units').select('id, name, external_id').eq('property_id', propertyId);
        if (!units) throw new Error("Nie znaleziono kwater w bazie.");

        // Mapowanie external_id -> unit (TRIMOWANIE ID)
        const unitMap = new Map<string, { id: string; name: string }>();
        units.forEach((u: any) => {
            if (u.external_id) {
                unitMap.set(String(u.external_id).trim(), u);
            }
        });

        const rowsToInsert: any[] = [];
        const rowsToUpdate: any[] = [];
        const newNotifications: any[] = [];

        // Iteracja po danych z JSON
        for (const item of jsonData) {
            const typeId = String(item.type_id).trim();
            const unit = unitMap.get(typeId);

            if (!unit) {
                console.warn(`Nie znaleziono unitu w bazie dla ID Hotres: '${typeId}'`);
                continue;
            }
            matchedUnitsCount++;

            if (!item.dates || !Array.isArray(item.dates)) continue;

            const datesToBlock: string[] = [];
            const datesToFree: string[] = [];
            
            // Pobierz aktualny stan dla tego unitu z bazy, aby zrobić diff i ZDOBYĆ ID ISTNIEJĄCEGO REKORDU
            const { data: currentDbAvailability } = await supabase
                .from('availability')
                .select('id, date, status, reservation_id') // Pobieramy ID i reservation_id
                .eq('unit_id', unit.id)
                .gte('date', fromDate)
                .lte('date', tillDate);
            
            // Mapujemy po dacie, ale przechowujemy cały obiekt (id, status, reservation_id)
            const currentDbMap = new Map<string, { id: string, status: string, reservation_id: any }>(); 
            currentDbAvailability?.forEach(row => currentDbMap.set(row.date, row));

            // Przetwarzanie dat z JSON
            item.dates.forEach((dateObj: any) => {
                const dateStr = dateObj.date; // "YYYY-MM-DD"
                
                // ROZSZERZONA LOGIKA WYKRYWANIA DOSTĘPNOŚCI
                // Hotres zwraca available jako string "1"/"0" lub boolean true/false
                // Czasami też jako number 1/0
                const rawAvail = dateObj.available;
                const isAvailable = String(rawAvail) === "1" || rawAvail === true || rawAvail === 1;
                
                const currentEntry = currentDbMap.get(dateStr);
                const currentStatus = currentEntry?.status;
                const currentId = currentEntry?.id;
                const currentReservationId = currentEntry?.reservation_id;

                let newStatus: 'available' | 'booked' | 'blocked' | null = null;

                if (!isAvailable) {
                    // API: Zajęty (blokada lub rezerwacja w Hotres)
                    // Jeśli w bazie jest 'available' -> zmieniamy na 'booked'
                    // Jeśli w bazie jest 'blocked' (blokada ręczna) -> nadpisujemy 'booked' (Hotres ważniejszy)
                    if (currentStatus !== 'booked') {
                        newStatus = 'booked';
                        datesToBlock.push(dateStr);
                    }
                } else {
                    // API: Wolny
                    // Jeśli w bazie jest zajęte -> zwalniamy
                    if (currentStatus === 'booked' || currentStatus === 'blocked') {
                        newStatus = 'available';
                        datesToFree.push(dateStr);
                    }
                }

                // DIAGNOSTYKA DLA 11 STYCZNIA 2026 - LOGOWANIE DECYZJI
                if (dateStr === '2026-01-11') {
                    console.log(`[DEBUG 2026-01-11] Unit: ${unit.name} (ID: ${typeId}). 
                      API Raw Available: ${rawAvail} (Type: ${typeof rawAvail}). 
                      Interpreted as Available? ${isAvailable}. 
                      DB Status: ${currentStatus || 'NULL'}. 
                      Decision: ${newStatus ? `CHANGE TO ${newStatus}` : 'NO CHANGE'}`);
                }

                // Jeśli status się zmienia, dodajemy do listy zadań
                if (newStatus) {
                    const payload = {
                        unit_id: unit.id,
                        date: dateStr,
                        status: newStatus,
                        // KLUCZOWE: Jeśli undefined, zamień na null. Supabase nie lubi undefined w obiektach
                        reservation_id: currentReservationId || null 
                    };

                    if (currentId) {
                        // REKORD ISTNIEJE - ROBIMY UPDATE PO ID
                        rowsToUpdate.push({ ...payload, id: currentId });
                        if(dateStr === '2026-01-11') console.log("[DEBUG 2026-01-11] Pushed to rowsToUpdate:", { ...payload, id: currentId });
                    } else {
                        // REKORD NIE ISTNIEJE - ROBIMY INSERT
                        rowsToInsert.push(payload);
                        if(dateStr === '2026-01-11') console.log("[DEBUG 2026-01-11] Pushed to rowsToInsert:", payload);
                    }
                }
            });

            // Generowanie powiadomień
            if (propCheck?.availability_last_synced_at) {
                const blockRanges = groupDatesIntoRanges(datesToBlock);
                const freeRanges = groupDatesIntoRanges(datesToFree);

                blockRanges.forEach(range => {
                    newNotifications.push({
                        user_id: user.id,
                        property_id: propertyId,
                        unit_id: unit.id,
                        property_name: "Twój Obiekt", 
                        unit_name: unit.name,
                        change_type: 'blocked',
                        start_date: range.start,
                        end_date: range.end,
                        is_read: false
                    });
                });

                freeRanges.forEach(range => {
                    newNotifications.push({
                         user_id: user.id,
                         property_id: propertyId,
                         unit_id: unit.id,
                         property_name: "Twój Obiekt",
                         unit_name: unit.name,
                         change_type: 'available',
                         start_date: range.start,
                         end_date: range.end,
                         is_read: false
                    });
                });
            } else {
                 // Pierwszy import - inserty dla stanów zajętych, których nie ma w bazie
                 item.dates.forEach((dateObj: any) => {
                     const isAv = String(dateObj.available) === "1" || dateObj.available === true || dateObj.available === 1;
                     const dStr = dateObj.date;
                     if (!isAv && !currentDbMap.has(dStr)) {
                         // Unikamy duplikatów jeśli już dodaliśmy wyżej
                         if (!rowsToInsert.find(r => r.unit_id === unit.id && r.date === dStr)) {
                             rowsToInsert.push({ unit_id: unit.id, date: dStr, status: 'booked' });
                         }
                     }
                 });
            }

            changesCount += datesToBlock.length + datesToFree.length;
        }

        console.log(`Planowane operacje DB: Insert=${rowsToInsert.length}, Update=${rowsToUpdate.length}`);
        
        // Wykonanie INSERTÓW
        const BATCH_SIZE = 1000;
        for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
            const batch = rowsToInsert.slice(i, i + BATCH_SIZE);
            const { error: insertError } = await supabase.from('availability').insert(batch);
            if (insertError) console.error("Insert error chunk", i, insertError);
        }

        // Wykonanie UPDATEÓW
        for (let i = 0; i < rowsToUpdate.length; i += BATCH_SIZE) {
            const batch = rowsToUpdate.slice(i, i + BATCH_SIZE);
            // Upsert z podanym ID działa jak UPDATE. Ważne: payload ma ID.
            const { error: updateError } = await supabase.from('availability').upsert(batch);
            if (updateError) console.error("Update error chunk", i, updateError);
        }

        if (newNotifications.length > 0) {
             const { data: propName } = await supabase.from('properties').select('name').eq('id', propertyId).single();
             const fixedNotifications = newNotifications.map(n => ({...n, property_name: propName?.name || 'Obiekt' }));
             await supabase.from('notifications').insert(fixedNotifications);
        }

        await supabase.from('properties').update({ 
            availability_last_synced_at: new Date().toISOString(),
            availability_sync_in_progress: false
        }).eq('id', propertyId);

        return `Dopasowano kwater: ${matchedUnitsCount}. Zmian: ${changesCount} (Ins: ${rowsToInsert.length}, Upd: ${rowsToUpdate.length})`;

    } catch (e: any) {
        await supabase.from('properties').update({ availability_sync_in_progress: false }).eq('id', propertyId);
        console.error(e);
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