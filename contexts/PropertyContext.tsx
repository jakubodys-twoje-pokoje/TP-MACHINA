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

  const importFromHotres = async (oid: string, propertyId: string) => {
    // 1. Fetch XML from proxy
    const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://hotres.pl/xml/cennik_xml.php?oid=${oid}&kod_waluty=PLN`)}`);
    const json = await response.json();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(json.contents, "text/xml");

    // 2. Parse Rooms
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

  // Funkcja pomocnicza do grupowania dat w zakresy
  const groupDatesIntoRanges = (dates: string[]) => {
    if (dates.length === 0) return [];
    
    // Sortowanie dat
    const sortedDates = dates.sort();
    const ranges: { start: string, end: string }[] = [];
    
    let rangeStart = sortedDates[0];
    let prevDate = new Date(sortedDates[0]);

    for (let i = 1; i < sortedDates.length; i++) {
        const currentDate = new Date(sortedDates[i]);
        const diffTime = Math.abs(currentDate.getTime() - prevDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

        if (diffDays > 1) {
            // Przerwa w datach, zamykamy obecny zakres
            ranges.push({ start: rangeStart, end: sortedDates[i-1] });
            rangeStart = sortedDates[i];
        }
        prevDate = currentDate;
    }
    // Dodaj ostatni zakres
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
        const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://hotres.pl/xml/dostepnosc_xml.php?oid=${oid}`)}`);
        const json = await response.json();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(json.contents, "text/xml");

        const rooms = Array.from(xmlDoc.getElementsByTagName("pokoj"));
        let changesCount = 0;
        const today = new Date().toISOString().split('T')[0];
        
        // 1. Pobierz WSZYSTKIE kwatery dla tego obiektu
        const { data: units } = await supabase.from('units').select('id, name, external_id').eq('property_id', propertyId);
        if (!units) throw new Error("Nie znaleziono kwater");

        // Use correct typing for unitMap
        const unitMap = new Map<string, { id: string; name: string; external_id: string }>();
        units.forEach((u: any) => {
            if (u.external_id) unitMap.set(u.external_id, u);
        });

        const availabilityUpserts: any[] = [];
        const newNotifications: any[] = [];

        // Przetwarzanie każdego pokoju z XML
        for (const room of rooms) {
            const extId = room.getElementsByTagName("id_pokoju")[0]?.textContent;
            if (!extId) continue;

            const unit = unitMap.get(extId);
            if (!unit) continue;

            const terminZajetyNodes = Array.from(room.getElementsByTagName("termin_zajety"));
            const newBookedDatesSet = new Set<string>();

            terminZajetyNodes.forEach(node => {
                const zajetyDo = node.getElementsByTagName("zajety_do")[0]?.textContent;
                const zajetyOd = node.getElementsByTagName("zajety_od")[0]?.textContent;

                if (zajetyOd && zajetyDo) {
                    let curr = new Date(zajetyOd);
                    const end = new Date(zajetyDo);
                    while (curr <= end) {
                        newBookedDatesSet.add(curr.toISOString().split('T')[0]);
                        curr.setDate(curr.getDate() + 1);
                    }
                }
            });

            // 2. Pobierz OBECNY stan z bazy
            const { data: currentDbAvailability } = await supabase
                .from('availability')
                .select('date, status')
                .eq('unit_id', unit.id)
                .gte('date', today);
            
            const currentDbMap = new Map<string, string>(); 
            currentDbAvailability?.forEach(row => currentDbMap.set(row.date, row.status));

            // 3. Logika Diffing
            const datesToBlock: string[] = [];
            const datesToFree: string[] = [];

            // Sprawdź daty z XML
            newBookedDatesSet.forEach(date => {
                if (date >= today) {
                    const currentStatus = currentDbMap.get(date);
                    if (currentStatus !== 'booked' && currentStatus !== 'blocked') {
                        datesToBlock.push(date);
                        availabilityUpserts.push({ unit_id: unit.id, date: date, status: 'booked' });
                    }
                }
            });

            // Sprawdź daty, które powinny być wolne
            currentDbMap.forEach((status, date) => {
                if ((status === 'booked' || status === 'blocked') && !newBookedDatesSet.has(date)) {
                    datesToFree.push(date);
                    availabilityUpserts.push({ unit_id: unit.id, date: date, status: 'available' });
                }
            });

            // 4. Generowanie powiadomień (jeśli nie pierwszy import)
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
                // Pierwszy import - zapisz wszystko, brak powiadomień
                newBookedDatesSet.forEach(date => {
                    if (date >= today && !currentDbMap.has(date)) {
                        availabilityUpserts.push({ unit_id: unit.id, date: date, status: 'booked' });
                    }
                });
            }
            
            changesCount += datesToBlock.length + datesToFree.length;
        }

        // 5. Wykonaj operacje na bazie (Batch)
        const BATCH_SIZE = 1000;
        for (let i = 0; i < availabilityUpserts.length; i += BATCH_SIZE) {
            const batch = availabilityUpserts.slice(i, i + BATCH_SIZE);
            const { error: upsertError } = await supabase.from('availability').upsert(batch, { onConflict: 'unit_id, date' });
            if (upsertError) console.error("Upsert error chunk", i, upsertError);
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

        return `Zaktualizowano. Wykryto zmian: ${changesCount}.`;

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