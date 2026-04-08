import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Property, Availability, Unit, Notification, Price, AISuggestion } from '../types';
import { Loader2, ChevronLeft, ChevronRight, RefreshCw, Sparkles, ArrowRight, CheckSquare, Square, X, Save } from 'lucide-react';

export const CalendarView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [allUnitsAvailability, setAllUnitsAvailability] = useState<Map<string, Map<string, Availability['status']>>>(new Map());
  const [unreadNotifications, setUnreadNotifications] = useState<Notification[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'full' | 'notifications'>('notifications');

  const [loadingUnits, setLoadingUnits] = useState(true);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pricesData, setPricesData] = useState<Map<string, Price>>(new Map());
  const [priceChanges, setPriceChanges] = useState<Map<string, Partial<Price>>>(new Map());
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Map<string, AISuggestion>>(new Map());
  const [selectedSuggestion, setSelectedSuggestion] = useState<AISuggestion | null>(null);

  // Override modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideCTA, setOverrideCTA] = useState(false);
  const [overrideCTD, setOverrideCTD] = useState(false);
  const [overrideMIN, setOverrideMIN] = useState(false);

  // Bulk edit mode state
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set()); // Set of "unitId_date" keys
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditCTA, setBulkEditCTA] = useState<number | null>(null);
  const [bulkEditCTD, setBulkEditCTD] = useState<number | null>(null);
  const [bulkEditMIN, setBulkEditMIN] = useState<number | null>(null);

  // Hotres sync counter - separate for each property
  const getHotresSyncCount = (propertyId: string | null): { count: number; hourStart: number } => {
    if (!propertyId) return { count: 0, hourStart: Date.now() };

    const key = `hotres_sync_count_${propertyId}`;
    const stored = localStorage.getItem(key);
    if (!stored) return { count: 0, hourStart: Date.now() };

    const data = JSON.parse(stored);
    const currentHour = Math.floor(Date.now() / 3600000);
    const storedHour = Math.floor(data.hourStart / 3600000);

    // Reset if different hour
    if (currentHour !== storedHour) {
      return { count: 0, hourStart: Date.now() };
    }

    return data;
  };

  const [hotresSyncCount, setHotresSyncCount] = useState(getHotresSyncCount(propertyId));

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (propertyId) {
      fetchPropertyAndUnits();
      fetchUnreadNotifications();
    }
  }, [propertyId]);

  useEffect(() => {
    if (units.length > 0) {
      fetchQuarterAvailability();
      fetchPricesData();
      fetchAISuggestions();
    }
  }, [selectedDate, units]);

  // Auto-scroll to position selected date at 1/3 of viewport
  useEffect(() => {
    if (scrollContainerRef.current && !loadingAvailability) {
      // Cell width varies by screen: 70px mobile (increased for better readability), 75px tablet, 90px desktop
      const isMobile = window.innerWidth < 640;
      const isTablet = window.innerWidth >= 640 && window.innerWidth < 1024;
      const dayWidth = isMobile ? 70 : isTablet ? 75 : 90;

      // Selected date is 30 days from start (1 month before)
      const daysBeforeSelected = 30;
      // Scroll so selected date appears at 1/3 of container width
      const containerWidth = scrollContainerRef.current.clientWidth;
      const scrollPosition = (daysBeforeSelected * dayWidth) - (containerWidth / 3);

      scrollContainerRef.current.scrollLeft = Math.max(0, scrollPosition);
      if (topScrollRef.current) {
        topScrollRef.current.scrollLeft = Math.max(0, scrollPosition);
      }
    }
  }, [allUnitsAvailability, loadingAvailability]);

  // Synchronize scroll between top and bottom scrollbars
  const handleMainScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (topScrollRef.current) {
      topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const handleTopScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const fetchPropertyAndUnits = async () => {
    if (!propertyId) return;
    setLoadingUnits(true);
    const { data: propData } = await supabase.from('properties').select('*').eq('id', propertyId).single();
    setProperty(propData);

    const { data: unitsData } = await supabase.from('units').select('*').eq('property_id', propertyId).order('name');
    if (unitsData) {
      setUnits(unitsData);
    }
    setLoadingUnits(false);
  };

  const fetchQuarterAvailability = async () => {
    if (units.length === 0) return;

    setLoadingAvailability(true);

    // Calculate date range: 1 month before, 2 months after (~90 days total)
    const startDate = new Date(selectedDate);
    startDate.setDate(startDate.getDate() - 30);

    const endDate = new Date(selectedDate);
    endDate.setDate(endDate.getDate() + 60);

    const unitIds = units.map(u => u.id);
    const { data } = await supabase
      .from('availability')
      .select('unit_id, date, status')
      .in('unit_id', unitIds)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);

    const availabilityMap = new Map<string, Map<string, Availability['status']>>();

    units.forEach(unit => {
      availabilityMap.set(unit.id, new Map());
    });

    data?.forEach((record: any) => {
      const unitMap = availabilityMap.get(record.unit_id);
      if (unitMap) {
        unitMap.set(record.date, record.status);
      }
    });

    setAllUnitsAvailability(availabilityMap);
    setLoadingAvailability(false);
  };

  const fetchPricesData = async () => {
    if (units.length === 0) return;

    // Fixed date range: 20.01.2026 to 31.12.2026
    const startDate = new Date('2026-01-20');
    const endDate = new Date('2026-12-31');

    const unitIds = units.map(u => u.id);

    console.log('📊 Fetching prices for property:', property?.name, `(${property?.id})`);
    console.log('📊 Date range:', startDate.toISOString().split('T')[0], 'to', endDate.toISOString().split('T')[0]);
    console.log('📊 Unit IDs:', unitIds);

    // Check if rate_plans exist for this property
    if (property) {
      const { data: ratePlans, error: rpError } = await supabase
        .from('rate_plans')
        .select('id, name, external_id')
        .eq('property_id', property.id);

      console.log('📊 Rate plans for property:', ratePlans);

      if (!ratePlans || ratePlans.length === 0) {
        console.error('❌ No rate_plans found for this property! Run sync to import rate plans from Hotres.');
      }
      // We accept any rate plan now (not just "Booking")
    }

    // Fetch prices directly - no JOIN needed, we only use CTA/CTD/MIN from prices table
    const { data, error } = await supabase
      .from('prices')
      .select('*')
      .in('unit_id', unitIds)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);

    console.log('📊 Query params:', {
      unitIds,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0]
    });

    if (error) {
      console.error('❌ Error fetching prices:', error);
      return;
    }

    console.log('📊 Prices data fetched:', data?.length || 0, 'records');
    if (data && data.length > 0) {
      console.log('📊 Sample price records:', data.slice(0, 3));
      console.log('📊 First record keys:', Object.keys(data[0]));
      console.log('📊 First record cta/ctd/min:', {
        cta: data[0].cta,
        ctd: data[0].ctd,
        min: data[0].min,
        date: data[0].date
      });
    } else {
      console.warn('⚠️ NO PRICES DATA RETURNED FROM DATABASE');
      console.warn('⚠️ Check if data exists in prices table for these unit_ids and date range');
    }

    // Show sample with CTA/CTD/MIN values
    const withRestrictions = data?.filter(p => p.cta !== null || p.ctd !== null || p.min !== null) || [];
    console.log('📊 Records with CTA/CTD/MIN:', withRestrictions.length);
    if (withRestrictions.length > 0) {
      console.log('📊 Sample with restrictions:', withRestrictions.slice(0, 3));
    }

    // Create map keyed by unit_id + date
    // NOTE: If multiple rate_plans exist for same unit+date, use first one found
    const pricesMap = new Map<string, Price>();
    data?.forEach(price => {
      const key = `${price.unit_id}_${price.date}`;
      if (!pricesMap.has(key)) {
        pricesMap.set(key, price);
      }
    });

    console.log('📊 Prices map size:', pricesMap.size);

    // Debug: Check if we have data for visible dates
    const today = new Date().toISOString().split('T')[0];
    const sampleKey = unitIds.length > 0 ? `${unitIds[0]}_${today}` : null;
    if (sampleKey) {
      const samplePrice = pricesMap.get(sampleKey);
      console.log(`📊 Sample price for today (${today}):`, samplePrice);
    }

    // Debug: Check if data issue is about date range
    if (data && data.length > 0) {
      const dates = data.map(p => p.date).sort();
      console.log(`📊 Date range in fetched data: ${dates[0]} to ${dates[dates.length - 1]}`);
      console.log(`📊 Today (${today}) is in range:`, dates.includes(today));
    } else if (unitIds.length > 0) {
      console.warn(`⚠️ No prices data for this property! Check:`);
      console.warn(`   - Does this property have rate_plans in database?`);
      console.warn(`   - Did sync-all-availability log "No rate plans for ${property?.name}"?`);
      console.warn(`   - Check Supabase Edge Function logs for this property`);
    }

    setPricesData(pricesMap);
  };

  const fetchUnreadNotifications = async () => {
    if (!propertyId) return;

    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('property_id', propertyId)
      .eq('is_read', false)
      .order('created_at', { ascending: false });

    if (data) {
      setUnreadNotifications(data);
    }
  };

  const handlePrevMonth = () => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() - 1);
    setSelectedDate(newDate);
  };

  const handleNextMonth = () => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() + 1);
    setSelectedDate(newDate);
  };

  const handleDateChange = (dateStr: string) => {
    setSelectedDate(new Date(dateStr));
  };

  // Generate ~90 days (quarter): 30 days before, selected date, 60 days after
  const generateQuarterDates = () => {
    const dates: Date[] = [];
    const startDate = new Date(selectedDate);
    startDate.setDate(startDate.getDate() - 30);

    for (let i = 0; i < 91; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      dates.push(date);
    }

    return dates;
  };

  const dates = generateQuarterDates();

  // Filter units based on view mode
  const getFilteredUnits = (): Unit[] => {
    if (viewMode === 'full') return units;

    // Filter to only units with unread notifications
    const unitsWithNotifications = new Set(
      unreadNotifications.map(n => n.unit_id)
    );
    return units.filter(u => unitsWithNotifications.has(u.id));
  };

  const filteredUnits = getFilteredUnits();

  // Get notification summary for tags
  const getNotificationSummary = () => {
    const summary: Array<{
      unitName: string;
      dateRange: string;
      changeType: 'available' | 'blocked';
      notificationId: string;
    }> = [];
    const unitNotifications = new Map<string, Notification[]>();

    // Group notifications by unit
    unreadNotifications.forEach(notif => {
      if (!unitNotifications.has(notif.unit_id)) {
        unitNotifications.set(notif.unit_id, []);
      }
      unitNotifications.get(notif.unit_id)!.push(notif);
    });

    // Create summary entries
    unitNotifications.forEach((notifs, unitId) => {
      const unit = units.find(u => u.id === unitId);
      if (!unit) return;

      notifs.forEach(notif => {
        const startDate = new Date(notif.start_date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
        const endDate = new Date(notif.end_date).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
        summary.push({
          unitName: unit.name,
          dateRange: `${startDate} - ${endDate}`,
          changeType: notif.change_type,
          notificationId: notif.id
        });
      });
    });

    return summary;
  };

  const handleMarkNotificationAsRead = async (notificationId: string) => {
    const isCurrentlyRead = readNotificationIds.has(notificationId);
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email || null;

    if (isCurrentlyRead) {
      // Unmark as read - restore to unread state
      await supabase
        .from('notifications')
        .update({ is_read: false, read_by_email: null, read_at: null })
        .eq('id', notificationId);

      // Remove from read set
      setReadNotificationIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(notificationId);
        return newSet;
      });
    } else {
      // Mark as read
      const readAt = new Date().toISOString();
      await supabase
        .from('notifications')
        .update({ is_read: true, read_by_email: userEmail, read_at: readAt })
        .eq('id', notificationId);

      // Add to read set
      setReadNotificationIds(prev => new Set(prev).add(notificationId));
    }
  };

  const handleGoToNotificationDate = (notificationId: string) => {
    const notification = unreadNotifications.find(n => n.id === notificationId);
    if (!notification) return;

    // Set the selected date to the start date of the notification
    const startDate = new Date(notification.start_date);
    setSelectedDate(startDate);

    // Switch to full view to show the calendar
    setViewMode('full');

    // Scroll will happen automatically via useEffect
  };

  const toggleBulkEditMode = () => {
    if (bulkEditMode) {
      // Exiting bulk edit mode - clear selection
      setSelectedCells(new Set());
    }
    setBulkEditMode(!bulkEditMode);
  };

  const handleCellClick = (unitId: string, dateStr: string) => {
    if (bulkEditMode) {
      // In bulk edit mode - toggle selection
      const key = `${unitId}_${dateStr}`;
      setSelectedCells(prev => {
        const newSet = new Set(prev);
        if (newSet.has(key)) {
          newSet.delete(key);
        } else {
          newSet.add(key);
        }
        return newSet;
      });
    } else {
      // Normal mode - open modal (existing behavior)
      // This will be handled in the cell onClick
    }
  };

  const handleOpenBulkEditModal = () => {
    if (selectedCells.size === 0) {
      alert('Zaznacz przynajmniej jedną komórkę');
      return;
    }

    // Reset bulk edit values
    setBulkEditCTA(null);
    setBulkEditCTD(null);
    setBulkEditMIN(null);
    setShowBulkEditModal(true);
  };

  const handleApplyBulkEdit = () => {
    // Apply changes to all selected cells
    selectedCells.forEach(key => {
      const [unitId, dateStr] = key.split('_');
      const currentPrice = pricesData.get(key);
      const currentChange = priceChanges.get(key);

      const updatedChange: Partial<Price> = {
        ...currentChange,
        unit_id: unitId,
        date: dateStr,
        rate_id: currentPrice?.rate_id || ''
      };

      if (bulkEditCTA !== null) updatedChange.cta = bulkEditCTA;
      if (bulkEditCTD !== null) updatedChange.ctd = bulkEditCTD;
      if (bulkEditMIN !== null) updatedChange.min = bulkEditMIN;

      setPriceChanges(prev => {
        const updated = new Map(prev);
        updated.set(key, updatedChange);
        return updated;
      });
    });

    // Close modal and exit bulk edit mode
    setShowBulkEditModal(false);
    setBulkEditMode(false);
    setSelectedCells(new Set());

    alert(`✓ Zastosowano zmiany dla ${selectedCells.size} komórek`);
  };

  const handleSyncToHotres = async () => {
    if (!property) return;

    // Check limit - separate for each property
    const currentData = getHotresSyncCount(property.id);
    if (currentData.count >= 10) {
      alert('Osiągnięto limit 10 synchronizacji na godzinę dla tego obiektu. Spróbuj ponownie za chwilę.');
      return;
    }

    const hasNotifications = readNotificationIds.size > 0;
    const hasPriceChanges = priceChanges.size > 0;

    if (!hasNotifications && !hasPriceChanges) {
      alert('Brak zmian do wysłania.');
      return;
    }

    // Build confirmation message
    let confirmMsg = 'Czy na pewno chcesz wysłać zmiany na Hotres?\n\n';
    if (hasNotifications) confirmMsg += `• ${readNotificationIds.size} odczytanych powiadomień\n`;
    if (hasPriceChanges) confirmMsg += `• ${priceChanges.size} zmian w cenach/restrykcjach\n`;
    confirmMsg += '\nTa operacja jest nieodwracalna.';

    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      // Send price changes to Hotres if any
      if (hasPriceChanges) {
        await sendPriceChangesToHotres();
      }

      // Update counter for this property
      const newCount = currentData.count + 1;
      const newData = { count: newCount, hourStart: currentData.hourStart };
      const key = `hotres_sync_count_${property.id}`;
      localStorage.setItem(key, JSON.stringify(newData));
      setHotresSyncCount(newData);

      // Remove read notifications from view
      if (hasNotifications) {
        setUnreadNotifications(prev =>
          prev.filter(n => !readNotificationIds.has(n.id))
        );
        setReadNotificationIds(new Set());
      }

      // Clear price changes
      if (hasPriceChanges) {
        setPriceChanges(new Map());
        // Refresh prices data to get updated values from DB
        await fetchPricesData();
      }

      alert(`✓ Wysłano na Hotres.\nPozostało ${10 - newCount} synchronizacji w tej godzinie.`);
    } catch (error: any) {
      alert(`✗ Błąd synchronizacji: ${error.message}`);
    }
  };

  const sendPriceChangesToHotres = async () => {
    if (!property) throw new Error('Brak informacji o obiekcie');

    console.log('🏠 Sending changes for property:', property.name, 'ID:', property.id);

    // First check ALL rate_plans (including those without external_id)
    const { data: allRatePlansRaw, error: rpError } = await supabase
      .from('rate_plans')
      .select('id, name, external_id')
      .eq('property_id', property.id);

    console.log('📊 Query: property_id =', property.id);
    console.log('📊 ALL rate_plans for property (including null external_id):', allRatePlansRaw);
    console.log('📊 Error:', rpError);

    if (rpError || !allRatePlansRaw || allRatePlansRaw.length === 0) {
      throw new Error('Brak cenników dla tego obiektu. Dodaj cenniki w zakładce "Cenniki i Oferty".');
    }

    // Filter only those with external_id (needed for Hotres API)
    const allRatePlans = allRatePlansRaw.filter(rp => rp.external_id !== null && rp.external_id !== undefined);

    console.log('📊 Rate_plans WITH external_id:', allRatePlans);

    if (allRatePlans.length === 0) {
      const names = allRatePlansRaw.map(rp => rp.name).join(', ');
      throw new Error(`Cenniki istnieją (${names}), ale nie mają external_id. Pobierz cenniki z Hotres używając przycisku "Pobierz z Hotres" w zakładce Cenniki.`);
    }

    // Group changes by type_id
    const changesByTypeId = new Map<string, Array<{ date: string; cta?: number; ctd?: number; min?: number | null }>>();

    priceChanges.forEach((change, key) => {
      const unitId = change.unit_id!;
      const unit = units.find(u => u.id === unitId);
      if (!unit || !unit.external_type_id) return;

      const typeId = unit.external_type_id;

      if (!changesByTypeId.has(typeId)) {
        changesByTypeId.set(typeId, []);
      }

      changesByTypeId.get(typeId)!.push({
        date: change.date!,
        cta: change.cta,
        ctd: change.ctd,
        min: change.min
      });
    });

    // Helper: Is next day check
    const isNextDay = (dateStr1: string, dateStr2: string) => {
      const d1 = new Date(dateStr1);
      const d2 = new Date(dateStr2);
      d1.setHours(12, 0, 0, 0);
      d2.setHours(12, 0, 0, 0);
      const diffTime = Math.abs(d2.getTime() - d1.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      return diffDays === 1 && d2 > d1;
    };

    // Build payload array in Hotres format
    // CHANGED: IDs are numbers now
    const payloadArray: Array<{
      type_id: number;
      rate_id: number;
      mode: string;
      prices: Array<{
        from: string;
        till: string;
        cta?: number;
        ctd?: number;
        min?: number | null;
      }>;
    }> = [];

    // For each type_id, group changes into continuous ranges
    for (const [typeIdStr, changes] of changesByTypeId) {
      // Convert to Integer (API fix)
      const currentTypeId = parseInt(typeIdStr, 10);

      // Sort changes by date
      changes.sort((a, b) => a.date.localeCompare(b.date));

      // Group into continuous ranges with same values
      const ranges: Array<{
        from: string;
        till: string;
        cta?: number;
        ctd?: number;
        min?: number | null;
      }> = [];

      let currentRange: any = null;

      for (const change of changes) {
        const isSameValues = currentRange &&
          currentRange.cta === change.cta &&
          currentRange.ctd === change.ctd &&
          currentRange.min === change.min;

        const isNext = currentRange && isNextDay(currentRange.till, change.date);

        if (isSameValues && isNext) {
          // Extend current range
          currentRange.till = change.date;
        } else {
          // Push old range if exists
          if (currentRange) ranges.push(currentRange);

          // Start new range
          currentRange = {
            from: change.date,
            till: change.date
          };
          if (change.cta !== undefined) currentRange.cta = change.cta;
          if (change.ctd !== undefined) currentRange.ctd = change.ctd;
          if (change.min !== undefined) currentRange.min = change.min;
        }
      }

      if (currentRange) ranges.push(currentRange);

      // Send same changes to ALL rate_plans for this property
      // CTA/CTD/MIN are shared across all rate plans for same unit type
      console.log(`📋 Building payload for type_id ${currentTypeId} with ${allRatePlans.length} rate plans`);

      for (const ratePlan of allRatePlans) {
        const entry = {
          type_id: currentTypeId, // Integer
          rate_id: parseInt(ratePlan.external_id!, 10), // Integer (API fix)
          mode: 'delta',
          prices: ranges
        };
        console.log(`  ➕ Adding entry for rate_plan: ${ratePlan.name} (external_id: ${ratePlan.external_id})`);
        payloadArray.push(entry);
      }
    }

    if (payloadArray.length === 0) {
       console.error('❌ payloadArray is EMPTY - no entries to send!');
       console.log('Debug: allRatePlans:', allRatePlans);
       console.log('Debug: changesByTypeId:', changesByTypeId);
       return;
    }

    console.log(`📦 FINAL PAYLOAD (${payloadArray.length} entries):`);
    console.log(JSON.stringify(payloadArray, null, 2));

    // FIRST: Save changes to database (before sending to Hotres)
    console.log('💾 Saving changes to database first...');
    for (const [typeId, group] of changesByTypeId) {
      const unit = units.find(u => u.external_type_id === typeId);
      if (!unit) continue;

      for (const change of group) {
        const priceKey = `${unit.id}_${change.date}`;
        const existingPrice = pricesData.get(priceKey);

        if (existingPrice) {
          await supabase
            .from('prices')
            .update({
              cta: change.cta !== undefined ? change.cta : existingPrice.cta,
              ctd: change.ctd !== undefined ? change.ctd : existingPrice.ctd,
              min: change.min !== undefined ? change.min : existingPrice.min
            })
            .eq('id', existingPrice.id);
        }
      }
    }
    console.log('✅ Database updated successfully');

    // THEN: Send all changes to Hotres
    console.log('📤 Sending changes to Hotres...');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Musisz być zalogowany');

    const response = await fetch(
      'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/update-hotres-prices',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          property_id: property.id,
          payload: payloadArray
        })
      }
    );

    const responseData = await response.json();

    console.log(`📥 Edge Function response:`, responseData);

    if (!response.ok) {
      const errMsg = responseData?.error || JSON.stringify(responseData);
      throw new Error(`Błąd Hotres (${response.status}): ${errMsg}`);
    }

    console.log('✅ Hotres API responded successfully');
    console.log('📥 Hotres raw response:', responseData.hotres_response);
  };

  const handleOpenOverrideModal = () => {
    // Password protection
    const password = prompt('⚠️ NADPISZ RESTRYKCJE W HOTRES\n\nWpisz hasło aby kontynuować:');

    if (password !== 'wyjebtowpizdu') {
      if (password !== null) {
        alert('❌ Nieprawidłowe hasło');
      }
      return;
    }

    // Reset toggles and open modal
    setOverrideCTA(false);
    setOverrideCTD(false);
    setOverrideMIN(false);
    setShowOverrideModal(true);
  };

  const handleConfirmOverride = async () => {
    if (!property) return;

    // Check if at least one option is selected
    if (!overrideCTA && !overrideCTD && !overrideMIN) {
      alert('❌ Wybierz przynajmniej jedną opcję');
      return;
    }

    // Build confirmation message
    const selected: string[] = [];
    if (overrideCTA) selected.push('CTA');
    if (overrideCTD) selected.push('CTD');
    if (overrideMIN) selected.push('MIN nocy');

    if (!confirm(`🚨 UWAGA! 🚨\n\nZa chwilę wyślesz do Hotresa:\n• ${selected.join(', ')}\n• Wszystkie jednostki\n• Wszystkie dni (20.01.2026 - 31.12.2026)\n\nTo NADPISZE istniejące dane w Hotresie!\n\nCzy na pewno chcesz kontynuować?`)) {
      return;
    }

    try {
      setShowOverrideModal(false);
      await sendAllPricesToHotres();
      alert(`✅ SUKCES!\n\nWysłano: ${selected.join(', ')}`);
    } catch (error: any) {
      alert(`❌ Błąd: ${error.message}`);
      console.error('Error overwriting restrictions:', error);
    }
  };

  const sendAllPricesToHotres = async () => {
    if (!property) throw new Error('Brak informacji o obiekcie');

    console.log('🏠 OVERWRITE ALL: Sending ALL restrictions (CTA/CTD/MIN) for property:', property.name, 'ID:', property.id);

    // Get all rate_plans
    const { data: allRatePlansRaw, error: rpError } = await supabase
      .from('rate_plans')
      .select('id, name, external_id')
      .eq('property_id', property.id);

    console.log('📊 ALL rate_plans for property:', allRatePlansRaw);

    if (rpError || !allRatePlansRaw || allRatePlansRaw.length === 0) {
      throw new Error('Brak cenników dla tego obiektu. Dodaj cenniki w zakładce "Cenniki i Oferty".');
    }

    // Filter only those with external_id
    const allRatePlans = allRatePlansRaw.filter(rp => rp.external_id !== null && rp.external_id !== undefined);

    console.log('📊 Rate_plans WITH external_id:', allRatePlans);

    if (allRatePlans.length === 0) {
      const names = allRatePlansRaw.map(rp => rp.name).join(', ');
      throw new Error(`Cenniki istnieją (${names}), ale nie mają external_id. Pobierz cenniki z Hotres używając przycisku "Pobierz z Hotres" w zakładce Cenniki.`);
    }

    // Fixed date range: 20.01.2026 to 31.12.2026
    const startDate = new Date('2026-01-20');
    const endDate = new Date('2026-12-31');

    const unitIds = units.map(u => u.id);

    console.log('📊 Fetching ALL restrictions (CTA/CTD/MIN) from database...');
    console.log('📊 Date range:', startDate.toISOString().split('T')[0], 'to', endDate.toISOString().split('T')[0]);
    console.log('📊 Unit IDs:', unitIds);

    // Fetch ALL restrictions from database (CTA/CTD/MIN only)
    const { data: allPrices, error: pricesError } = await supabase
      .from('prices')
      .select('unit_id, date, cta, ctd, min')
      .in('unit_id', unitIds)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);

    if (pricesError) {
      throw new Error(`Błąd pobierania restrykcji: ${pricesError.message}`);
    }

    if (!allPrices || allPrices.length === 0) {
      throw new Error('Brak danych restrykcji w bazie. Zsynchronizuj dane z Hotres najpierw.');
    }

    console.log('📊 Fetched', allPrices.length, 'restriction records from database');
    console.log('📊 Selected fields to send:', { CTA: overrideCTA, CTD: overrideCTD, MIN: overrideMIN });

    // Group ALL prices by type_id (only include selected fields)
    const pricesByTypeId = new Map<string, Array<{ date: string; cta?: number; ctd?: number; min?: number | null }>>();

    allPrices.forEach((price) => {
      const unit = units.find(u => u.id === price.unit_id);
      if (!unit || !unit.external_type_id) return;

      const typeId = unit.external_type_id;

      if (!pricesByTypeId.has(typeId)) {
        pricesByTypeId.set(typeId, []);
      }

      // Build price object with only selected fields
      const priceObj: { date: string; cta?: number; ctd?: number; min?: number | null } = {
        date: price.date
      };
      if (overrideCTA) priceObj.cta = price.cta;
      if (overrideCTD) priceObj.ctd = price.ctd;
      if (overrideMIN) priceObj.min = price.min;

      pricesByTypeId.get(typeId)!.push(priceObj);
    });

    // Helper: Is next day check
    const isNextDay = (dateStr1: string, dateStr2: string) => {
      const d1 = new Date(dateStr1);
      const d2 = new Date(dateStr2);
      d1.setHours(12, 0, 0, 0);
      d2.setHours(12, 0, 0, 0);
      const diffTime = Math.abs(d2.getTime() - d1.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays === 1 && d2 > d1;
    };

    // Build payload array in Hotres format
    const payloadArray: Array<{
      type_id: number;
      rate_id: number;
      mode: string;
      prices: Array<{
        from: string;
        till: string;
        cta?: number;
        ctd?: number;
        min?: number | null;
      }>;
    }> = [];

    // For each type_id, group prices into continuous ranges
    for (const [typeIdStr, prices] of pricesByTypeId) {
      const currentTypeId = parseInt(typeIdStr, 10);

      // Sort prices by date
      prices.sort((a, b) => a.date.localeCompare(b.date));

      // Group into continuous ranges with same values
      const ranges: Array<{
        from: string;
        till: string;
        cta?: number;
        ctd?: number;
        min?: number | null;
      }> = [];

      let currentRange: any = null;

      for (const price of prices) {
        // Check if values match (only for selected fields)
        let isSameValues = !!currentRange;
        if (overrideCTA && currentRange) isSameValues = isSameValues && currentRange.cta === price.cta;
        if (overrideCTD && currentRange) isSameValues = isSameValues && currentRange.ctd === price.ctd;
        if (overrideMIN && currentRange) isSameValues = isSameValues && currentRange.min === price.min;

        const isNext = currentRange && isNextDay(currentRange.till, price.date);

        if (isSameValues && isNext) {
          // Extend current range
          currentRange.till = price.date;
        } else {
          // Push old range if exists
          if (currentRange) ranges.push(currentRange);

          // Start new range (only with selected fields)
          currentRange = {
            from: price.date,
            till: price.date
          };
          if (overrideCTA && price.cta !== undefined) currentRange.cta = price.cta;
          if (overrideCTD && price.ctd !== undefined) currentRange.ctd = price.ctd;
          if (overrideMIN && price.min !== undefined) currentRange.min = price.min;
        }
      }

      if (currentRange) ranges.push(currentRange);

      // Send same data to ALL rate_plans for this property
      console.log(`📋 Building payload for type_id ${currentTypeId} with ${allRatePlans.length} rate plans`);

      for (const ratePlan of allRatePlans) {
        const entry = {
          type_id: currentTypeId,
          rate_id: parseInt(ratePlan.external_id!, 10),
          mode: 'delta',
          prices: ranges
        };
        console.log(`  ➕ Adding entry for rate_plan: ${ratePlan.name} (external_id: ${ratePlan.external_id})`);
        payloadArray.push(entry);
      }
    }

    if (payloadArray.length === 0) {
      throw new Error('Brak danych do wysłania. Sprawdź czy jednostki mają external_type_id.');
    }

    console.log(`📦 FINAL PAYLOAD (${payloadArray.length} entries - CTA/CTD/MIN only):`);
    console.log(JSON.stringify(payloadArray, null, 2));

    // Send to Hotres (mode: delta - only restrictions, no prices)
    console.log('📤 Sending ALL restrictions (CTA/CTD/MIN) to Hotres using mode: delta...');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Musisz być zalogowany');

    const response = await fetch(
      'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/update-hotres-prices',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          property_id: property.id,
          payload: payloadArray
        })
      }
    );

    const responseData = await response.json();

    console.log(`📥 Edge Function response:`, responseData);

    if (!response.ok) {
      const errMsg = responseData?.error || JSON.stringify(responseData);
      throw new Error(`Błąd Hotres (${response.status}): ${errMsg}`);
    }

    console.log('✅ ALL RESTRICTIONS (CTA/CTD/MIN) sent to Hotres successfully');
    console.log('📥 Hotres raw response:', responseData.hotres_response);
  };

  const handleCtaChange = (unitId: string, dateStr: string, checked: boolean) => {
    const key = `${unitId}_${dateStr}`;
    const currentPrice = pricesData.get(key);
    const currentChange = priceChanges.get(key);
    const newCta = checked ? 1 : 0;

    setPriceChanges(prev => {
      const updated = new Map(prev);
      const updatedChange = {
        ...currentChange,
        unit_id: unitId,
        date: dateStr,
        rate_id: currentPrice?.rate_id || '',
        cta: newCta
      };

      // Check if all values match original - if so, remove from changes
      const ctaMatches = (currentPrice?.cta === 1) === checked;
      const ctdMatches = updatedChange.ctd === undefined || updatedChange.ctd === (currentPrice?.ctd === 1 ? 1 : 0);
      const minMatches = updatedChange.min === undefined || updatedChange.min === (currentPrice?.min || null);

      if (ctaMatches && ctdMatches && minMatches) {
        updated.delete(key);
        console.log('CTA: Removed change for', key, '- matches original');
      } else {
        updated.set(key, updatedChange);
        console.log('CTA: Added/updated change for', key, '- total changes:', updated.size);
      }

      return updated;
    });
  };

  const handleCtdChange = (unitId: string, dateStr: string, checked: boolean) => {
    const key = `${unitId}_${dateStr}`;
    const currentPrice = pricesData.get(key);
    const currentChange = priceChanges.get(key);
    const newCtd = checked ? 1 : 0;

    setPriceChanges(prev => {
      const updated = new Map(prev);
      const updatedChange = {
        ...currentChange,
        unit_id: unitId,
        date: dateStr,
        rate_id: currentPrice?.rate_id || '',
        ctd: newCtd
      };

      // Check if all values match original - if so, remove from changes
      const ctaMatches = updatedChange.cta === undefined || updatedChange.cta === (currentPrice?.cta === 1 ? 1 : 0);
      const ctdMatches = (currentPrice?.ctd === 1) === checked;
      const minMatches = updatedChange.min === undefined || updatedChange.min === (currentPrice?.min || null);

      if (ctaMatches && ctdMatches && minMatches) {
        updated.delete(key);
        console.log('CTD: Removed change for', key, '- matches original');
      } else {
        updated.set(key, updatedChange);
        console.log('CTD: Added/updated change for', key, '- total changes:', updated.size);
      }

      return updated;
    });
  };

  const handleMinChange = (unitId: string, dateStr: string, value: string) => {
    const key = `${unitId}_${dateStr}`;
    const currentPrice = pricesData.get(key);
    const currentChange = priceChanges.get(key);
    const minValue = value === '' ? null : parseInt(value);

    setPriceChanges(prev => {
      const updated = new Map(prev);
      const updatedChange = {
        ...currentChange,
        unit_id: unitId,
        date: dateStr,
        rate_id: currentPrice?.rate_id || '',
        min: minValue
      };

      // Check if all values match original - if so, remove from changes
      const ctaMatches = updatedChange.cta === undefined || updatedChange.cta === (currentPrice?.cta === 1 ? 1 : 0);
      const ctdMatches = updatedChange.ctd === undefined || updatedChange.ctd === (currentPrice?.ctd === 1 ? 1 : 0);
      const minMatches = (currentPrice?.min || null) === minValue;

      if (ctaMatches && ctdMatches && minMatches) {
        updated.delete(key);
        console.log('MIN: Removed change for', key, '- matches original');
      } else {
        updated.set(key, updatedChange);
        console.log('MIN: Added/updated change for', key, '- total changes:', updated.size);
      }

      return updated;
    });
  };

  const triggerAvailabilitySync = async () => {
    if (syncing) return;

    if (!property) {
      alert('Najpierw wybierz obiekt');
      return;
    }

    if (!confirm(`Czy na pewno chcesz zsynchronizować obiekt "${property.name}"?\n\nZosataną zsynchronizowane:\n• Dostępność (availability)\n• Ceny i restrykcje (CTA/CTD/MIN)`)) {
      return;
    }

    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('Musisz być zalogowany aby wykonać synchronizację');
        return;
      }

      console.log(`🚀 Starting sync for property: ${property.name} (${property.id})`);

      const response = await fetch(
        'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/sync-single-property',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ property_id: property.id })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sync failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      console.log('Manual sync result:', result);

      // Format detailed result message
      const availMsg = result.availability.success
        ? `✓ Availability: ${result.availability.recordsCompared} rekordów`
        : `✗ Availability: ${result.availability.error}`;

      const pricesMsg = result.prices.success
        ? `✓ Prices: ${result.prices.recordsCompared} rekordów`
        : `✗ Prices: ${result.prices.error}`;

      alert(`Synchronizacja zakończona dla: ${property.name}\n\n${availMsg}\n${pricesMsg}\n\nSprawdź konsolę przeglądarki (F12) aby zobaczyć szczegółowe logi.`);

      // Refresh availability and prices data after sync
      if (units.length > 0) {
        await fetchQuarterAvailability();
        await fetchPricesData();
      }
    } catch (error: any) {
      console.error('Manual sync error:', error);
      alert(`Błąd synchronizacji: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleAIOptimization = async () => {
    if (isLoadingAI) return;

    if (unreadNotifications.length === 0) {
      alert('Brak powiadomień do optymalizacji');
      return;
    }

    if (!confirm(`Czy chcesz zatrudnić AI do optymalizacji ${unreadNotifications.length} powiadomień?\n\nAI zaproponuje ustawienia CTA/CTD/MIN na podstawie historii rezerwacji.`)) {
      return;
    }

    setIsLoadingAI(true);

    try {
      const notificationIds = unreadNotifications.map(n => n.id);

      console.log('🤖 Sending to AI:', { notification_ids: notificationIds });

      const response = await fetch('https://n8n.twojepokoje.com.pl/webhook/181df836-8c89-47d2-b611-07cd556473f8', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_ids: notificationIds
        })
      });

      console.log('🤖 Response status:', response.status, response.statusText);

      const responseText = await response.text();
      console.log('🤖 Response text:', responseText);

      if (!response.ok) {
        throw new Error(`Webhook error: ${response.status} ${response.statusText}\n${responseText}`);
      }

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${responseText}`);
      }

      console.log('🤖 AI suggestions:', result);

      // Refresh AI suggestions to show them in calendar
      await fetchAISuggestions();

      alert(`✅ AI wygenerował ${result.count || 0} sugestii!\n\nZostały oznaczone ŻÓŁTYMI komórkami 🤖 w kalendarzu.\n\nKliknij na żółtą komórkę aby zobaczyć szczegóły i zaakceptować/odrzucić sugestię.`);

    } catch (error: any) {
      console.error('❌ AI optimization failed:', error);
      alert(`Błąd generowania sugestii AI:\n\n${error.message}`);
    } finally {
      setIsLoadingAI(false);
    }
  };

  // Fetch AI suggestions for current view
  const fetchAISuggestions = async () => {
    if (!propertyId || units.length === 0) return;

    const startDate = new Date(selectedDate);
    startDate.setDate(1);
    const endDate = new Date(selectedDate);
    endDate.setMonth(endDate.getMonth() + 3);

    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('*')
      .eq('property_id', propertyId)
      .eq('status', 'pending')
      .gte('date_start', startDate.toISOString().split('T')[0])
      .lte('date_end', endDate.toISOString().split('T')[0]);

    if (error) {
      console.error('Error fetching AI suggestions:', error);
      return;
    }

    if (data) {
      const suggestionsMap = new Map<string, AISuggestion>();
      data.forEach((suggestion: AISuggestion) => {
        const key = `${suggestion.unit_id}-${suggestion.date_start}`;
        suggestionsMap.set(key, suggestion);
      });
      setAiSuggestions(suggestionsMap);
    }
  };

  // Apply AI suggestion to staging (priceChanges) - does NOT send to Hotres yet
  const handleApplySuggestion = async (suggestion: AISuggestion) => {
    try {
      const priceKey = `${suggestion.unit_id}_${suggestion.date_start}`;

      // Add to staging area (priceChanges)
      setPriceChanges(prev => {
        const updated = new Map(prev);
        updated.set(priceKey, {
          cta: suggestion.suggested_cta,
          ctd: suggestion.suggested_ctd,
          min: suggestion.suggested_min
        });
        return updated;
      });

      // Mark suggestion as applied in database
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('ai_suggestions')
        .update({
          status: 'applied',
          applied_at: new Date().toISOString(),
          applied_by: user?.email || null
        })
        .eq('id', suggestion.id);

      if (error) {
        throw new Error(`Failed to mark suggestion as applied: ${error.message}`);
      }

      // Remove from aiSuggestions map (yellow cell disappears)
      setAiSuggestions(prev => {
        const updated = new Map(prev);
        const key = `${suggestion.unit_id}-${suggestion.date_start}`;
        updated.delete(key);
        return updated;
      });

      setSelectedSuggestion(null);
      // No alert - silent operation, user will send to Hotres later
    } catch (error: any) {
      console.error('Error applying suggestion:', error);
      alert(`Błąd podczas akceptowania sugestii:\n\n${error.message}`);
    }
  };

  // Reject AI suggestion - DELETE completely from database
  const handleRejectSuggestion = async (suggestion: AISuggestion) => {
    try {
      const { error } = await supabase
        .from('ai_suggestions')
        .delete()
        .eq('id', suggestion.id);

      if (error) {
        throw new Error(error.message);
      }

      // Remove from aiSuggestions map
      setAiSuggestions(prev => {
        const updated = new Map(prev);
        const key = `${suggestion.unit_id}-${suggestion.date_start}`;
        updated.delete(key);
        return updated;
      });

      setSelectedSuggestion(null);
    } catch (error: any) {
      console.error('Error rejecting suggestion:', error);
      alert(`Błąd podczas odrzucania sugestii:\n\n${error.message}`);
    }
  };

  // Accept all pending AI suggestions at once
  const handleAcceptAll = async () => {
    if (aiSuggestions.size === 0) {
      alert('Brak sugestii AI do zaakceptowania');
      return;
    }

    if (!confirm(`Czy chcesz zaakceptować wszystkie ${aiSuggestions.size} sugestii AI?\n\nZmiany zostaną dodane do staging i będą czekać na wysłanie do Hotres.`)) {
      return;
    }

    try {
      const suggestions = Array.from(aiSuggestions.values());

      // Add all to priceChanges
      setPriceChanges(prev => {
        const updated = new Map(prev);
        suggestions.forEach(suggestion => {
          const priceKey = `${suggestion.unit_id}_${suggestion.date_start}`;
          updated.set(priceKey, {
            cta: suggestion.suggested_cta,
            ctd: suggestion.suggested_ctd,
            min: suggestion.suggested_min
          });
        });
        return updated;
      });

      // Mark all as applied
      const { data: { user } } = await supabase.auth.getUser();
      const suggestionIds = suggestions.map(s => s.id);

      const { error } = await supabase
        .from('ai_suggestions')
        .update({
          status: 'applied',
          applied_at: new Date().toISOString(),
          applied_by: user?.email || null
        })
        .in('id', suggestionIds);

      if (error) {
        throw new Error(error.message);
      }

      // Clear all from view
      setAiSuggestions(new Map());

      alert(`✅ Zaakceptowano ${suggestions.length} sugestii AI!\n\nZmiany są w staging - kliknij "Wyślij do Hotres" aby je wysłać.`);
    } catch (error: any) {
      console.error('Error accepting all suggestions:', error);
      alert(`Błąd podczas akceptowania sugestii:\n\n${error.message}`);
    }
  };

  // Submit feedback (thumbs up/down)
  const handleFeedback = async (suggestion: AISuggestion, isPositive: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('ai_suggestion_feedback')
        .insert({
          suggestion_id: suggestion.id,
          user_email: user?.email || 'anonymous',
          is_positive: isPositive,
          comment: null
        });

      if (error) {
        throw new Error(error.message);
      }

      alert(isPositive ? '👍 Dziękujemy za pozytywną opinię!' : '👎 Dziękujemy za feedback!');
      setSelectedSuggestion(null);
    } catch (error: any) {
      console.error('Error submitting feedback:', error);
      alert(`Błąd podczas zapisywania feedbacku:\n\n${error.message}`);
    }
  };

  // Check if date has AI suggestion
  const hasAISuggestion = (unitId: string, dateStr: string): AISuggestion | null => {
    const key = `${unitId}-${dateStr}`;
    return aiSuggestions.get(key) || null;
  };

  const getStatusColor = (status?: Availability['status']) => {
    if (!status || status === 'available') return 'bg-green-600/50 hover:bg-green-600/70';
    return 'bg-red-600/50 hover:bg-red-600/70';
  };

  // Helper to check if a date has an unread notification (not read yet)
  const hasUnreadNotification = (unitId: string, dateStr: string): boolean => {
    return unreadNotifications.some(notification => {
      if (notification.unit_id !== unitId) return false;
      if (readNotificationIds.has(notification.id)) return false; // Skip read ones

      const notifStart = new Date(notification.start_date);
      const notifEnd = new Date(notification.end_date);
      const checkDate = new Date(dateStr);

      return checkDate >= notifStart && checkDate <= notifEnd;
    });
  };

  // Helper to get notification boundary position (for separate notification boxes)
  const getNotificationPosition = (unitId: string, dateStr: string, dateIndex: number): 'start' | 'middle' | 'end' | 'single' | null => {
    const currentDate = new Date(dateStr);

    // Find all notifications covering current day
    const currentNotifs = unreadNotifications.filter(notif => {
      if (notif.unit_id !== unitId) return false;
      if (readNotificationIds.has(notif.id)) return false;

      const notifStart = new Date(notif.start_date);
      const notifEnd = new Date(notif.end_date);

      return currentDate >= notifStart && currentDate <= notifEnd;
    });

    if (currentNotifs.length === 0) return null;

    // Check if any of current notifications also cover previous day
    const prevDateStr = dateIndex > 0 ? dates[dateIndex - 1].toISOString().split('T')[0] : null;
    const prevDate = prevDateStr ? new Date(prevDateStr) : null;
    const hasPrevSharedNotif = prevDate ? currentNotifs.some(notif => {
      const notifStart = new Date(notif.start_date);
      const notifEnd = new Date(notif.end_date);
      return prevDate >= notifStart && prevDate <= notifEnd;
    }) : false;

    // Check if any of current notifications also cover next day
    const nextDateStr = dateIndex < dates.length - 1 ? dates[dateIndex + 1].toISOString().split('T')[0] : null;
    const nextDate = nextDateStr ? new Date(nextDateStr) : null;
    const hasNextSharedNotif = nextDate ? currentNotifs.some(notif => {
      const notifStart = new Date(notif.start_date);
      const notifEnd = new Date(notif.end_date);
      return nextDate >= notifStart && nextDate <= notifEnd;
    }) : false;

    // Separate boxes for each notification
    if (!hasPrevSharedNotif && !hasNextSharedNotif) return 'single';
    if (!hasPrevSharedNotif && hasNextSharedNotif) return 'start';
    if (hasPrevSharedNotif && !hasNextSharedNotif) return 'end';
    return 'middle';
  };

  if (loadingUnits) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-indigo-400" size={32} />
      </div>
    );
  }

  if (units.length === 0) {
    return (
      <div className="text-center py-20 text-slate-400">
        <p>Brak kwater w tym obiekcie.</p>
      </div>
    );
  }

  const selectedDateStr = selectedDate.toISOString().split('T')[0];
  const startDateStr = dates[0].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  const endDateStr = dates[dates.length - 1].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-2 sm:space-y-4 w-full max-w-full px-2 sm:px-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white">{property?.name}</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Widok kwartalny dostępności</p>
        </div>
      </div>

      <div className="bg-surface rounded-lg sm:rounded-xl border border-border p-2 sm:p-3 shadow-lg relative w-full">
        {loadingAvailability && (
          <div className="absolute inset-0 bg-surface/50 backdrop-blur-sm flex items-center justify-center z-10 rounded-xl">
            <Loader2 className="animate-spin text-indigo-400" size={32} />
          </div>
        )}

        {/* Navigation and Date Picker */}
        <div className="flex flex-col sm:flex-row items-center justify-between mb-2 sm:mb-3 gap-2">
          <button
            onClick={handlePrevMonth}
            className="p-1.5 sm:p-2 rounded-md hover:bg-slate-700 transition-colors"
            title="Poprzedni miesiąc"
          >
            <ChevronLeft size={20} className="sm:w-6 sm:h-6" />
          </button>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4">
            {/* View Mode Toggle */}
            <div className="flex gap-0.5 sm:gap-1 bg-slate-800 rounded-lg p-0.5 sm:p-1">
              <button
                onClick={() => setViewMode('full')}
                className={`px-2 py-0.5 sm:px-3 sm:py-1 text-[10px] sm:text-xs rounded-md transition-colors ${
                  viewMode === 'full'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Pełny
              </button>
              <button
                onClick={() => setViewMode('notifications')}
                className={`px-2 py-0.5 sm:px-3 sm:py-1 text-[10px] sm:text-xs rounded-md transition-colors ${
                  viewMode === 'notifications'
                    ? 'bg-yellow-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Powiadomienia
              </button>
            </div>

            {/* AI Optimization Button - only in notifications view */}
            {viewMode === 'notifications' && unreadNotifications.length > 0 && (
              <button
                onClick={handleAIOptimization}
                disabled={isLoadingAI}
                className="flex items-center gap-1 sm:gap-2 px-2 py-1 sm:px-3 sm:py-2 text-[10px] sm:text-xs bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium whitespace-nowrap"
                title={`Zatrudnij AI do optymalizacji ${unreadNotifications.length} powiadomień`}
              >
                {isLoadingAI ? (
                  <>
                    <Loader2 size={12} className="sm:w-3.5 sm:h-3.5 animate-spin" />
                    <span className="hidden sm:inline">AI pracuje...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={12} className="sm:w-3.5 sm:h-3.5" />
                    <span className="hidden sm:inline">🤖 Zatrudnij AI ({unreadNotifications.length})</span>
                    <span className="sm:hidden">🤖 AI ({unreadNotifications.length})</span>
                  </>
                )}
              </button>
            )}

            {aiSuggestions.size > 0 && (
              <button
                onClick={handleAcceptAll}
                className="flex items-center gap-1 sm:gap-2 px-2 py-1 sm:px-3 sm:py-2 text-[10px] sm:text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium whitespace-nowrap"
                title={`Zaakceptuj wszystkie ${aiSuggestions.size} sugestie AI`}
              >
                <Sparkles size={12} className="sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">✓ Akceptuj wszystkie ({aiSuggestions.size})</span>
                <span className="sm:hidden">✓ ({aiSuggestions.size})</span>
              </button>
            )}

            {/* Bulk Edit Mode Toggle - only in full view */}
            {viewMode === 'full' && (
              <>
                <button
                  onClick={toggleBulkEditMode}
                  className={`flex items-center gap-1 sm:gap-2 px-2 py-1 sm:px-3 sm:py-2 text-[10px] sm:text-xs rounded-lg transition-colors font-medium whitespace-nowrap ${
                    bulkEditMode
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                  }`}
                >
                  {bulkEditMode ? (
                    <>
                      <X size={12} className="sm:w-3.5 sm:h-3.5" />
                      <span className="hidden sm:inline">Anuluj ({selectedCells.size})</span>
                      <span className="sm:hidden">✕ ({selectedCells.size})</span>
                    </>
                  ) : (
                    <>
                      <CheckSquare size={12} className="sm:w-3.5 sm:h-3.5" />
                      <span className="hidden sm:inline">Zaznacz wiele</span>
                      <span className="sm:hidden">☑ Wiele</span>
                    </>
                  )}
                </button>

                {bulkEditMode && selectedCells.size > 0 && (
                  <button
                    onClick={handleOpenBulkEditModal}
                    className="flex items-center gap-1 sm:gap-2 px-2 py-1 sm:px-3 sm:py-2 text-[10px] sm:text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium whitespace-nowrap"
                  >
                    <Save size={12} className="sm:w-3.5 sm:h-3.5" />
                    <span className="hidden sm:inline">Zmień wiele ({selectedCells.size})</span>
                    <span className="sm:hidden">✓ ({selectedCells.size})</span>
                  </button>
                )}
              </>
            )}

            <input
              type="date"
              value={selectedDateStr}
              onChange={(e) => handleDateChange(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 sm:px-3 sm:py-2 text-white text-[11px] sm:text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <span className="hidden md:inline text-slate-400 text-xs sm:text-sm whitespace-nowrap">
              {startDateStr} - {endDateStr}
            </span>
          </div>

          <button
            onClick={handleNextMonth}
            className="p-1.5 sm:p-2 rounded-md hover:bg-slate-700 transition-colors"
            title="Następny miesiąc"
          >
            <ChevronRight size={20} className="sm:w-6 sm:h-6" />
          </button>
        </div>

        {/* Notification Tags */}
        {viewMode === 'notifications' && unreadNotifications.length > 0 && (
          <div className="mb-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {getNotificationSummary().map((item, idx) => {
                const isRead = readNotificationIds.has(item.notificationId);
                const isAvailable = item.changeType === 'available';

                // Gray out if read
                const bgColor = isRead
                  ? 'bg-slate-800/50'
                  : isAvailable ? 'bg-green-900/30' : 'bg-red-900/30';
                const borderColor = isRead
                  ? 'border-slate-700/50'
                  : isAvailable ? 'border-green-700/50' : 'border-red-700/50';
                const nameColor = isRead
                  ? 'text-slate-500'
                  : isAvailable ? 'text-green-400' : 'text-red-400';
                const dateColor = isRead
                  ? 'text-slate-600'
                  : isAvailable ? 'text-green-300' : 'text-red-300';

                return (
                  <div
                    key={idx}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 ${bgColor} border ${borderColor} rounded-full text-[10px] ${
                      isRead ? 'opacity-60' : ''
                    }`}
                  >
                    <span className={`font-semibold ${nameColor}`}>{item.unitName}</span>
                    <span className={dateColor}>{item.dateRange}</span>

                    <div className="flex items-center gap-0.5 ml-1">
                      {/* Go to date button */}
                      <button
                        onClick={() => handleGoToNotificationDate(item.notificationId)}
                        className="p-0.5 hover:bg-slate-700/50 rounded transition-colors"
                        title="Przejdź do daty"
                      >
                        <ArrowRight size={12} className="text-indigo-400" />
                      </button>

                      {/* Mark as read/unread button */}
                      <button
                        onClick={() => handleMarkNotificationAsRead(item.notificationId)}
                        className="p-0.5 hover:bg-slate-700/50 rounded transition-colors"
                        title={isRead ? "Cofnij odczytanie" : "Oznacz jako odczytane"}
                      >
                        {isRead ? (
                          <CheckSquare size={12} className="text-green-500" />
                        ) : (
                          <Square size={12} className="text-slate-500" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Sync to Hotres Button */}
            {(readNotificationIds.size > 0 || priceChanges.size > 0) && (
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={handleSyncToHotres}
                  className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2 px-3 sm:py-2.5 sm:px-5 rounded-lg shadow-md transition-all hover:shadow-lg active:scale-98 flex items-center justify-center gap-1 sm:gap-2"
                >
                  <span className="text-xs sm:text-sm">Wyślij na Hotres</span>
                  <div className="flex gap-0.5 sm:gap-1">
                    {readNotificationIds.size > 0 && (
                      <span className="text-[10px] bg-yellow-800 px-2 py-0.5 rounded-full">
                        {readNotificationIds.size} powiad.
                      </span>
                    )}
                    {priceChanges.size > 0 && (
                      <span className="text-[10px] bg-yellow-800 px-2 py-0.5 rounded-full">
                        {priceChanges.size} zmian
                      </span>
                    )}
                  </div>
                </button>
                <div className="text-[10px] sm:text-xs text-slate-400 whitespace-nowrap">
                  <span className="hidden sm:inline">Pozostało: </span><span className="font-bold text-yellow-400">{10 - hotresSyncCount.count}</span>/10
                </div>
              </div>
            )}

            {/* OVERRIDE Button - Always Visible */}
            <div className="mt-3">
              <button
                onClick={handleOpenOverrideModal}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 sm:py-2.5 sm:px-5 rounded-lg shadow-md transition-all hover:shadow-lg active:scale-98 flex items-center justify-center gap-2"
              >
                <span className="text-xs sm:text-sm">🚨 OVERRIDE</span>
              </button>
              <p className="text-[10px] text-slate-500 text-center mt-1">Nadpisz wybrane restrykcje w Hotresie (wymaga hasła)</p>
            </div>
          </div>
        )}

        {/* Empty state for notifications view */}
        {viewMode === 'notifications' && unreadNotifications.length === 0 && (
          <div className="mb-3 p-4 bg-slate-800/50 rounded-lg text-center">
            <p className="text-slate-400 text-sm">Brak nieodczytanych powiadomień</p>
          </div>
        )}

        {/* Sync to Hotres Button for Full View */}
        {viewMode === 'full' && priceChanges.size > 0 && (
          <div className="mb-2 sm:mb-3 flex items-center gap-2 sm:gap-3">
            <button
              onClick={handleSyncToHotres}
              className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white font-semibold py-2 px-3 sm:py-2.5 sm:px-5 rounded-lg shadow-md transition-all hover:shadow-lg active:scale-98 flex items-center justify-center gap-1 sm:gap-2"
            >
              <span className="text-xs sm:text-sm">Wyślij na Hotres</span>
              <div className="flex gap-0.5 sm:gap-1">
                {priceChanges.size > 0 && (
                  <span className="text-[10px] bg-yellow-800 px-2 py-0.5 rounded-full">
                    {priceChanges.size} zmian
                  </span>
                )}
              </div>
            </button>
            <div className="text-xs text-slate-400 whitespace-nowrap">
              Pozostało: <span className="font-bold text-yellow-400">{10 - hotresSyncCount.count}</span>/10
            </div>
          </div>
        )}

        {/* OVERRIDE Button for Full View - Always Visible */}
        {viewMode === 'full' && (
          <div className="mb-2 sm:mb-3">
            <button
              onClick={handleOpenOverrideModal}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 sm:py-2.5 sm:px-5 rounded-lg shadow-md transition-all hover:shadow-lg active:scale-98 flex items-center justify-center gap-2"
            >
              <span className="text-xs sm:text-sm">🚨 OVERRIDE</span>
            </button>
            <p className="text-[10px] text-slate-500 text-center mt-1">Nadpisz wybrane restrykcje w Hotresie (wymaga hasła)</p>
          </div>
        )}

        {/* Show table only if there are units to display */}
        {filteredUnits.length > 0 && (
          <>
            {/* Top Scrollbar - hidden on mobile for cleaner UI */}
            <div
              className="hidden sm:block overflow-x-auto overflow-y-hidden mb-2"
              ref={topScrollRef}
              onScroll={handleTopScroll}
            >
              <div className="sm:w-[calc(80px+75*var(--dates-count))] lg:w-[calc(120px+90*var(--dates-count))]" style={{ height: '1px' }}></div>
            </div>

            {/* Scrollable Table */}
            <div className="overflow-x-auto max-h-[calc(100vh-200px)] sm:max-h-[calc(100vh-250px)] lg:max-h-[calc(100vh-300px)] overflow-y-auto scroll-smooth" style={{ WebkitOverflowScrolling: 'touch' }} ref={scrollContainerRef} onScroll={handleMainScroll}>
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-30 border-b-2 border-border">
              {/* Month headers row */}
              <tr className="bg-surface border-b border-border">
                <th className="sticky left-0 z-40 bg-surface border-r border-border min-w-[70px] sm:min-w-[80px] lg:min-w-[120px]"></th>
                {(() => {
                  const monthGroups: Array<{ month: string; year: string; count: number; startIdx: number }> = [];
                  let currentMonth = '';
                  let currentYear = '';
                  let count = 0;
                  let startIdx = 0;

                  dates.forEach((date, idx) => {
                    const month = date.toLocaleDateString('pl-PL', { month: 'long' });
                    const year = date.getFullYear().toString();
                    const monthYear = `${month} ${year}`;

                    if (monthYear !== currentMonth) {
                      if (count > 0) {
                        monthGroups.push({ month: currentMonth.split(' ')[0], year: currentYear, count, startIdx });
                      }
                      currentMonth = monthYear;
                      currentYear = year;
                      count = 1;
                      startIdx = idx;
                    } else {
                      count++;
                    }
                  });

                  // Push last group
                  if (count > 0) {
                    monthGroups.push({ month: currentMonth.split(' ')[0], year: currentYear, count, startIdx });
                  }

                  return monthGroups.map((group, idx) => (
                    <th
                      key={idx}
                      colSpan={group.count}
                      className="p-1 sm:p-1.5 text-center text-[11px] sm:text-xs font-bold text-slate-300 border-r border-border bg-slate-800/50"
                    >
                      <div className="capitalize">{group.month}</div>
                      <div className="text-[9px] sm:text-[10px] text-slate-500 font-normal">{group.year}</div>
                    </th>
                  ));
                })()}
              </tr>
              {/* Day headers row */}
              <tr className="bg-surface">
                <th className="sticky left-0 z-40 bg-surface p-1 sm:p-2 text-left text-[8px] sm:text-[9px] lg:text-[10px] font-bold text-slate-400 border-r border-border min-w-[70px] sm:min-w-[80px] lg:min-w-[120px]">
                  Pokój
                </th>
                {dates.map((date, idx) => {
                  const isToday = date.toDateString() === new Date().toDateString();
                  const isSelected = date.toISOString().split('T')[0] === selectedDateStr;
                  return (
                    <th
                      key={idx}
                      className={`p-1 sm:p-2 text-center text-[10px] sm:text-xs font-medium border-r border-border min-w-[70px] sm:min-w-[75px] lg:min-w-[90px] ${
                        isSelected ? 'bg-indigo-900/50' : isToday ? 'bg-indigo-900/30' : 'bg-surface'
                      }`}
                    >
                      <div className="text-slate-300 font-bold text-[10px] sm:text-xs">
                        {date.getDate()}
                      </div>
                      <div className="text-slate-500 text-[8px] sm:text-[10px]">
                        {date.toLocaleDateString('pl-PL', { weekday: 'short' })}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredUnits.map((unit) => {
                const unitAvailability = allUnitsAvailability.get(unit.id);
                return (
                  <tr key={unit.id} className="border-t border-border hover:bg-slate-800/30">
                    <td className="sticky left-0 z-20 bg-surface p-1 sm:p-2 text-[10px] sm:text-[11px] lg:text-xs font-medium text-white border-r border-border">
                      {unit.name}
                    </td>
                    {dates.map((date, idx) => {
                      const dateStr = date.toISOString().split('T')[0];
                      const status = unitAvailability?.get(dateStr);
                      const isToday = date.toDateString() === new Date().toDateString();
                      const isSelected = dateStr === selectedDateStr;
                      const notifPosition = getNotificationPosition(unit.id, dateStr, idx);

                      const aiSuggestion = hasAISuggestion(unit.id, dateStr);
                      const isBooked = status === 'booked';

                      // Yellow cell for AI suggestion, otherwise green/red
                      const cellClass = aiSuggestion
                        ? 'h-6 sm:h-6 lg:h-7 rounded-sm transition-colors cursor-pointer bg-yellow-500/80 hover:bg-yellow-500/100 flex items-center justify-center text-black font-bold text-xs sm:text-sm ring-2 ring-yellow-400'
                        : isBooked
                        ? 'h-6 sm:h-6 lg:h-7 rounded-sm transition-colors cursor-pointer bg-red-600/60 hover:bg-red-600/80 flex items-center justify-center text-white font-bold text-xs sm:text-sm'
                        : 'h-6 sm:h-6 lg:h-7 rounded-sm transition-colors cursor-pointer bg-green-600/60 hover:bg-green-600/80 flex items-center justify-center text-white font-bold text-xs sm:text-sm';

                      // Continuous yellow box styling
                      let notifBoxClass = '';
                      if (notifPosition === 'single') {
                        notifBoxClass = 'border-2 border-yellow-500 rounded';
                      } else if (notifPosition === 'start') {
                        notifBoxClass = 'border-2 border-yellow-500 rounded-l border-r-0';
                      } else if (notifPosition === 'middle') {
                        notifBoxClass = 'border-t-2 border-b-2 border-yellow-500';
                      } else if (notifPosition === 'end') {
                        notifBoxClass = 'border-2 border-yellow-500 rounded-r border-l-0';
                      }

                      const cellKey = `${unit.id}_${dateStr}`;
                      const isCellSelected = selectedCells.has(cellKey);

                      return (
                        <td
                          key={idx}
                          onClick={() => bulkEditMode && handleCellClick(unit.id, dateStr)}
                          className={`p-1 border-r border-border ${
                            isSelected ? 'bg-indigo-900/30' : isToday ? 'bg-indigo-900/20' : ''
                          } ${notifBoxClass} ${bulkEditMode ? 'cursor-pointer hover:bg-indigo-800/40' : ''} ${
                            isCellSelected ? 'bg-indigo-600/50 ring-2 ring-indigo-400 ring-inset' : ''
                          }`}
                        >
                          {(() => {
                            const priceKey = cellKey;
                            const priceData = pricesData.get(priceKey);
                            const changeData = priceChanges.get(priceKey);

                            // Use change data if available, otherwise use price data
                            const ctaValue = changeData?.cta !== undefined ? changeData.cta === 1 : priceData?.cta === 1;
                            const ctdValue = changeData?.ctd !== undefined ? changeData.ctd === 1 : priceData?.ctd === 1;
                            const minValue = changeData?.min !== undefined ? (changeData.min || '') : (priceData?.min || '');

                            return (
                              <div className="flex flex-col gap-1">
                                {/* Colored cell with 0/1 */}
                                <div
                                  className={cellClass}
                                  title={aiSuggestion ? `🤖 AI Sugestia: CTA=${aiSuggestion.suggested_cta}, CTD=${aiSuggestion.suggested_ctd}, MIN=${aiSuggestion.suggested_min}` : `${unit.name} - ${dateStr}: ${status || 'available'}`}
                                  onClick={() => aiSuggestion && setSelectedSuggestion(aiSuggestion)}
                                >
                                  {aiSuggestion ? '🤖' : (isBooked ? '0' : '1')}
                                </div>

                                {/* Checkboxes in one line - vertical labels */}
                                <div className="flex items-center justify-center gap-1 sm:gap-1.5 lg:gap-2">
                                  <label className="flex flex-col items-center gap-0.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="w-4 h-4 sm:w-4 sm:h-4 lg:w-5 lg:h-5 cursor-pointer"
                                      checked={ctaValue}
                                      onChange={(e) => handleCtaChange(unit.id, dateStr, e.target.checked)}
                                    />
                                    <span className="text-slate-400 text-[8px] sm:text-[9px] font-semibold">CTA</span>
                                  </label>
                                  <label className="flex flex-col items-center gap-0.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="w-4 h-4 sm:w-4 sm:h-4 lg:w-5 lg:h-5 cursor-pointer"
                                      checked={ctdValue}
                                      onChange={(e) => handleCtdChange(unit.id, dateStr, e.target.checked)}
                                    />
                                    <span className="text-slate-400 text-[8px] sm:text-[9px] font-semibold">CTD</span>
                                  </label>
                                </div>

                                {/* MIN input - centered with label below */}
                                <div className="flex flex-col gap-0.5 items-center">
                                  <input
                                    type="text"
                                    className="w-full px-1 py-1 sm:px-1 sm:py-1 lg:px-1.5 lg:py-1 text-center text-[10px] sm:text-[10px] lg:text-[11px] bg-slate-800 border border-slate-700 rounded text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    placeholder="000"
                                    value={minValue}
                                    onChange={(e) => handleMinChange(unit.id, dateStr, e.target.value)}
                                  />
                                  <label className="text-[8px] sm:text-[9px] text-slate-500 uppercase">MIN</label>
                                </div>
                              </div>
                            );
                          })()}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

            {/* Legend */}
            <div className="space-y-2 sm:space-y-3 mt-2 sm:mt-3">
              <div className="flex items-center justify-center gap-2 sm:gap-3 lg:gap-4 text-[10px] sm:text-xs flex-wrap px-2">
                <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded bg-green-600/60 flex items-center justify-center text-white font-bold text-[10px] sm:text-xs flex-shrink-0">1</div>
                  <span className="text-slate-400 whitespace-nowrap">Dostępny</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded bg-red-600/60 flex items-center justify-center text-white font-bold text-[10px] sm:text-xs flex-shrink-0">0</div>
                  <span className="text-slate-400 whitespace-nowrap">Zajęty</span>
                </div>
                <div className="hidden sm:block w-px h-4 bg-slate-700"></div>
                <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded border-2 border-yellow-500 flex-shrink-0"></div>
                  <span className="text-slate-400 whitespace-nowrap">Nieodczytane</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded bg-green-900/30 border border-green-700/50 flex-shrink-0"></div>
                  <span className="text-slate-400 whitespace-nowrap hidden sm:inline">Zwolnienie (powiadomienie)</span>
                  <span className="text-slate-400 whitespace-nowrap sm:hidden">Zwolnienie</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded bg-red-900/30 border border-red-700/50 flex-shrink-0"></div>
                  <span className="text-slate-400 whitespace-nowrap hidden sm:inline">Blokada (powiadomienie)</span>
                  <span className="text-slate-400 whitespace-nowrap sm:hidden">Blokada</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded bg-slate-800/50 border border-slate-700/50 flex-shrink-0"></div>
                  <span className="text-slate-400 whitespace-nowrap">Odczytane</span>
                </div>
                <div className="hidden sm:block w-px h-4 bg-slate-700"></div>
                <div className="flex items-center gap-1 sm:gap-1.5 lg:gap-2">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded bg-yellow-500/80 ring-2 ring-yellow-400 flex items-center justify-center flex-shrink-0">🤖</div>
                  <span className="text-slate-400 whitespace-nowrap hidden sm:inline">Sugestia AI (kliknij aby zobaczyć)</span>
                  <span className="text-slate-400 whitespace-nowrap sm:hidden">AI</span>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 lg:gap-6 text-[10px] sm:text-[11px] text-slate-500 px-2">
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <span className="font-semibold text-slate-400">CTA:</span>
                  <span>Przyjazd niemożliwy</span>
                </div>
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <span className="font-semibold text-slate-400">CTD:</span>
                  <span>Wyjazd niemożliwy</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* AI Suggestion Modal */}
      {selectedSuggestion && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setSelectedSuggestion(null)}>
          <div className="bg-slate-800 rounded-lg p-6 max-w-2xl w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-yellow-400 flex items-center gap-2">
                <Sparkles size={24} />
                Sugestia AI
              </h3>
              <button
                onClick={() => setSelectedSuggestion(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Property & Unit Info */}
              <div className="bg-slate-900 rounded p-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-slate-400">Obiekt:</span>
                    <span className="ml-2 text-white font-medium">{selectedSuggestion.property_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Pokój:</span>
                    <span className="ml-2 text-white font-medium">{selectedSuggestion.unit_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Data:</span>
                    <span className="ml-2 text-white font-medium">{selectedSuggestion.date_start}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Pewność:</span>
                    <span className="ml-2 text-green-400 font-bold">{selectedSuggestion.confidence}%</span>
                  </div>
                </div>
              </div>

              {/* Current vs Suggested */}
              <div className="bg-slate-900 rounded p-4">
                <h4 className="text-sm font-semibold text-slate-300 mb-3">Porównanie wartości</h4>
                <div className="space-y-2">
                  {(() => {
                    const priceKey = `${selectedSuggestion.unit_id}_${selectedSuggestion.date_start}`;
                    const currentPrice = pricesData.get(priceKey);

                    return (
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div className="text-slate-400 font-medium">Parametr</div>
                        <div className="text-slate-400 font-medium">Obecne</div>
                        <div className="text-yellow-400 font-medium">AI sugeruje</div>

                        <div className="text-white">CTA</div>
                        <div className="text-white">{currentPrice?.cta ?? 'brak'}</div>
                        <div className="text-yellow-300 font-bold">{selectedSuggestion.suggested_cta}</div>

                        <div className="text-white">CTD</div>
                        <div className="text-white">{currentPrice?.ctd ?? 'brak'}</div>
                        <div className="text-yellow-300 font-bold">{selectedSuggestion.suggested_ctd}</div>

                        <div className="text-white">MIN</div>
                        <div className="text-white">{currentPrice?.min ?? 'brak'}</div>
                        <div className="text-yellow-300 font-bold">{selectedSuggestion.suggested_min}</div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Reasoning */}
              <div className="bg-slate-900 rounded p-4">
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Uzasadnienie</h4>
                <p className="text-slate-200 text-sm">{selectedSuggestion.reasoning}</p>
              </div>

              {/* Expected Impact */}
              <div className="bg-slate-900 rounded p-4">
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Oczekiwany efekt</h4>
                <p className="text-slate-200 text-sm">{selectedSuggestion.expected_impact}</p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t border-slate-700">
                <button
                  onClick={() => setSelectedSuggestion(null)}
                  className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-semibold py-3 px-4 rounded transition-colors"
                >
                  Zamknij
                </button>
                <button
                  onClick={() => handleRejectSuggestion(selectedSuggestion)}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-4 rounded transition-colors"
                >
                  ✕ Odrzuć
                </button>
                <button
                  onClick={() => handleApplySuggestion(selectedSuggestion)}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-4 rounded transition-colors"
                >
                  ✓ Akceptuj
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6 border border-red-600">
            <h2 className="text-xl font-bold text-red-500 mb-4 flex items-center gap-2">
              🚨 OVERRIDE - Wybierz co wysłać
            </h2>

            <p className="text-sm text-slate-300 mb-6">
              Zaznacz pola które chcesz nadpisać w Hotresie.<br />
              Wysłane zostaną <strong>WSZYSTKIE</strong> dni i jednostki dla wybranych pól.
            </p>

            <div className="space-y-4 mb-6">
              {/* CTA Toggle */}
              <label className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg cursor-pointer hover:bg-slate-700 transition">
                <input
                  type="checkbox"
                  checked={overrideCTA}
                  onChange={(e) => setOverrideCTA(e.target.checked)}
                  className="w-5 h-5 accent-red-600"
                />
                <div>
                  <div className="font-semibold text-white">CTA</div>
                  <div className="text-xs text-slate-400">Check-in Advance (przybycie)</div>
                </div>
              </label>

              {/* CTD Toggle */}
              <label className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg cursor-pointer hover:bg-slate-700 transition">
                <input
                  type="checkbox"
                  checked={overrideCTD}
                  onChange={(e) => setOverrideCTD(e.target.checked)}
                  className="w-5 h-5 accent-red-600"
                />
                <div>
                  <div className="font-semibold text-white">CTD</div>
                  <div className="text-xs text-slate-400">Check-out Departure (wyjazd)</div>
                </div>
              </label>

              {/* MIN Toggle */}
              <label className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg cursor-pointer hover:bg-slate-700 transition">
                <input
                  type="checkbox"
                  checked={overrideMIN}
                  onChange={(e) => setOverrideMIN(e.target.checked)}
                  className="w-5 h-5 accent-red-600"
                />
                <div>
                  <div className="font-semibold text-white">MIN nocy</div>
                  <div className="text-xs text-slate-400">Minimalna liczba nocy</div>
                </div>
              </label>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowOverrideModal(false)}
                className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-semibold py-2.5 px-4 rounded-lg transition"
              >
                Anuluj
              </button>
              <button
                onClick={handleConfirmOverride}
                disabled={!overrideCTA && !overrideCTD && !overrideMIN}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-lg transition"
              >
                Wyślij do Hotresa
              </button>
            </div>

            {(!overrideCTA && !overrideCTD && !overrideMIN) && (
              <p className="text-xs text-red-400 text-center mt-3">
                Zaznacz przynajmniej jedno pole
              </p>
            )}
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {showBulkEditModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6 border border-green-600">
            <h2 className="text-xl font-bold text-green-500 mb-4 flex items-center gap-2">
              ✏️ Zmień wiele ({selectedCells.size} komórek)
            </h2>

            <p className="text-sm text-slate-300 mb-6">
              Ustaw wartości dla zaznaczonych komórek. <br />
              Pola pozostawione puste nie zostaną zmienione.
            </p>

            <div className="space-y-4 mb-6">
              {/* CTA */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-400 uppercase">CTA (Check-in Advance)</label>
                <select
                  value={bulkEditCTA === null ? '' : bulkEditCTA}
                  onChange={(e) => setBulkEditCTA(e.target.value === '' ? null : parseInt(e.target.value))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg p-2.5 text-white text-sm outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">— Bez zmian —</option>
                  <option value="0">0 (Wyłączone)</option>
                  <option value="1">1 (Włączone)</option>
                </select>
              </div>

              {/* CTD */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-400 uppercase">CTD (Check-out Departure)</label>
                <select
                  value={bulkEditCTD === null ? '' : bulkEditCTD}
                  onChange={(e) => setBulkEditCTD(e.target.value === '' ? null : parseInt(e.target.value))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg p-2.5 text-white text-sm outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">— Bez zmian —</option>
                  <option value="0">0 (Wyłączone)</option>
                  <option value="1">1 (Włączone)</option>
                </select>
              </div>

              {/* MIN */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-400 uppercase">MIN nocy</label>
                <input
                  type="number"
                  min="0"
                  placeholder="Bez zmian"
                  value={bulkEditMIN === null ? '' : bulkEditMIN}
                  onChange={(e) => setBulkEditMIN(e.target.value === '' ? null : parseInt(e.target.value))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg p-2.5 text-white text-sm outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowBulkEditModal(false)}
                className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-semibold py-2.5 px-4 rounded-lg transition"
              >
                Anuluj
              </button>
              <button
                onClick={handleApplyBulkEdit}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 px-4 rounded-lg transition"
              >
                Zastosuj zmiany
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
