import React, { useEffect, useState, useRef, useMemo, useCallback, memo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { Property, Availability, Unit, Notification, Price, AISuggestion, RatePlan, GapRestriction } from '../types';
import { Loader2, ChevronLeft, ChevronRight, RefreshCw, Sparkles, ArrowRight, CheckSquare, Square, X, Save, Shield } from 'lucide-react';
import { RatePlanMatrixModal } from './RatePlanMatrixModal';
import { recomputeGapRestrictions, fetchGapRestrictions as fetchGapRestrictionsSvc, saveGapOverride, pushGapRestrictionsToHotres, getPropertyGapMode, setPropertyGapMode, savePushRatePlanIds, getPropertyGapConfig, savePropertyGapConfig, DEFAULT_GAP_CONFIG } from '../services/gapProtection';
import type { GapMode, GapConfigValues } from '../types';

// Gap Protection Engine is the SOLE deterministic source of CTA/CTD/Min LOS.
// The legacy ai_suggestions + n8n + Gemini heuristic is retired (phased out);
// flip this to true only to re-enable the old flow for debugging. See docs §8.
const AI_SUGGESTIONS_ENABLED = false;

export const CalendarView: React.FC = () => {
  const { id: propertyId } = useParams<{ id: string }>();
  const location = useLocation();
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
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareDiff, setCompareDiff] = useState<Array<{
    unitId: string;
    unitName: string;
    date: string;
    dbCta: number | null;
    hotresCta: number | null;
    dbCtd: number | null;
    hotresCtd: number | null;
    dbMin: number | null;
    hotresMin: number | null;
  }>>([]);
  const [compareSnapshotRef, setCompareSnapshotRef] = useState<Map<string, { unit_id: string; date: string; cta: number | null; ctd: number | null; min: number | null }>>(new Map());
  const [cellCompareInfo, setCellCompareInfo] = useState<Map<string, { ctaDiffers: boolean; ctdDiffers: boolean; minDiffers: boolean }>>(new Map());

  // Quarter selector for verification
  const [verifyQuarter, setVerifyQuarter] = useState<string>(() => {
    const now = new Date();
    const q = Math.floor(now.getMonth() / 3) + 1;
    return `Q${q}-${now.getFullYear()}`;
  });

  // View options — which buttons to show (persisted to localStorage)
  // Single collapsible "Akcje / Ustawienia" panel that holds the push/compare/verify/matrix actions
  const [showActions, setShowActions] = useState(false);
  const [viewOptions, setViewOptions] = useState<Record<string, boolean>>(() => {
    try {
      const s = localStorage.getItem('tp_view_options');
      return s ? JSON.parse(s) : { compare: true, push: true, override: true, verifyQuarter: true };
    } catch { return { compare: true, push: true, override: true, verifyQuarter: true }; }
  });

  const setViewOption = (key: string, val: boolean) => {
    setViewOptions(prev => {
      const next = { ...prev, [key]: val };
      localStorage.setItem('tp_view_options', JSON.stringify(next));
      return next;
    });
  };

  const getQuarterRange = (q: string): { start: string; end: string } => {
    const [qn, y] = q.split('-');
    const year = parseInt(y);
    const map: Record<string, { start: string; end: string }> = {
      Q1: { start: `${year}-01-01`, end: `${year}-03-31` },
      Q2: { start: `${year}-04-01`, end: `${year}-06-30` },
      Q3: { start: `${year}-07-01`, end: `${year}-09-30` },
      Q4: { start: `${year}-10-01`, end: `${year}-12-31` },
    };
    return map[qn] ?? { start: `${year}-01-01`, end: `${year}-12-31` };
  };

  const quarterOptions = (() => {
    const now = new Date();
    const year = now.getFullYear();
    return [
      `Q1-${year}`, `Q2-${year}`, `Q3-${year}`, `Q4-${year}`,
      `Q1-${year + 1}`, `Q2-${year + 1}`, `Q3-${year + 1}`, `Q4-${year + 1}`,
    ];
  })();
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [defaultRatePlanId, setDefaultRatePlanId] = useState<string | null>(null);
  // per-unit selected rate plan: unit_id -> rate_plan_id
  const [unitRatePlan, setUnitRatePlan] = useState<Map<string, string>>(new Map());
  // which rate plan IDs have prices for each unit: unit_id -> Set<rate_plan_id>
  const [unitAvailablePlans, setUnitAvailablePlans] = useState<Map<string, Set<string>>>(new Map());
  const [allPricesRaw, setAllPricesRaw] = useState<Price[]>([]);
  // Rate plan matrix modal (per-unit rate plan selection)
  const [showRatePlanMatrix, setShowRatePlanMatrix] = useState(false);
  // Which rate plans to push to Hotres (push/override/restore)
  const [selectedPushRatePlanIds, setSelectedPushRatePlanIds] = useState<Set<string>>(new Set());
  const pushSelectionInitialized = useRef(false);

  const [pricesData, setPricesData] = useState<Map<string, Price>>(new Map());
  const [priceChanges, setPriceChanges] = useState<Map<string, Partial<Price>>>(new Map());
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Map<string, AISuggestion>>(new Map());
  const [selectedSuggestion, setSelectedSuggestion] = useState<AISuggestion | null>(null);

  // Gap Protection Engine — per-day restrictions keyed "unitId_date".
  const [gapRestrictions, setGapRestrictions] = useState<Map<string, GapRestriction>>(new Map());
  const [recomputingGaps, setRecomputingGaps] = useState(false);
  const [gapMode, setGapMode] = useState<GapMode>('suggest');
  const [showGapMenu, setShowGapMenu] = useState(false);
  const [showGapConfig, setShowGapConfig] = useState(false);
  const [gapConfigDraft, setGapConfigDraft] = useState<GapConfigValues>(DEFAULT_GAP_CONFIG);
  const [savingGapConfig, setSavingGapConfig] = useState(false);
  const gapModeRef = useRef<GapMode>('suggest');
  // Debounce auto-suggest when multiple notifications arrive at once.
  const autoSuggestUnitsRef = useRef<Set<string>>(new Set());
  const autoSuggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared "which rate plans to push to" modal — asks every time, for all push actions
  const [showPushSendModal, setShowPushSendModal] = useState(false);
  const [pushModalSelection, setPushModalSelection] = useState<Set<string>>(new Set());
  const [pushModalAction, setPushModalAction] = useState<'sync' | 'pushdb' | 'override' | 'gaps'>('sync');
  const [pushModalInfo, setPushModalInfo] = useState<string>('');

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

  // Handle navigation from notifications with date
  useEffect(() => {
    if (location.state && (location.state as any).selectedDate) {
      const dateStr = (location.state as any).selectedDate;
      setSelectedDate(new Date(dateStr));
      setViewMode('notifications');
    }
  }, [location.state]);

  useEffect(() => {
    if (propertyId) {
      fetchPropertyAndUnits();
      fetchUnreadNotifications();
      fetchRatePlans();
      getPropertyGapMode(propertyId).then(setGapMode).catch(() => {});
    }
  }, [propertyId]);

  useEffect(() => {
    if (units.length > 0) {
      fetchQuarterAvailability();
      fetchPricesData();
      fetchAISuggestions();
      loadGapRestrictions();
    }
  }, [selectedDate, units]);

  // Rebuild pricesData when defaultRatePlanId becomes available (fetchRatePlans runs async)
  useEffect(() => {
    if (defaultRatePlanId && allPricesRaw.length > 0) {
      setPricesData(buildPricesMap(allPricesRaw, unitRatePlan, defaultRatePlanId));
    }
  }, [defaultRatePlanId, unitRatePlan]);

  // The push rate-plan selection is INDEPENDENT of the displayed/pull plan: you can
  // view one cennik on the calendar but push to several. It is persisted per property
  // (localStorage). On first load: use the stored push selection if present, otherwise
  // seed once from the currently displayed plans purely as a convenience default.
  useEffect(() => {
    if (pushSelectionInitialized.current) return;
    if (ratePlans.length === 0) return;
    if (propertyId) {
      try {
        const stored = localStorage.getItem(`tp_push_rate_plans_${propertyId}`);
        if (stored) {
          const ids: string[] = JSON.parse(stored);
          const valid = ids.filter(id => ratePlans.some(rp => rp.id === id));
          if (valid.length > 0) {
            setSelectedPushRatePlanIds(new Set(valid));
            pushSelectionInitialized.current = true;
            return;
          }
        }
      } catch { /* ignore corrupt storage */ }
    }
    // Seed default from currently displayed plans (one-time convenience only)
    const distinct = new Set<string>();
    unitRatePlan.forEach(planId => { if (planId) distinct.add(planId); });
    if (distinct.size === 0 && defaultRatePlanId) distinct.add(defaultRatePlanId);
    if (distinct.size > 0) {
      setSelectedPushRatePlanIds(distinct);
      pushSelectionInitialized.current = true;
    }
  }, [ratePlans, unitRatePlan, defaultRatePlanId, propertyId]);

  // Persist the independent push selection so it sticks across reloads/sessions.
  // Also mirror it to the DB (properties.push_rate_plan_ids) so the server-side
  // autofill cron targets the same rate plans the operator chose here.
  useEffect(() => {
    if (!pushSelectionInitialized.current || !propertyId) return;
    const ids = [...selectedPushRatePlanIds];
    localStorage.setItem(`tp_push_rate_plans_${propertyId}`, JSON.stringify(ids));
    savePushRatePlanIds(propertyId, ids).catch(() => {});
  }, [selectedPushRatePlanIds, propertyId]);

  // Auto-scroll: on the FIRST load of the full view, center today's column in
  // the viewport (selectedDate defaults to today, so it sits at index 30).
  // Every later reposition — date navigation, and any entry via a
  // notification (which sets location.state.selectedDate) — keeps the
  // original behavior of placing the selected date at 1/3 of the viewport.
  const hasCenteredOnTodayRef = useRef(false);

  useEffect(() => {
    if (scrollContainerRef.current && !loadingAvailability) {
      // Cell width varies by screen: 70px mobile (increased for better readability), 75px tablet, 90px desktop
      const isMobile = window.innerWidth < 640;
      const isTablet = window.innerWidth >= 640 && window.innerWidth < 1024;
      const dayWidth = isMobile ? 70 : isTablet ? 75 : 90;

      // Selected date is 30 days from start (1 month before)
      const daysBeforeSelected = 30;
      const containerWidth = scrollContainerRef.current.clientWidth;

      const cameFromNotification = Boolean((location.state as any)?.selectedDate);
      let scrollPosition: number;

      if (!hasCenteredOnTodayRef.current && !cameFromNotification) {
        // Center of today's column, accounting for the sticky room-name
        // column that covers the left edge of the viewport
        const stickyColWidth = isMobile ? 70 : isTablet ? 80 : 120;
        scrollPosition = (daysBeforeSelected * dayWidth) + (dayWidth / 2) - (containerWidth - stickyColWidth) / 2;
      } else {
        // Scroll so selected date appears at 1/3 of container width
        scrollPosition = (daysBeforeSelected * dayWidth) - (containerWidth / 3);
      }
      hasCenteredOnTodayRef.current = true;

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
      const map = new Map<string, string>();
      unitsData.forEach((u: Unit) => {
        if (u.selected_rate_plan_id) map.set(u.id, u.selected_rate_plan_id);
      });
      setUnitRatePlan(map);
    }
    setLoadingUnits(false);
  };

  const fetchRatePlans = async () => {
    if (!propertyId) return;
    const { data } = await supabase
      .from('rate_plans')
      .select('id, name, external_id')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: true });
    if (!data || data.length === 0) return;
    const plans = data as RatePlan[];
    setRatePlans(plans);
    // For units without a saved selection, default to the first (main) rate plan
    setUnitRatePlan(prev => {
      const next = new Map(prev);
      // We'll apply defaults when prices are built — just ensure state is ready
      return next;
    });
    setDefaultRatePlanId(plans[0].id);
  };

  // Build pricesData map from raw prices + per-unit selections
  // Uses unit's saved plan, or falls back to defaultRatePlanId (first/main plan)
  const buildPricesMap = (raw: Price[], selections: Map<string, string>, defaultPlanId: string | null): Map<string, Price> => {
    const result = new Map<string, Price>();
    raw.forEach(price => {
      const key = `${price.unit_id}_${price.date}`;
      const chosenPlanId = selections.get(price.unit_id) || defaultPlanId;
      if (chosenPlanId) {
        if (price.rate_id !== chosenPlanId) return;
        result.set(key, price);
      } else {
        // No plans defined yet — merge all (fallback)
        const existing = result.get(key);
        if (!existing) {
          result.set(key, price);
        } else {
          result.set(key, {
            ...existing,
            min: (() => { const v = Math.max(existing.min ?? 0, price.min ?? 0); return v !== 0 ? v : (existing.min ?? price.min ?? 0); })(),
            cta: existing.cta === 1 || price.cta === 1 ? 1 : (existing.cta ?? price.cta),
            ctd: existing.ctd === 1 || price.ctd === 1 ? 1 : (existing.ctd ?? price.ctd),
          });
        }
      }
    });
    return result;
  };

  const handleUnitRatePlanChange = async (unitId: string, ratePlanId: string) => {
    const next = new Map(unitRatePlan);
    next.set(unitId, ratePlanId);
    setUnitRatePlan(next);
    setPricesData(buildPricesMap(allPricesRaw, next, defaultRatePlanId));
    await supabase.from('units').update({ selected_rate_plan_id: ratePlanId }).eq('id', unitId);
  };

  // Bulk: assign one rate plan to every unit shown in the matrix.
  // Skips units that have no price data for that plan (their selection stays).
  const handleBulkRatePlanChange = async (ratePlanId: string) => {
    const next = new Map(unitRatePlan);
    const affectedIds: string[] = [];
    filteredUnits.forEach(u => {
      const avail = unitAvailablePlans.get(u.id);
      const isAvailable = avail ? avail.has(ratePlanId) : true;
      if (isAvailable) {
        next.set(u.id, ratePlanId);
        affectedIds.push(u.id);
      }
    });
    if (affectedIds.length === 0) return;
    setUnitRatePlan(next);
    setPricesData(buildPricesMap(allPricesRaw, next, defaultRatePlanId));
    // Chunk .in() updates — PostgREST URL limit breaks with many UUIDs in one request
    const CHUNK = 50;
    for (let i = 0; i < affectedIds.length; i += CHUNK) {
      const chunk = affectedIds.slice(i, i + CHUNK);
      await supabase.from('units').update({ selected_rate_plan_id: ratePlanId }).in('id', chunk);
    }
  };

  const fetchQuarterAvailability = async () => {
    if (units.length === 0) return;

    setLoadingAvailability(true);

    try {
      const startDate = new Date(selectedDate);
      startDate.setDate(startDate.getDate() - 30);
      const endDate = new Date(selectedDate);
      endDate.setDate(endDate.getDate() + 60);

      const unitIds = units.map(u => u.id);

      // Chunk .in() queries — PostgREST URL limit breaks with 87+ UUIDs in one request
      const CHUNK = 50;
      const allRecords: any[] = [];
      for (let i = 0; i < unitIds.length; i += CHUNK) {
        const chunk = unitIds.slice(i, i + CHUNK);
        const { data } = await supabase
          .from('availability')
          .select('unit_id, date, status')
          .in('unit_id', chunk)
          .gte('date', startDate.toISOString().split('T')[0])
          .lte('date', endDate.toISOString().split('T')[0]);
        if (data) allRecords.push(...data);
      }

      const availabilityMap = new Map<string, Map<string, Availability['status']>>();
      units.forEach(unit => { availabilityMap.set(unit.id, new Map()); });
      allRecords.forEach((record: any) => {
        const unitMap = availabilityMap.get(record.unit_id);
        if (unitMap) unitMap.set(record.date, record.status);
      });

      setAllUnitsAvailability(availabilityMap);
    } catch (err) {
      console.error('❌ fetchQuarterAvailability error:', err);
    } finally {
      setLoadingAvailability(false);
    }
  };

  const fetchPricesData = async () => {
    if (units.length === 0) return;

    try {
    const startDate = new Date('2026-01-20');
    const endDate = new Date('2026-12-31');
    const unitIds = units.map(u => u.id);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Chunk .in() + paginate — handles 87+ units without URL-length errors
    const CHUNK = 50;
    const PAGE_SIZE = 10000;
    const allData: any[] = [];

    for (let ci = 0; ci < unitIds.length; ci += CHUNK) {
      const chunk = unitIds.slice(ci, ci + CHUNK);
      let from = 0;
      while (true) {
        const { data: page, error: pageError } = await supabase
          .from('prices')
          .select('id, unit_id, date, rate_id, cta, ctd, min, cta_synced, ctd_synced')
          .in('unit_id', chunk)
          .gte('date', startStr)
          .lte('date', endStr)
          .order('date', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (pageError) { console.error('❌ Error fetching prices:', pageError); break; }
        if (!page || page.length === 0) break;
        allData.push(...page);
        // Advance by what we actually got, not PAGE_SIZE — Supabase's project-level
        // "Max Rows" setting can cap a response well below PAGE_SIZE, and stopping
        // whenever a page comes back short of PAGE_SIZE would truncate large properties.
        from += page.length;
      }
    }

    setAllPricesRaw(allData as Price[]);

    // Build map of which rate plans have prices per unit (to populate dropdowns)
    const availPlans = new Map<string, Set<string>>();
    (allData as Price[]).forEach(p => {
      if (!p.rate_id) return;
      if (!availPlans.has(p.unit_id)) availPlans.set(p.unit_id, new Set());
      availPlans.get(p.unit_id)!.add(p.rate_id);
    });
    setUnitAvailablePlans(availPlans);

    // For units without a saved selection, pick the first available rate plan for that unit
    // (ordered by ratePlans array which is sorted by created_at)
    const updatedSelections = new Map(unitRatePlan);
    availPlans.forEach((planSet, unitId) => {
      if (!updatedSelections.has(unitId)) {
        // Find the first ratePlan (by position in ratePlans array) that has data for this unit
        const firstMatch = ratePlans.find(rp => planSet.has(rp.id));
        if (firstMatch) updatedSelections.set(unitId, firstMatch.id);
        else if (defaultRatePlanId && planSet.has(defaultRatePlanId)) updatedSelections.set(unitId, defaultRatePlanId);
      }
    });
    setUnitRatePlan(updatedSelections);

    const pricesMap = buildPricesMap(allData as Price[], updatedSelections, defaultRatePlanId);


    setPricesData(pricesMap);

    // Rebuild cellCompareInfo from DB columns (persists across devices)
    const infoFromDb = new Map<string, { ctaDiffers: boolean; ctdDiffers: boolean; minDiffers: boolean }>();
    pricesMap.forEach((price, key) => {
      if (price.cta_synced !== null && price.cta_synced !== undefined) {
        infoFromDb.set(key, {
          ctaDiffers: price.cta_synced === false,
          ctdDiffers: price.ctd_synced === false,
          minDiffers: false,
        });
      }
    });
    if (infoFromDb.size > 0) setCellCompareInfo(infoFromDb);

    return pricesMap;
    } catch (err) {
      console.error('❌ fetchPricesData error:', err);
    }
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

  // Timezone-safe date formatter — avoids UTC shift on toISOString() in UTC+N zones
  const toLocalDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Generate ~90 days — memoized so it only recomputes when selectedDate changes
  const dates = useMemo(() => {
    const result: Date[] = [];
    const startDate = new Date(selectedDate);
    startDate.setDate(startDate.getDate() - 30);
    for (let i = 0; i < 91; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      result.push(date);
    }
    return result;
  }, [selectedDate.toDateString()]);

  // Memoized so it only recomputes when units/viewMode/notifications change
  const filteredUnits = useMemo(() => {
    if (viewMode === 'full') return units;
    const unitsWithNotifications = new Set(unreadNotifications.map(n => n.unit_id));
    return units.filter(u => unitsWithNotifications.has(u.id));
  }, [units, viewMode, unreadNotifications]);

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

    setViewMode('notifications');

    // Scroll will happen automatically via useEffect
  };

  const toggleBulkEditMode = () => {
    if (bulkEditMode) {
      // Exiting bulk edit mode - clear selection
      setSelectedCells(new Set());
    }
    setBulkEditMode(!bulkEditMode);
  };

  const handleCellClick = useCallback((unitId: string, dateStr: string) => {
    if (bulkEditMode) {
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
  }, [bulkEditMode]);

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

  const handleDismissAllNotifications = async () => {
    if (unreadNotifications.length === 0) return;
    if (!confirm(`Odrzucić wszystkie ${unreadNotifications.length} powiadomień?\n\nZostaną oznaczone jako przeczytane bez wysyłania do Hotresa.`)) return;

    const ids = unreadNotifications.map(n => n.id);
    const { data: { user } } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    await supabase.from('notifications')
      .update({ is_read: true, read_by_email: user?.email ?? null, read_at: now })
      .in('id', ids);

    setUnreadNotifications([]);
    setReadNotificationIds(new Set());
  };

  // Opener: validate, then EACH TIME open the modal that asks which rate plans to push to.
  // (When there are only notifications and no price edits, there's nothing to push to a
  // rate plan, so we keep the simple confirm.)
  const handleSyncToHotres = () => {
    if (!property) return;

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

    if (hasPriceChanges) {
      openPushModal('sync', `Zmiany w cenach/restrykcjach: ${priceChanges.size}.`);
      return;
    }

    // Notifications only — no rate plan target needed
    let confirmMsg = 'Czy na pewno chcesz wysłać zmiany na Hotres?\n\n';
    confirmMsg += `• ${readNotificationIds.size} odczytanych powiadomień\n`;
    confirmMsg += '\nTa operacja jest nieodwracalna.';
    if (!confirm(confirmMsg)) return;
    executeSyncToHotres(new Set());
  };

  // Open the shared push-target modal, seeding the selection from the saved push choice
  // (or the displayed plans as a one-time default).
  const openPushModal = (action: 'sync' | 'pushdb' | 'override' | 'gaps', info: string) => {
    const seed = new Set<string>(selectedPushRatePlanIds);
    if (seed.size === 0) {
      unitRatePlan.forEach(planId => { if (planId) seed.add(planId); });
      if (seed.size === 0 && defaultRatePlanId) seed.add(defaultRatePlanId);
    }
    setPushModalSelection(seed);
    setPushModalAction(action);
    setPushModalInfo(info);
    setShowPushSendModal(true);
  };

  // Confirm handler for the push-target modal — dispatches to the right action
  const confirmPushModal = () => {
    if (pushModalSelection.size === 0) return;
    const ids = new Set(pushModalSelection);
    setSelectedPushRatePlanIds(ids); // remember as next default
    setShowPushSendModal(false);
    if (pushModalAction === 'sync') executeSyncToHotres(ids);
    else if (pushModalAction === 'pushdb') executePushDBToHotres(ids);
    else if (pushModalAction === 'override') executeOverride(ids);
    else if (pushModalAction === 'gaps') executePushGapsToHotres(ids);
  };

  // Performs the actual send using the chosen rate plan ids
  const executeSyncToHotres = async (planIds: Set<string>) => {
    if (!property) return;

    const currentData = getHotresSyncCount(property.id);
    const hasNotifications = readNotificationIds.size > 0;
    const hasPriceChanges = priceChanges.size > 0;

    try {
      // Send price changes to Hotres if any
      let syncResult: { cellsAffected: number; ctaChanges: number; ctdChanges: number; minChanges: number; verificationFailed: number; hotresResponse: any } | undefined;
      if (hasPriceChanges) {
        syncResult = await sendPriceChangesToHotres(planIds);
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

      // Clear price changes and mark sent cells as synced in calendar + DB
      if (hasPriceChanges) {
        setCellCompareInfo(prev => {
          type CellInfo = { ctaDiffers: boolean; ctdDiffers: boolean; minDiffers: boolean };
          const updated = new Map<string, CellInfo>(prev);
          priceChanges.forEach((change, key) => {
            const existing: CellInfo = updated.get(key) ?? { ctaDiffers: false, ctdDiffers: false, minDiffers: false };
            updated.set(key, {
              ctaDiffers: change.cta !== undefined ? false : existing.ctaDiffers,
              ctdDiffers: change.ctd !== undefined ? false : existing.ctdDiffers,
              minDiffers: change.min !== undefined ? false : existing.minDiffers,
            });
          });
          // Persist to DB
          priceChanges.forEach((change, key) => {
            const price = pricesData.get(key);
            if (price?.id) {
              const dbUpdate: Record<string, boolean> = {};
              if (change.cta !== undefined) dbUpdate.cta_synced = true;
              if (change.ctd !== undefined) dbUpdate.ctd_synced = true;
              if (Object.keys(dbUpdate).length > 0) {
                supabase.from('prices').update(dbUpdate).eq('id', price.id);
              }
            }
          });
          return updated;
        });
        setPriceChanges(new Map());
        await fetchPricesData();
      }

      // Build detailed success message with validation result
      let successMsg = `✓ Wysłano na Hotres.\n`;
      if (syncResult) {
        const parts: string[] = [];
        if (syncResult.ctaChanges > 0) parts.push(`CTA: ${syncResult.ctaChanges} komórek`);
        if (syncResult.ctdChanges > 0) parts.push(`CTD: ${syncResult.ctdChanges} komórek`);
        if (syncResult.minChanges > 0) parts.push(`MIN: ${syncResult.minChanges} komórek`);
        if (parts.length > 0) successMsg += `Zmiany: ${parts.join(', ')}\n`;

        if (syncResult.verificationFailed === 0) {
          successMsg += `✓ Weryfikacja DB: wszystkie wartości zapisane poprawnie\n`;
        } else {
          successMsg += `⚠ Weryfikacja DB: ${syncResult.verificationFailed} rekordów nie zgadza się — sprawdź konsolę\n`;
        }
      }
      successMsg += `\nPozostało ${10 - newCount} synchronizacji w tej godzinie.`;

      alert(successMsg);
    } catch (error: any) {
      alert(`✗ Błąd synchronizacji: ${error.message}`);
    }
  };

  const handlePushDBToHotres = () => {
    if (!property) return;

    const currentData = getHotresSyncCount(property.id);
    if (currentData.count >= 10) {
      alert('Osiągnięto limit 10 synchronizacji na godzinę dla tego obiektu. Spróbuj ponownie za chwilę.');
      return;
    }

    const startDateStr = toLocalDateStr(dates[0]);
    const endDateStr = toLocalDateStr(dates[dates.length - 1]);
    openPushModal('pushdb',
      `Wyślę CTA/CTD/MIN z bazy.\nZakres: ${startDateStr} – ${endDateStr} · Jednostki: ${units.filter(u => u.external_type_id).length}.\nNadpisze bieżące restrykcje w Hotresie.`
    );
  };

  const executePushDBToHotres = async (planIds: Set<string>) => {
    if (!property) return;

    const currentData = getHotresSyncCount(property.id);
    const startDateStr = toLocalDateStr(dates[0]);
    const endDateStr = toLocalDateStr(dates[dates.length - 1]);

    try {
      const { data: allRatePlansRaw, error: rpError } = await supabase
        .from('rate_plans')
        .select('id, name, external_id')
        .eq('property_id', property.id);

      if (rpError || !allRatePlansRaw || allRatePlansRaw.length === 0) {
        throw new Error('Brak cenników dla tego obiektu.');
      }

      const allRatePlans = allRatePlansRaw.filter(rp => rp.external_id !== null && rp.external_id !== undefined);
      if (allRatePlans.length === 0) {
        throw new Error('Cenniki nie mają external_id. Pobierz cenniki z Hotres w zakładce Cenniki.');
      }

      const plansToSend = allRatePlans.filter(rp => planIds.has(rp.id));
      if (plansToSend.length === 0) {
        alert('Nie wybrano żadnego cennika do wysyłki.');
        return;
      }

      const unitIds = units.map(u => u.id);

      const { data: allPrices, error: pricesError } = await supabase
        .from('prices')
        .select('unit_id, date, cta, ctd, min')
        .in('unit_id', unitIds)
        .gte('date', startDateStr)
        .lte('date', endDateStr);

      if (pricesError) throw new Error(`Błąd pobierania danych: ${pricesError.message}`);
      if (!allPrices || allPrices.length === 0) {
        throw new Error('Brak danych w bazie dla tego zakresu. Zsynchronizuj dane z Hotres najpierw.');
      }

      // Group by type_id, include all fields
      const pricesByTypeId = new Map<string, Array<{ date: string; cta: number | null; ctd: number | null; min: number | null }>>();

      allPrices.forEach(price => {
        const unit = units.find(u => u.id === price.unit_id);
        if (!unit || !unit.external_type_id) return;

        const typeId = unit.external_type_id;
        if (!pricesByTypeId.has(typeId)) pricesByTypeId.set(typeId, []);

        pricesByTypeId.get(typeId)!.push({
          date: price.date,
          cta: price.cta,
          ctd: price.ctd,
          min: price.min
        });
      });

      const isNextDay = (d1: string, d2: string) => {
        const a = new Date(d1), b = new Date(d2);
        a.setHours(12); b.setHours(12);
        return Math.ceil(Math.abs(b.getTime() - a.getTime()) / 86400000) === 1 && b > a;
      };

      const payloadArray: Array<{ type_id: number; rate_id: number; mode: string; prices: any[] }> = [];

      for (const [typeIdStr, prices] of pricesByTypeId) {
        const currentTypeId = parseInt(typeIdStr, 10);
        prices.sort((a, b) => a.date.localeCompare(b.date));

        const ranges: Array<{ from: string; till: string; cta?: number | null; ctd?: number | null; min?: number | null }> = [];
        let cur: any = null;

        for (const price of prices) {
          const sameVals = cur &&
            cur.cta === price.cta &&
            cur.ctd === price.ctd &&
            cur.min === price.min;

          if (sameVals && isNextDay(cur.till, price.date)) {
            cur.till = price.date;
          } else {
            if (cur) ranges.push(cur);
            cur = { from: price.date, till: price.date, cta: price.cta, ctd: price.ctd, min: price.min };
          }
        }
        if (cur) ranges.push(cur);

        for (const ratePlan of plansToSend) {
          payloadArray.push({
            type_id: currentTypeId,
            rate_id: parseInt(ratePlan.external_id!, 10),
            mode: 'delta',
            prices: ranges
          });
        }
      }

      if (payloadArray.length === 0) {
        throw new Error('Brak danych do wysłania. Sprawdź czy jednostki mają ustawiony external_type_id.');
      }

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
          body: JSON.stringify({ property_id: property.id, payload: payloadArray })
        }
      );

      const responseData = await response.json();
      if (!response.ok) {
        throw new Error(`Błąd Hotres (${response.status}): ${responseData?.error || JSON.stringify(responseData)}`);
      }

      console.log('✅ Push DB→Hotres OK:', responseData.hotres_response);

      const newCount = currentData.count + 1;
      const newData = { count: newCount, hourStart: currentData.hourStart };
      localStorage.setItem(`hotres_sync_count_${property.id}`, JSON.stringify(newData));
      setHotresSyncCount(newData);

      alert(
        `✓ Wysłano do Hotresa:\n` +
        `• ${allPrices.length} rekordów (CTA + CTD + MIN)\n` +
        `• Zakres: ${startDateStr} – ${endDateStr}\n\n` +
        `Pozostało ${10 - newCount} synchronizacji w tej godzinie.`
      );
    } catch (error: any) {
      alert(`✗ Błąd push DB→Hotres: ${error.message}`);
      console.error('Push DB→Hotres error:', error);
    }
  };

  const sendPriceChangesToHotres = async (planIdsOverride?: Set<string>) => {
    if (!property) throw new Error('Brak informacji o obiekcie');
    const pushSet = planIdsOverride ?? selectedPushRatePlanIds;

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

    const plansToSend = allRatePlans.filter(rp => pushSet.has(rp.id));
    if (plansToSend.length === 0) {
      throw new Error('Nie wybrano żadnego cennika do wysyłki.');
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
      console.log(`📋 Building payload for type_id ${currentTypeId} with ${plansToSend.length} rate plans`);

      for (const ratePlan of plansToSend) {
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
      throw new Error('Brak danych do wysłania. Sprawdź czy jednostki mają ustawiony external_type_id.');
    }

    console.log(`📦 FINAL PAYLOAD (${payloadArray.length} entries):`);
    console.log(JSON.stringify(payloadArray, null, 2));

    // Count changes for summary
    let ctaChangeCount = 0;
    let ctdChangeCount = 0;
    let minChangeCount = 0;
    priceChanges.forEach(change => {
      if (change.cta !== undefined) ctaChangeCount++;
      if (change.ctd !== undefined) ctdChangeCount++;
      if (change.min !== undefined) minChangeCount++;
    });

    // FIRST: Send to Hotres (DB is saved only after Hotres confirms success)
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

    // THEN: Save to database (only after confirmed Hotres success)
    // Iterate priceChanges directly to preserve the correct unit_id per change.
    // Using changesByTypeId would lose unit_id and units.find() could return the
    // wrong unit when multiple units share an external_type_id.
    console.log('💾 Saving confirmed changes to database...');
    let dbInsertFailed = 0;
    for (const [key, change] of priceChanges) {
      const existingPrice = pricesData.get(key);

      if (existingPrice) {
        const { error: updateErr } = await supabase
          .from('prices')
          .update({
            cta: change.cta !== undefined ? change.cta : existingPrice.cta,
            ctd: change.ctd !== undefined ? change.ctd : existingPrice.ctd,
            min: change.min !== undefined ? change.min : existingPrice.min
          })
          .eq('id', existingPrice.id);
        if (updateErr) console.error(`DB update error for ${key}:`, updateErr);
      } else if (change.unit_id && change.date) {
        // No existing record — insert one so the value persists after refresh
        const rateId = change.rate_id || allRatePlans[0]?.id || '';
        if (rateId) {
          const { error: insertErr } = await supabase
            .from('prices')
            .insert({
              unit_id: change.unit_id,
              date: change.date,
              rate_id: rateId,
              price: null,
              min: change.min ?? null,
              max: null,
              cta: change.cta ?? null,
              ctd: change.ctd ?? null,
            });
          if (insertErr) {
            console.error(`DB insert error for ${key} (403 = brak RLS INSERT):`, insertErr);
            dbInsertFailed++;
          }
        }
      }
    }
    if (dbInsertFailed > 0) {
      console.warn(`⚠ ${dbInsertFailed} nowych rekordów nie zapisało się do DB (brak uprawnień INSERT w RLS). Wartości są w Hotresie.`);
    }
    console.log('✅ Database updated successfully');

    // Verify: re-read changed records from DB and compare with sent values
    console.log('🔍 Verifying DB values after save...');
    const verifyUnitIds: string[] = [];
    const verifyDates: string[] = [];
    const sentValues: Array<{ unit_id: string; date: string; cta?: number; ctd?: number; min?: number | null }> = [];

    for (const [, change] of priceChanges) {
      if (change.unit_id && change.date) {
        verifyUnitIds.push(change.unit_id);
        verifyDates.push(change.date);
        sentValues.push({ unit_id: change.unit_id, date: change.date, cta: change.cta, ctd: change.ctd, min: change.min });
      }
    }

    let verificationFailed = 0;
    if (sentValues.length > 0) {
      const { data: dbRows } = await supabase
        .from('prices')
        .select('unit_id, date, cta, ctd, min')
        .in('unit_id', verifyUnitIds)
        .in('date', verifyDates);

      if (dbRows) {
        for (const sent of sentValues) {
          const actual = dbRows.find(r => r.unit_id === sent.unit_id && r.date === sent.date);
          if (!actual) { continue; } // new record — INSERT may have failed (RLS), tracked separately
          if (sent.cta !== undefined && actual.cta !== sent.cta) verificationFailed++;
          if (sent.ctd !== undefined && actual.ctd !== sent.ctd) verificationFailed++;
          if (sent.min !== undefined && actual.min !== sent.min) verificationFailed++;
        }
      }
    }

    console.log(`🔍 Verification: ${sentValues.length} records checked, ${verificationFailed} mismatches`);

    return {
      cellsAffected: priceChanges.size,
      ctaChanges: ctaChangeCount,
      ctdChanges: ctdChangeCount,
      minChanges: minChangeCount,
      verificationFailed,
      hotresResponse: responseData.hotres_response
    };
  };

  const runComparison = async (startDateStr: string, endDateStr: string) => {
    if (!property) return;

    setSyncing(true);
    try {
      // 1. Snapshot current DB values for date range
      const snapshot = new Map<string, { unit_id: string; date: string; cta: number | null; ctd: number | null; min: number | null }>();
      for (const [key, price] of pricesData) {
        if (price.date >= startDateStr && price.date <= endDateStr) {
          snapshot.set(key, { unit_id: price.unit_id, date: price.date, cta: price.cta, ctd: price.ctd, min: price.min });
        }
      }

      // 2. Sync Hotres → DB
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Musisz być zalogowany');

      const response = await fetch(
        'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/sync-single-property',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ property_id: property.id, prices_only: true })
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sync failed: ${response.status} ${errorText}`);
      }

      // 3. Fetch updated DB (now has Hotres values)
      const newPrices = await fetchPricesData();

      // 4. Compute diff for the given date range
      const diffs: typeof compareDiff = [];
      for (const [key, old] of snapshot) {
        const fresh = newPrices?.get(key);
        if (!fresh) continue;
        if (old.cta !== fresh.cta || old.ctd !== fresh.ctd || old.min !== fresh.min) {
          const unit = units.find(u => u.id === old.unit_id);
          diffs.push({
            unitId: old.unit_id,
            unitName: unit?.name ?? old.unit_id,
            date: old.date,
            dbCta: old.cta,
            hotresCta: fresh.cta,
            dbCtd: old.ctd,
            hotresCtd: fresh.ctd,
            dbMin: old.min,
            hotresMin: fresh.min,
          });
        }
      }

      diffs.sort((a, b) => a.date.localeCompare(b.date) || a.unitName.localeCompare(b.unitName));

      // Build per-cell sync status map for calendar color coding
      const infoMap = new Map<string, { ctaDiffers: boolean; ctdDiffers: boolean; minDiffers: boolean }>();
      for (const [key] of snapshot) {
        infoMap.set(key, { ctaDiffers: false, ctdDiffers: false, minDiffers: false });
      }
      for (const diff of diffs) {
        infoMap.set(`${diff.unitId}_${diff.date}`, {
          ctaDiffers: diff.dbCta !== diff.hotresCta,
          ctdDiffers: diff.dbCtd !== diff.hotresCtd,
          minDiffers: diff.dbMin !== diff.hotresMin,
        });
      }
      setCellCompareInfo(infoMap);

      // Persist sync status to DB so colors survive across devices
      for (const [key, info] of infoMap) {
        const price = newPrices?.get(key);
        if (price?.id) {
          await supabase.from('prices').update({
            cta_synced: !info.ctaDiffers,
            ctd_synced: !info.ctdDiffers,
          }).eq('id', price.id);
        }
      }

      if (diffs.length === 0) {
        alert(`✓ Baza i Hotres są zsynchronizowane.\nBrak różnic w zakresie ${startDateStr} – ${endDateStr}.`);
        return;
      }

      setCompareSnapshotRef(snapshot);
      setCompareDiff(diffs);
      setShowCompareModal(true);
    } catch (error: any) {
      alert(`✗ Błąd porównania: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleCompareSync = async () => {
    if (!property || syncing) return;

    const startDateStr = toLocalDateStr(dates[0]);
    const endDateStr = toLocalDateStr(dates[dates.length - 1]);

    if (!confirm(
      `Porównaj stan bazy z Hotresem?\n\n` +
      `Zakres: ${startDateStr} – ${endDateStr}\n\n` +
      `⚠ Baza zostanie zaktualizowana danymi z Hotresa.\n` +
      `Jeśli znajdziemy różnice, będziesz mógł przywrócić stan z bazy do Hotresa.`
    )) return;

    await runComparison(startDateStr, endDateStr);
  };

  const handleVerifyQuarter = async () => {
    if (!property || syncing) return;

    const { start, end } = getQuarterRange(verifyQuarter);

    if (!confirm(
      `Weryfikuj kwartał ${verifyQuarter}?\n\n` +
      `Zakres: ${start} – ${end}\n\n` +
      `⚠ Baza zostanie zaktualizowana danymi z Hotresa.\n` +
      `Jeśli znajdziemy różnice, będziesz mógł przywrócić stan z bazy do Hotresa.`
    )) return;

    await runComparison(start, end);
  };

  const handleRestoreFromSnapshot = async () => {
    if (!property || compareSnapshotRef.size === 0) return;

    const diffCount = compareDiff.length;
    if (!confirm(
      `Przywróć ${diffCount} różnych wartości z bazy do Hotresa?\n\n` +
      `• DB zostanie cofnięta do stanu sprzed synchronizacji\n` +
      `• Wartości z DB zostaną wysłane do Hotresa\n\n` +
      `Ta operacja nadpisze aktualny stan Hotresa.`
    )) return;

    setSyncing(true);
    try {
      // 1. Restore snapshot values back into DB
      for (const diff of compareDiff) {
        const snap = compareSnapshotRef.get(`${diff.unitId}_${diff.date}`);
        if (!snap) continue;
        await supabase
          .from('prices')
          .update({ cta: snap.cta, ctd: snap.ctd, min: snap.min })
          .eq('unit_id', diff.unitId)
          .eq('date', diff.date);
      }

      // 2. Build Hotres payload from snapshot diff records
      const { data: allRatePlansRaw } = await supabase
        .from('rate_plans')
        .select('id, name, external_id')
        .eq('property_id', property.id);

      const allRatePlans = (allRatePlansRaw ?? []).filter(rp => rp.external_id);
      if (allRatePlans.length === 0) throw new Error('Brak cenników z external_id.');

      const plansToSend = allRatePlans.filter(rp => selectedPushRatePlanIds.has(rp.id));
      if (plansToSend.length === 0) {
        // finally{} resets syncing; just stop here
        alert('Zaznacz przynajmniej jeden cennik do wysyłki w ⚙ Akcje / Ustawienia → „Wyślij do cenników:".');
        return;
      }

      const byTypeId = new Map<string, Array<{ date: string; cta: number | null; ctd: number | null; min: number | null }>>();
      for (const diff of compareDiff) {
        const unit = units.find(u => u.id === diff.unitId);
        if (!unit?.external_type_id) continue;
        const snap = compareSnapshotRef.get(`${diff.unitId}_${diff.date}`);
        if (!snap) continue;
        if (!byTypeId.has(unit.external_type_id)) byTypeId.set(unit.external_type_id, []);
        byTypeId.get(unit.external_type_id)!.push({ date: diff.date, cta: snap.cta, ctd: snap.ctd, min: snap.min });
      }

      const isNextDay = (d1: string, d2: string) => {
        const a = new Date(d1), b = new Date(d2);
        a.setHours(12); b.setHours(12);
        return Math.ceil(Math.abs(b.getTime() - a.getTime()) / 86400000) === 1 && b > a;
      };

      const payloadArray: Array<{ type_id: number; rate_id: number; mode: string; prices: any[] }> = [];
      for (const [typeIdStr, items] of byTypeId) {
        items.sort((a, b) => a.date.localeCompare(b.date));
        const ranges: any[] = [];
        let cur: any = null;
        for (const item of items) {
          if (cur && cur.cta === item.cta && cur.ctd === item.ctd && cur.min === item.min && isNextDay(cur.till, item.date)) {
            cur.till = item.date;
          } else {
            if (cur) ranges.push(cur);
            cur = { from: item.date, till: item.date, cta: item.cta, ctd: item.ctd, min: item.min };
          }
        }
        if (cur) ranges.push(cur);
        for (const rp of plansToSend) {
          payloadArray.push({ type_id: parseInt(typeIdStr, 10), rate_id: parseInt(rp.external_id!, 10), mode: 'delta', prices: ranges });
        }
      }

      if (payloadArray.length > 0) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Musisz być zalogowany');
        const res = await fetch(
          'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/update-hotres-prices',
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ property_id: property.id, payload: payloadArray })
          }
        );
        if (!res.ok) {
          const err = await res.json();
          throw new Error(`Błąd Hotres: ${err?.error ?? res.status}`);
        }
      }

      // Mark restored cells as synced in the calendar
      setCellCompareInfo(prev => {
        const updated = new Map(prev);
        for (const diff of compareDiff) {
          updated.set(`${diff.unitId}_${diff.date}`, { ctaDiffers: false, ctdDiffers: false, minDiffers: false });
        }
        return updated;
      });

      setShowCompareModal(false);
      setCompareDiff([]);
      setCompareSnapshotRef(new Map());
      await fetchPricesData();
      alert(`✓ Przywrócono ${diffCount} rekordów z bazy do Hotresa.`);
    } catch (error: any) {
      alert(`✗ Błąd przywracania: ${error.message}`);
    } finally {
      setSyncing(false);
    }
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

    // Pick the target rate plans before sending (modal asks every time)
    setShowOverrideModal(false);
    openPushModal('override', `🚨 OVERRIDE: ${selected.join(', ')} · wszystkie jednostki i dni. Nadpisze dane w Hotresie.`);
  };

  const executeOverride = async (planIds: Set<string>) => {
    const selected: string[] = [];
    if (overrideCTA) selected.push('CTA');
    if (overrideCTD) selected.push('CTD');
    if (overrideMIN) selected.push('MIN nocy');
    try {
      await sendAllPricesToHotres(planIds);
      alert(`✅ SUKCES!\n\nWysłano: ${selected.join(', ')}`);
    } catch (error: any) {
      alert(`❌ Błąd: ${error.message}`);
      console.error('Error overwriting restrictions:', error);
    }
  };

  const sendAllPricesToHotres = async (planIdsOverride?: Set<string>) => {
    if (!property) throw new Error('Brak informacji o obiekcie');
    const pushSet = planIdsOverride ?? selectedPushRatePlanIds;

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

    const plansToSend = allRatePlans.filter(rp => pushSet.has(rp.id));
    if (plansToSend.length === 0) {
      throw new Error('Nie wybrano żadnego cennika do wysyłki.');
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
      console.log(`📋 Building payload for type_id ${currentTypeId} with ${plansToSend.length} rate plans`);

      for (const ratePlan of plansToSend) {
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

  const handleCtaChange = useCallback((unitId: string, dateStr: string, checked: boolean) => {
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
      const ctdMatches = updatedChange.ctd === undefined || updatedChange.ctd === currentPrice?.ctd;
      const minMatches = updatedChange.min === undefined || updatedChange.min === (currentPrice?.min ?? null);

      if (ctaMatches && ctdMatches && minMatches) {
        updated.delete(key);
      } else {
        updated.set(key, updatedChange);
      }
      return updated;
    });
  }, [pricesData, priceChanges]);

  const handleCtdChange = useCallback((unitId: string, dateStr: string, checked: boolean) => {
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
      const ctaMatches = updatedChange.cta === undefined || updatedChange.cta === currentPrice?.cta;
      const ctdMatches = (currentPrice?.ctd === 1) === checked;
      const minMatches = updatedChange.min === undefined || updatedChange.min === (currentPrice?.min ?? null);

      if (ctaMatches && ctdMatches && minMatches) {
        updated.delete(key);
      } else {
        updated.set(key, updatedChange);
      }
      return updated;
    });
  }, [pricesData, priceChanges]);

  const handleMinChange = useCallback((unitId: string, dateStr: string, value: string) => {
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
      const ctaMatches = updatedChange.cta === undefined || updatedChange.cta === currentPrice?.cta;
      const ctdMatches = updatedChange.ctd === undefined || updatedChange.ctd === currentPrice?.ctd;
      const minMatches = (currentPrice?.min ?? null) === minValue;

      if (ctaMatches && ctdMatches && minMatches) {
        updated.delete(key);
      } else {
        updated.set(key, updatedChange);
      }
      return updated;
    });
  }, [pricesData, priceChanges]);

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

      // Availability changed → recompute gap protection from fresh local data.
      try {
        await recomputeGapRestrictions(property.id);
        await loadGapRestrictions();
      } catch (gapErr) {
        console.error('Gap recompute after sync failed (non-fatal):', gapErr);
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
  // ─── Gap Protection Engine integration ───────────────────────────────────
  // Load engine output for the visible window (same ~90-day span as the grid).
  const loadGapRestrictions = async () => {
    if (units.length === 0) return;
    try {
      const start = new Date(selectedDate); start.setDate(start.getDate() - 30);
      const end = new Date(selectedDate); end.setDate(end.getDate() + 60);
      const map = await fetchGapRestrictionsSvc(
        units.map(u => u.id), toLocalDateStr(start), toLocalDateStr(end),
      );
      setGapRestrictions(map);
    } catch (err) {
      console.error('loadGapRestrictions error:', err);
    }
  };

  const getGapRestriction = (unitId: string, dateStr: string): GapRestriction | undefined =>
    gapRestrictions.get(`${unitId}_${dateStr}`);

  // Change the per-property Gap Assistant mode (off / suggest / autofill).
  const handleChangeGapMode = async (mode: GapMode) => {
    if (!property) return;
    const prev = gapMode;
    setGapMode(mode);
    try {
      await setPropertyGapMode(property.id, mode);
      if (mode === 'off') setGapRestrictions(new Map());
    } catch (err: any) {
      setGapMode(prev);
      alert(`✗ Nie udało się zmienić trybu: ${err.message}`);
    }
  };

  // Open the per-property Gap Protection settings modal, pre-filled with current values.
  const openGapConfig = async () => {
    if (!property) return;
    setShowGapMenu(false);
    try {
      const cfg = await getPropertyGapConfig(property.id);
      setGapConfigDraft(cfg);
    } catch {
      setGapConfigDraft(DEFAULT_GAP_CONFIG);
    }
    setShowGapConfig(true);
  };

  const handleSaveGapConfig = async () => {
    if (!property) return;
    const d = gapConfigDraft;
    if (d.min_acceptable_gap < 1) {
      alert('Minimalna luka musi być ≥ 1.');
      return;
    }
    setSavingGapConfig(true);
    try {
      await savePropertyGapConfig(property.id, d);
      setShowGapConfig(false);
      if (confirm('✓ Zapisano ustawienia ochrony luk.\n\nPrzeliczyć teraz na nowych wartościach?')) {
        await runRecompute({}, 'cały obiekt');
      }
    } catch (err: any) {
      alert(`✗ Błąd zapisu ustawień: ${err.message}`);
    } finally {
      setSavingGapConfig(false);
    }
  };

  // Suggest mode: prefill engine output into the existing staging buffer (priceChanges)
  // so the operator pushes with the normal "Wyślij na Hotres" flow — as if edited by hand.
  // Does NOT overwrite cells the operator already changed manually.
  const applyGapSuggestionsToStaging = () => {
    if (gapRestrictions.size === 0) { alert('Brak sugestii ochrony luk. Kliknij „Przelicz ochronę luk".'); return; }
    let applied = 0;
    setPriceChanges(prev => {
      const updated = new Map(prev);
      gapRestrictions.forEach((gr, key) => {
        if (updated.has(key)) return; // keep manual edits
        const priceData = pricesData.get(key);
        const next: Partial<Price> = {
          unit_id: gr.unit_id, date: gr.date, rate_id: priceData?.rate_id || gr.rate_id || '',
        };
        let changed = false;
        if (gr.cta !== null && gr.cta !== (priceData?.cta ?? 0)) { next.cta = gr.cta; changed = true; }
        if (gr.ctd !== null && gr.ctd !== (priceData?.ctd ?? 0)) { next.ctd = gr.ctd; changed = true; }
        if (gr.min_los !== null && gr.min_los !== (priceData?.min ?? null)) { next.min = gr.min_los; changed = true; }
        if (changed) { updated.set(key, next); applied++; }
      });
      return updated;
    });
    alert(`✓ Wstawiono ${applied} sugestii do edycji. Sprawdź i kliknij „Wyślij na Hotres".`);
  };

  // Unit ids that currently have unread notifications (default recompute scope).
  const notificationUnitIds = (): string[] =>
    [...new Set(unreadNotifications.map(n => n.unit_id))];

  // Recompute restrictions server-side, scoped, then reload. `silent` skips the alert
  // (used by the automatic "suggest on new notification" path).
  const runRecompute = async (
    scope: { unitIds?: string[]; from?: string; to?: string },
    label: string,
    silent = false,
  ) => {
    if (!property) return;
    setRecomputingGaps(true);
    try {
      const res = await recomputeGapRestrictions(property.id, scope);
      await loadGapRestrictions();
      if (!silent) {
        if (res.skipped) alert('🛡 Tryb „Off" — silnik nic nie przeliczył dla tego obiektu.');
        else alert(`🛡 Ochrona luk przeliczona (${label}).\n\nJednostki: ${res.units}\nLuki: ${res.gaps}\nDni restrykcji: ${res.restrictions_upserted}`);
      }
    } catch (err: any) {
      if (!silent) alert(`✗ Błąd przeliczania ochrony luk: ${err.message}`);
      else console.error('auto-suggest recompute failed:', err);
    } finally {
      setRecomputingGaps(false);
    }
  };

  // Default action: only the units that arrived as notifications.
  const handleRecomputeNotifications = async () => {
    setShowGapMenu(false);
    const unitIds = notificationUnitIds();
    if (unitIds.length === 0) { alert('Brak nowych powiadomień do przeliczenia. Użyj rozwijanego menu, aby sprawdzić miesiąc lub przedział.'); return; }
    await runRecompute({ unitIds }, `powiadomienia: ${unitIds.length} jedn.`);
  };

  // Dropdown: current visible month (all units).
  const handleRecomputeMonth = async () => {
    setShowGapMenu(false);
    const first = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const last = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    await runRecompute({ from: toLocalDateStr(first), to: toLocalDateStr(last) }, `miesiąc ${toLocalDateStr(first).slice(0, 7)}`);
  };

  // Dropdown: arbitrary date range (all units).
  const handleRecomputeRange = async () => {
    setShowGapMenu(false);
    const from = prompt('Sprawdź przedział — data OD (RRRR-MM-DD):', toLocalDateStr(dates[0]));
    if (!from) return;
    const to = prompt('Sprawdź przedział — data DO (RRRR-MM-DD):', toLocalDateStr(dates[dates.length - 1]));
    if (!to) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) { alert('Niepoprawny format daty (RRRR-MM-DD).'); return; }
    await runRecompute({ from, to }, `przedział ${from} – ${to}`);
  };

  // Dropdown: whole property (full horizon).
  const handleRecomputeAll = async () => {
    setShowGapMenu(false);
    await runRecompute({}, 'cały obiekt');
  };

  // Auto-suggest on incoming notifications (debounced). Only in 'suggest' mode.
  const scheduleAutoSuggest = (unitId: string) => {
    if (gapModeRef.current !== 'suggest') return;
    autoSuggestUnitsRef.current.add(unitId);
    if (autoSuggestTimerRef.current) clearTimeout(autoSuggestTimerRef.current);
    autoSuggestTimerRef.current = setTimeout(() => {
      const unitIds = [...autoSuggestUnitsRef.current];
      autoSuggestUnitsRef.current.clear();
      if (unitIds.length > 0) runRecompute({ unitIds }, 'auto', true);
    }, 1500);
  };

  // Keep a ref of the current mode for stable use inside the realtime callback.
  useEffect(() => { gapModeRef.current = gapMode; }, [gapMode]);

  // Realtime: when a new notification arrives for this property, refresh the list
  // and (in 'suggest' mode) immediately recompute that unit so a suggestion shows up.
  useEffect(() => {
    if (!propertyId) return;
    const channel = supabase
      .channel(`notif-gap-${propertyId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `property_id=eq.${propertyId}` },
        (payload: any) => {
          fetchUnreadNotifications();
          const unitId = payload?.new?.unit_id;
          if (unitId) scheduleAutoSuggest(unitId);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [propertyId]);

  // Push engine output to Hotres, respecting the saved push rate-plan selection.
  const executePushGapsToHotres = async (planIds: Set<string>) => {
    if (!property) return;
    try {
      const { data: rps } = await supabase
        .from('rate_plans').select('id, name, external_id').eq('property_id', property.id);
      const plansToSend = (rps ?? [])
        .filter(rp => rp.external_id != null && planIds.has(rp.id))
        .map(rp => ({ external_id: String(rp.external_id) }));
      if (plansToSend.length === 0) { alert('Nie wybrano żadnego cennika (z external_id) do wysyłki.'); return; }
      const startStr = toLocalDateStr(dates[0]);
      const endStr = toLocalDateStr(dates[dates.length - 1]);
      const res = await pushGapRestrictionsToHotres({ propertyId: property.id, units, plansToSend, startStr, endStr });
      alert(`✓ Wysłano ochronę luk do Hotresa:\n• ${res.records} rekordów (CTA/CTD/MIN)\n• Zakres: ${startStr} – ${endStr}`);
    } catch (err: any) {
      alert(`✗ Błąd wysyłki ochrony luk: ${err.message}`);
    }
  };

  const handlePushGapsToHotres = () => {
    if (!property) return;
    const startStr = toLocalDateStr(dates[0]);
    const endStr = toLocalDateStr(dates[dates.length - 1]);
    openPushModal('gaps', `Wyślę CTA/CTD/MIN z silnika ochrony luk (gap_restrictions).\nZakres: ${startStr} – ${endStr}.\nNadpisze bieżące restrykcje w Hotresie.`);
  };

  // Persist selected calendar cells as a Gap override (survives recompute).
  const handleSaveGapOverrides = async () => {
    if (selectedCells.size === 0) { alert('Zaznacz przynajmniej jedną komórkę (tryb edycji zbiorczej).'); return; }
    if (bulkEditCTA === null && bulkEditCTD === null && bulkEditMIN === null) {
      alert('Ustaw przynajmniej jedną wartość (CTA / CTD / MIN) do zapisania jako override.');
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ops: Promise<void>[] = [];
      selectedCells.forEach(key => {
        const idx = key.lastIndexOf('_');
        const unitId = key.slice(0, idx);
        const dateStr = key.slice(idx + 1);
        ops.push(saveGapOverride({
          unit_id: unitId, date_from: dateStr, date_to: dateStr,
          cta: bulkEditCTA as 0 | 1 | null, ctd: bulkEditCTD as 0 | 1 | null, min_los: bulkEditMIN,
          reason: 'operator_override', operator_email: user?.email ?? null, expires_at: null,
        }));
      });
      await Promise.all(ops);
      setShowBulkEditModal(false);
      setBulkEditMode(false);
      setSelectedCells(new Set());
      alert(`✓ Zapisano ${ops.length} override(ów) ochrony luk.\nKliknij „Przelicz ochronę luk", aby je zastosować.`);
    } catch (err: any) {
      alert(`✗ Błąd zapisu override: ${err.message}`);
    }
  };

  const fetchAISuggestions = async () => {
    if (!AI_SUGGESTIONS_ENABLED) return; // retired — Gap Protection Engine is the source of truth
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
    if (!AI_SUGGESTIONS_ENABLED) return null; // retired
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
    const prevDateStr = dateIndex > 0 ? toLocalDateStr(dates[dateIndex - 1]) : null;
    const prevDate = prevDateStr ? new Date(prevDateStr) : null;
    const hasPrevSharedNotif = prevDate ? currentNotifs.some(notif => {
      const notifStart = new Date(notif.start_date);
      const notifEnd = new Date(notif.end_date);
      return prevDate >= notifStart && prevDate <= notifEnd;
    }) : false;

    // Check if any of current notifications also cover next day
    const nextDateStr = dateIndex < dates.length - 1 ? toLocalDateStr(dates[dateIndex + 1]) : null;
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

  const selectedDateStr = toLocalDateStr(selectedDate);
  const startDateStr = dates[0].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  const endDateStr = dates[dates.length - 1].toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });

  // Toggle a rate plan in the push-to-Hotres selection
  const togglePushRatePlan = (id: string) => {
    setSelectedPushRatePlanIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const togglePushModalPlan = (id: string) => {
    setPushModalSelection(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Panel: which rate plans receive min/availability/CTA/CTD on push to Hotres
  const renderPushRatePlanSelector = () => {
    if (ratePlans.length === 0) return null;
    return (
      <div className="mt-3 p-3 bg-slate-800 rounded-lg text-xs text-slate-300 border border-blue-900/60">
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-slate-200">📤 Wyślij do cenników (push){selectedPushRatePlanIds.size > 0 ? ` — ${selectedPushRatePlanIds.size}` : ''}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setSelectedPushRatePlanIds(new Set(ratePlans.map(rp => rp.id)))}
              className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-0.5 rounded text-[10px]"
            >
              Zaznacz wszystkie
            </button>
            <button
              onClick={() => setSelectedPushRatePlanIds(new Set())}
              className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-0.5 rounded text-[10px]"
            >
              Odznacz wszystkie
            </button>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mb-2">Niezależne od cennika wyświetlanego na kalendarzu — możesz patrzeć na jeden, a wysłać na kilka.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
          {ratePlans.map(rp => (
            <label key={rp.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedPushRatePlanIds.has(rp.id)}
                onChange={() => togglePushRatePlan(rp.id)}
                className="w-3.5 h-3.5 accent-indigo-500 flex-shrink-0"
              />
              <span className="break-words">{rp.name}</span>
            </label>
          ))}
        </div>
        {selectedPushRatePlanIds.size === 0 && (
          <p className="text-[10px] text-red-400 mt-2">Zaznacz przynajmniej jeden cennik — bez tego push nie wyśle nic.</p>
        )}
      </div>
    );
  };

  // Button that opens the per-unit rate plan matrix modal
  const renderRatePlanMatrixButton = () => (
    <div className="mt-3">
      <button
        onClick={() => setShowRatePlanMatrix(true)}
        className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold py-2 px-3 sm:py-2.5 sm:px-5 rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
      >
        <span className="text-xs sm:text-sm">🗓 Cenniki na kalendarzu</span>
      </button>
      <p className="text-[10px] text-slate-500 text-center mt-1">Wybierz, który cennik wyświetla się dla każdej kwatery</p>
    </div>
  );

  // Single collapsible panel gathering the heavier actions so the calendar stays clean.
  // Includes: rate plan matrix, compare, verify quarter, push (with rate-plan selector),
  // override, plus the per-button visibility checkboxes.
  const renderActionsPanel = () => (
    <div className="mt-2 p-3 bg-slate-800 rounded-lg space-y-3 text-xs text-slate-300">
      {/* Per-button visibility toggles */}
      <div>
        <div className="font-semibold text-slate-200 mb-1.5">Pokaż przyciski:</div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'compare', label: '🔍 Porównaj' },
            { key: 'push', label: '📤 Push DB' },
            { key: 'override', label: '🚨 OVERRIDE' },
            { key: 'verifyQuarter', label: '📅 Kwartał' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={viewOptions[key] !== false}
                onChange={e => setViewOption(key, e.target.checked)}
                className="w-3.5 h-3.5"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Rate plan matrix (per-unit rate plan selection) */}
      {renderRatePlanMatrixButton()}

      {/* Weryfikuj kwartał */}
      {viewOptions.verifyQuarter !== false && (
        <div className="flex gap-2">
          <select
            value={verifyQuarter}
            onChange={e => setVerifyQuarter(e.target.value)}
            className="flex-1 bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded-lg px-2 py-1.5"
          >
            {quarterOptions.map(q => <option key={q} value={q}>{q}</option>)}
          </select>
          <button
            onClick={handleVerifyQuarter}
            disabled={syncing}
            className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold py-1.5 px-3 rounded-lg text-xs flex items-center justify-center gap-1"
          >
            {syncing ? '⏳...' : '📅 Weryfikuj kwartał'}
          </button>
        </div>
      )}

      {/* Compare DB vs Hotres */}
      {viewOptions.compare !== false && (
        <div>
          <button
            onClick={handleCompareSync}
            disabled={syncing}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2 px-3 rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
          >
            <span className="text-xs sm:text-sm">{syncing ? '⏳ Porównywanie...' : '🔍 Porównaj DB ↔ Hotres'}</span>
          </button>
          <p className="text-[10px] text-slate-500 text-center mt-1">Pokaż różnice i opcję przywrócenia stanu DB</p>
        </div>
      )}

      {/* Rate plans to push to Hotres */}
      {(viewOptions.push !== false || viewOptions.override !== false) && renderPushRatePlanSelector()}

      {/* Push DB → Hotres */}
      {viewOptions.push !== false && (
        <div>
          <button
            onClick={handlePushDBToHotres}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
          >
            <span className="text-xs sm:text-sm">📤 Push DB → Hotres</span>
          </button>
          <p className="text-[10px] text-slate-500 text-center mt-1">Wyślij CTA/CTD/MIN z bazy do Hotresa (aktualny widok)</p>
        </div>
      )}

      {/* OVERRIDE */}
      {viewOptions.override !== false && (
        <div>
          <button
            onClick={handleOpenOverrideModal}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded-lg shadow-md transition-all flex items-center justify-center gap-2"
          >
            <span className="text-xs sm:text-sm">🚨 OVERRIDE</span>
          </button>
          <p className="text-[10px] text-slate-500 text-center mt-1">Nadpisz wybrane restrykcje w Hotresie (wymaga hasła)</p>
        </div>
      )}
    </div>
  );

  // The "⚙ Akcje / Ustawienia" toggle + panel (shared by both view modes)
  const renderActionsToggle = () => (
    <div className="mt-3">
      <button
        onClick={() => setShowActions(v => !v)}
        className="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium py-1.5 px-3 rounded-lg flex items-center justify-between"
      >
        <span>⚙ Akcje / Ustawienia</span>
        <span>{showActions ? '▲' : '▼'}</span>
      </button>
      {showActions && renderActionsPanel()}
    </div>
  );

  return (
    <div className="space-y-2 sm:space-y-4 w-full max-w-full px-2 sm:px-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-white">{property?.name}</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Widok kwartalny dostępności</p>
        </div>
      </div>

      <div className="bg-surface rounded-lg sm:rounded-xl border border-border p-2 sm:p-3 shadow-lg relative w-full">
        {loadingAvailability && allUnitsAvailability.size === 0 && (
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
                onClick={handleDismissAllNotifications}
                className="flex items-center gap-1 px-2 py-1 sm:px-3 sm:py-2 text-[10px] sm:text-xs bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors font-medium whitespace-nowrap"
                title="Odrzuć wszystkie powiadomienia"
              >
                <span>✕ Wyczyść</span>
              </button>
            )}
            {AI_SUGGESTIONS_ENABLED && viewMode === 'notifications' && unreadNotifications.length > 0 && (
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

            {AI_SUGGESTIONS_ENABLED && aiSuggestions.size > 0 && (
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

            {/* Gap Protection Engine — mode toggle + actions */}
            {(viewMode === 'full' || viewMode === 'notifications') && (
              <>
                {/* 3-position mode toggle (per property) */}
                <div className="flex items-center gap-0.5 bg-slate-800 rounded-lg p-0.5" title="Tryb Asystenta Luk dla tego obiektu">
                  <Shield size={12} className="text-teal-400 ml-1 mr-0.5" />
                  {([
                    ['off', 'Off', 'Nie rób nic'],
                    ['suggest', 'Sugeruj', 'Licz i podsuwaj sugestie (push ręczny)'],
                    ['autofill', 'Autofill', 'Licz i wysyłaj automatycznie co 10 min'],
                  ] as [GapMode, string, string][]).map(([m, label, tip]) => (
                    <button
                      key={m}
                      onClick={() => handleChangeGapMode(m)}
                      title={tip}
                      className={`px-1.5 py-0.5 sm:px-2 sm:py-1 text-[9px] sm:text-[11px] rounded-md font-semibold transition-colors ${
                        gapMode === m
                          ? (m === 'autofill' ? 'bg-cyan-600 text-white' : m === 'off' ? 'bg-slate-600 text-white' : 'bg-teal-600 text-white')
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={openGapConfig}
                  className="px-2 py-1 sm:px-2.5 sm:py-2 text-[10px] sm:text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors font-medium whitespace-nowrap"
                  title="Ustawienia ochrony luk (min. luka, Min LOS, horyzont…) dla tego obiektu"
                >
                  ⚙ Ustawienia luk
                </button>

                {gapMode !== 'off' && (
                  <div className="relative flex items-stretch">
                    {/* Default: only units that arrived as notifications */}
                    <button
                      onClick={handleRecomputeNotifications}
                      disabled={recomputingGaps}
                      className="flex items-center gap-1 sm:gap-2 px-2 py-1 sm:px-3 sm:py-2 text-[10px] sm:text-xs bg-teal-700 hover:bg-teal-600 disabled:opacity-50 text-white rounded-l-lg transition-colors font-medium whitespace-nowrap"
                      title="Przelicz ochronę luk tylko dla jednostek z nowymi powiadomieniami"
                    >
                      {recomputingGaps
                        ? <Loader2 size={12} className="sm:w-3.5 sm:h-3.5 animate-spin" />
                        : <Shield size={12} className="sm:w-3.5 sm:h-3.5" />}
                      <span className="hidden sm:inline">🛡 Przelicz (powiadomienia)</span>
                      <span className="sm:hidden">🛡 Powiad.</span>
                    </button>
                    <button
                      onClick={() => setShowGapMenu(v => !v)}
                      disabled={recomputingGaps}
                      className="px-1.5 sm:px-2 bg-teal-800 hover:bg-teal-700 disabled:opacity-50 text-white rounded-r-lg border-l border-teal-900 transition-colors"
                      title="Więcej zakresów"
                    >
                      <ChevronRight size={14} className="rotate-90" />
                    </button>
                    {showGapMenu && (
                      <div className="absolute top-full left-0 mt-1 z-30 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[180px]">
                        <button onClick={handleRecomputeMonth} className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700">📅 Sprawdź miesiąc</button>
                        <button onClick={handleRecomputeRange} className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700">📆 Sprawdź przedział…</button>
                        <button onClick={handleRecomputeAll} className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700">🏠 Cały obiekt</button>
                      </div>
                    )}
                  </div>
                )}
                {gapMode === 'suggest' && gapRestrictions.size > 0 && (
                  <button
                    onClick={applyGapSuggestionsToStaging}
                    className="flex items-center gap-1 sm:gap-2 px-2 py-1 sm:px-3 sm:py-2 text-[10px] sm:text-xs bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors font-medium whitespace-nowrap"
                    title="Wstaw sugestie do edycji (prefill) — potem wyślij normalnym „Wyślij na Hotres”"
                  >
                    <Shield size={12} className="sm:w-3.5 sm:h-3.5" />
                    <span className="hidden sm:inline">🛡 Zastosuj sugestie (prefill)</span>
                    <span className="sm:hidden">🛡 Prefill</span>
                  </button>
                )}
              </>
            )}

            {/* Bulk Edit Mode Toggle - available in full and notifications view */}
            {(viewMode === 'full' || viewMode === 'notifications') && (
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

            {/* Sync DB ← Hotres Button — kept visible (most-used action) */}
            <div className="mt-3">
              <button
                onClick={triggerAvailabilitySync}
                disabled={syncing}
                className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white font-semibold py-2 px-3 sm:py-2.5 sm:px-5 rounded-lg shadow-md transition-all hover:shadow-lg active:scale-98 flex items-center justify-center gap-2"
              >
                <span className="text-xs sm:text-sm">{syncing ? '⏳ Synchronizacja...' : '⬇️ Pobierz z Hotres'}</span>
              </button>
              <p className="text-[10px] text-slate-500 text-center mt-1">Pobiera świeże ceny i dostępność z Hotres do DB</p>
            </div>

            {/* All other actions live under a single ⚙ toggle to keep the calendar clean */}
            {renderActionsToggle()}
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

        {/* Sync DB ← Hotres Button for Full View — kept visible (most-used action) */}
        {viewMode === 'full' && (
          <div className="mb-2 sm:mb-3">
            <button
              onClick={triggerAvailabilitySync}
              disabled={syncing}
              className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white font-semibold py-2 px-3 sm:py-2.5 sm:px-5 rounded-lg shadow-md transition-all hover:shadow-lg active:scale-98 flex items-center justify-center gap-2"
            >
              <span className="text-xs sm:text-sm">{syncing ? '⏳ Synchronizacja...' : '⬇️ Pobierz z Hotres'}</span>
            </button>
            <p className="text-[10px] text-slate-500 text-center mt-1">Pobiera świeże ceny i dostępność z Hotres do DB</p>
          </div>
        )}

        {/* All other actions under a single ⚙ toggle to keep the calendar clean */}
        {viewMode === 'full' && renderActionsToggle()}

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
                  const isSelected = toLocalDateStr(date) === selectedDateStr;
                  return (
                    <th
                      key={idx}
                      className={`p-1 sm:p-2 text-center text-[10px] sm:text-xs font-medium border-r border-border min-w-[70px] sm:min-w-[75px] lg:min-w-[90px] ${
                        isToday ? 'bg-indigo-600/50 ring-2 ring-inset ring-indigo-400' : isSelected ? 'bg-indigo-900/50' : 'bg-surface'
                      }`}
                    >
                      {isToday ? (
                        <>
                          <div className="mx-auto w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-indigo-500 text-white font-bold text-[10px] sm:text-xs flex items-center justify-center shadow-lg shadow-indigo-900/50">
                            {date.getDate()}
                          </div>
                          <div className="text-indigo-200 font-bold uppercase text-[8px] sm:text-[10px] tracking-wide">
                            dziś
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-slate-300 font-bold text-[10px] sm:text-xs">
                            {date.getDate()}
                          </div>
                          <div className="text-slate-500 text-[8px] sm:text-[10px]">
                            {date.toLocaleDateString('pl-PL', { weekday: 'short' })}
                          </div>
                        </>
                      )}
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
                    <td className="sticky left-0 z-20 bg-surface p-1 sm:p-2 border-r border-border min-w-[70px] sm:min-w-[80px] lg:min-w-[120px]">
                      <div className="text-[10px] sm:text-[11px] lg:text-xs font-medium text-white">{unit.name}</div>
                    </td>
                    {dates.map((date, idx) => {
                      const dateStr = toLocalDateStr(date);
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
                            isToday ? 'bg-indigo-500/25 shadow-[inset_2px_0_0_0_rgba(129,140,248,0.6),inset_-2px_0_0_0_rgba(129,140,248,0.6)]' : isSelected ? 'bg-indigo-900/30' : ''
                          } ${notifBoxClass} ${bulkEditMode ? 'cursor-pointer hover:bg-indigo-800/40' : ''} ${
                            isCellSelected ? 'bg-indigo-600/50 ring-2 ring-indigo-400 ring-inset' : ''
                          }`}
                        >
                          {(() => {
                            const priceKey = cellKey;
                            const priceData = pricesData.get(priceKey);
                            const changeData = priceChanges.get(priceKey);
                            const compareInfo = cellCompareInfo.get(priceKey);
                            const gapR = getGapRestriction(unit.id, dateStr);

                            // Use change data if available, otherwise use price data
                            const ctaValue = changeData?.cta !== undefined ? changeData.cta === 1 : priceData?.cta === 1;
                            const ctdValue = changeData?.ctd !== undefined ? changeData.ctd === 1 : priceData?.ctd === 1;
                            const minValue = changeData?.min !== undefined
                              ? (changeData.min !== null ? String(changeData.min) : '')
                              : (priceData?.min !== null && priceData?.min !== undefined ? String(priceData.min) : '');

                            // Sync status per field: pending > compared > value-based default
                            // If value is 1 (set/active) and status unknown → yellow (assume not in Hotres yet)
                            // If value is 1 and confirmed synced → green
                            // If value is 0 and no pending change → no color
                            const ctaSynced = compareInfo && !compareInfo.ctaDiffers;
                            const ctaColor = changeData?.cta !== undefined
                              ? 'bg-yellow-500/35 rounded'       // pending unsent change
                              : compareInfo
                                ? compareInfo.ctaDiffers
                                  ? 'bg-yellow-500/30 rounded'   // differs from Hotres
                                  : ctaValue ? 'bg-green-500/20 rounded' : ''  // synced (only color when checked)
                                : ctaValue
                                  ? 'bg-yellow-500/20 rounded'   // checked but no comparison → assume DB-only
                                  : '';
                            const ctaTextColor = ctaColor.includes('green') ? 'text-green-400'
                              : ctaColor ? 'text-yellow-400' : 'text-slate-400';

                            const ctdSynced = compareInfo && !compareInfo.ctdDiffers;
                            const ctdColor = changeData?.ctd !== undefined
                              ? 'bg-yellow-500/35 rounded'
                              : compareInfo
                                ? compareInfo.ctdDiffers
                                  ? 'bg-yellow-500/30 rounded'
                                  : ctdValue ? 'bg-green-500/20 rounded' : ''
                                : ctdValue
                                  ? 'bg-yellow-500/20 rounded'
                                  : '';
                            const ctdTextColor = ctdColor.includes('green') ? 'text-green-400'
                              : ctdColor ? 'text-yellow-400' : 'text-slate-400';

                            const minIsSet = (priceData?.min !== null && priceData?.min !== undefined)
                              || (changeData?.min !== null && changeData?.min !== undefined);
                            const minPending = changeData?.min !== undefined;

                            void ctaSynced; void ctdSynced;

                            // Gap Protection Engine overlay: tint by source/confidence, tooltip with reason.
                            const gapBorder = gapR
                              ? gapR.source === 'manual'
                                ? 'ring-1 ring-purple-400/70'
                                : gapR.confidence < 1
                                  ? 'ring-1 ring-amber-400/70'
                                  : 'ring-1 ring-teal-400/50'
                              : '';
                            const gapTitle = gapR
                              ? `🛡 Ochrona luk\nCTA=${gapR.cta} CTD=${gapR.ctd} Min=${gapR.min_los ?? '-'} Max=${gapR.max_los ?? '-'}\nPowód: ${gapR.reason ?? '-'}\nŹródło: ${gapR.source} · pewność ${Math.round((gapR.confidence ?? 0) * 100)}%${gapR.gap_id ? `\nLuka: ${gapR.gap_id}` : ''}`
                              : '';

                            return (
                              <div className={`flex flex-col gap-1 rounded ${gapBorder}`} title={gapR ? gapTitle : undefined}>
                                {/* Colored cell with 0/1 */}
                                <div
                                  className={cellClass}
                                  title={aiSuggestion ? `🤖 AI Sugestia: CTA=${aiSuggestion.suggested_cta}, CTD=${aiSuggestion.suggested_ctd}, MIN=${aiSuggestion.suggested_min}` : `${unit.name} - ${dateStr}: ${status || 'available'}`}
                                  onClick={() => aiSuggestion && setSelectedSuggestion(aiSuggestion)}
                                >
                                  {aiSuggestion ? '🤖' : (isBooked ? '0' : '1')}
                                </div>
                                {gapR && (
                                  <div
                                    className={`text-[7px] sm:text-[8px] leading-none text-center font-semibold rounded px-0.5 ${
                                      gapR.source === 'manual' ? 'text-purple-300' : gapR.confidence < 1 ? 'text-amber-300' : 'text-teal-300'
                                    }`}
                                  >
                                    🛡{gapR.min_los ?? '-'}{gapR.max_los != null ? `-${gapR.max_los}` : ''}
                                  </div>
                                )}

                                {/* Checkboxes in one line - vertical labels */}
                                <div className="flex items-center justify-center gap-1 sm:gap-1.5 lg:gap-2">
                                  <label className={`flex flex-col items-center gap-0.5 cursor-pointer px-0.5 ${ctaColor}`}>
                                    <input
                                      type="checkbox"
                                      className="w-4 h-4 sm:w-4 sm:h-4 lg:w-5 lg:h-5 cursor-pointer"
                                      checked={ctaValue}
                                      onChange={(e) => handleCtaChange(unit.id, dateStr, e.target.checked)}
                                    />
                                    <span className={`text-[8px] sm:text-[9px] font-semibold ${ctaTextColor}`}>CTA</span>
                                  </label>
                                  <label className={`flex flex-col items-center gap-0.5 cursor-pointer px-0.5 ${ctdColor}`}>
                                    <input
                                      type="checkbox"
                                      className="w-4 h-4 sm:w-4 sm:h-4 lg:w-5 lg:h-5 cursor-pointer"
                                      checked={ctdValue}
                                      onChange={(e) => handleCtdChange(unit.id, dateStr, e.target.checked)}
                                    />
                                    <span className={`text-[8px] sm:text-[9px] font-semibold ${ctdTextColor}`}>CTD</span>
                                  </label>
                                </div>

                                {/* MIN input - no color coding, green tick when set */}
                                <div className="flex flex-col gap-0.5 items-center">
                                  <div className="relative w-full flex items-center">
                                    <input
                                      type="text"
                                      className={`w-full px-1 py-1 sm:px-1 sm:py-1 lg:px-1.5 lg:py-1 text-center text-[10px] sm:text-[10px] lg:text-[11px] bg-slate-800 border rounded text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 ${minPending ? 'border-yellow-500' : 'border-slate-700'}`}
                                      placeholder="000"
                                      value={minValue}
                                      onChange={(e) => handleMinChange(unit.id, dateStr, e.target.value)}
                                    />
                                    {minIsSet && !minPending && (
                                      <span className="absolute -right-1 -top-1 text-green-400 text-[8px] leading-none">✓</span>
                                    )}
                                  </div>
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

      {/* Shared push-target modal — asks which rate plans to push to, every push action */}
      {showPushSendModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className={`bg-slate-800 rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col border ${pushModalAction === 'override' ? 'border-red-600' : 'border-yellow-600'}`}>
            <div className="p-5 border-b border-slate-700">
              <h2 className={`text-xl font-bold flex items-center gap-2 ${pushModalAction === 'override' ? 'text-red-500' : 'text-yellow-500'}`}>
                {pushModalAction === 'override' ? '🚨 OVERRIDE — wybierz cenniki' : pushModalAction === 'pushdb' ? '📤 Push DB → Hotres' : '📤 Wyślij na Hotres'}
              </h2>
              <p className="text-sm text-slate-300 mt-2">Do których cenników wysłać?</p>
              {pushModalInfo && (
                <p className="text-xs text-slate-400 mt-1 whitespace-pre-line">{pushModalInfo}</p>
              )}
              {pushModalAction === 'sync' && readNotificationIds.size > 0 && (
                <p className="text-xs text-slate-400 mt-1">+ {readNotificationIds.size} odczytanych powiadomień</p>
              )}
            </div>

            <div className="p-5 overflow-y-auto">
              {ratePlans.length === 0 ? (
                <p className="text-slate-400 text-sm">Brak cenników dla tego obiektu.</p>
              ) : (
                <>
                  <div className="flex justify-end gap-1 mb-2">
                    <button
                      onClick={() => setPushModalSelection(new Set(ratePlans.map(rp => rp.id)))}
                      className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-0.5 rounded text-[10px]"
                    >
                      Zaznacz wszystkie
                    </button>
                    <button
                      onClick={() => setPushModalSelection(new Set())}
                      className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-0.5 rounded text-[10px]"
                    >
                      Odznacz wszystkie
                    </button>
                  </div>
                  <div className="space-y-2">
                    {ratePlans.map(rp => (
                      <label key={rp.id} className="flex items-center gap-3 p-2 bg-slate-700/40 rounded-lg cursor-pointer hover:bg-slate-700 transition">
                        <input
                          type="checkbox"
                          checked={pushModalSelection.has(rp.id)}
                          onChange={() => togglePushModalPlan(rp.id)}
                          className="w-5 h-5 accent-yellow-600 flex-shrink-0"
                        />
                        <span className="text-sm text-white break-words">{rp.name}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="p-5 border-t border-slate-700">
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPushSendModal(false)}
                  className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-semibold py-2.5 px-4 rounded-lg transition"
                >
                  Anuluj
                </button>
                <button
                  onClick={confirmPushModal}
                  disabled={pushModalSelection.size === 0}
                  className={`flex-1 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-lg transition ${pushModalAction === 'override' ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}
                >
                  Wyślij ({pushModalSelection.size})
                </button>
              </div>
              {pushModalSelection.size === 0 && (
                <p className="text-xs text-red-400 text-center mt-3">Zaznacz przynajmniej jeden cennik.</p>
              )}
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

      {/* Rate Plan Matrix Modal — per-unit rate plan selection */}
      {showRatePlanMatrix && (
        <RatePlanMatrixModal
          units={filteredUnits}
          ratePlans={ratePlans}
          unitAvailablePlans={unitAvailablePlans}
          unitRatePlan={unitRatePlan}
          defaultRatePlanId={defaultRatePlanId}
          onSelect={handleUnitRatePlanChange}
          onBulkSelect={handleBulkRatePlanChange}
          onClose={() => setShowRatePlanMatrix(false)}
        />
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
            <button
              onClick={handleSaveGapOverrides}
              className="w-full mt-3 bg-purple-700 hover:bg-purple-600 text-white font-semibold py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2"
              title="Zapisz zaznaczone wartości jako trwały override ochrony luk (przeżywa przeliczenie)"
            >
              <Shield size={16} /> Zapisz jako override ochrony luk
            </button>
          </div>
        </div>
      )}

      {/* Gap Protection settings (per property) */}
      {showGapConfig && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl p-5">
            <h2 className="text-xl font-bold text-teal-400 mb-1 flex items-center gap-2">
              <Shield size={20} /> Ustawienia ochrony luk
            </h2>
            <p className="text-xs text-slate-400 mb-2">Dla tego obiektu{property ? `: ${property.name}` : ''}. Po zapisie możesz od razu przeliczyć.</p>
            <p className="text-[11px] text-teal-300/80 bg-teal-900/20 border border-teal-800/40 rounded px-2 py-1.5 mb-4">
              ℹ️ Standardowy Min LOS jest brany z <b>cennika</b> (wartość MIN w kalendarzu dla wybranego cennika). Steruj nim, edytując MIN w kalendarzu — nie ma tu osobnego pola.
            </p>

            <div className="space-y-3">
              {([
                ['min_acceptable_gap', 'Minimalna akceptowalna luka (nocy)', 'Najmniejsza pusta reszta, jaką wolno zostawić po rezerwacji'],
                ['emergency_acceptable_gap', 'Awaryjna minimalna luka (nocy)', 'Mniejsza luka dopuszczalna w trybie last-minute/awaryjnym'],
                ['max_los', 'Max LOS (nocy, puste = brak)', 'Górny limit długości pobytu'],
                ['last_minute_lead_days', 'Last-minute: lead time (dni)', 'Jeśli do przyjazdu ≤ tylu dni → tryb awaryjny'],
                ['horizon_days', 'Horyzont (dni)', 'Jak daleko w przód liczyć luki'],
              ] as [keyof GapConfigValues, string, string][]).map(([key, label, hint]) => (
                <div key={key as string}>
                  <label className="block text-xs font-semibold text-slate-200">{label}</label>
                  <input
                    type="number"
                    min={key === 'max_los' ? 1 : 0}
                    value={gapConfigDraft[key] === null || gapConfigDraft[key] === undefined ? '' : String(gapConfigDraft[key])}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const val = raw === '' ? (key === 'max_los' ? null : 0) : parseInt(raw, 10);
                      setGapConfigDraft(prev => ({ ...prev, [key]: val as any }));
                    }}
                    className="w-full mt-0.5 px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>
                </div>
              ))}

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input type="checkbox" className="w-4 h-4 accent-teal-600"
                  checked={gapConfigDraft.allow_shorten_min_los}
                  onChange={(e) => setGapConfigDraft(prev => ({ ...prev, allow_shorten_min_los: e.target.checked }))} />
                <span className="text-xs text-slate-200">Pozwól obniżyć Min LOS, by wypełnić krótką lukę (awaryjnie)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-teal-600"
                  checked={gapConfigDraft.emergency_mode}
                  onChange={(e) => setGapConfigDraft(prev => ({ ...prev, emergency_mode: e.target.checked }))} />
                <span className="text-xs text-slate-200">Tryb awaryjny zawsze włączony (używa awaryjnej luki)</span>
              </label>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowGapConfig(false)} disabled={savingGapConfig}
                className="flex-1 bg-slate-600 hover:bg-slate-700 text-white font-semibold py-2.5 px-4 rounded-lg transition">
                Anuluj
              </button>
              <button onClick={handleSaveGapConfig} disabled={savingGapConfig}
                className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2">
                {savingGapConfig ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Zapisz
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compare DB ↔ Hotres Modal */}
      {showCompareModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-white font-bold text-lg">🔍 Różnice DB ↔ Hotres</h2>
                <p className="text-slate-400 text-sm mt-0.5">
                  Znaleziono <span className="text-yellow-400 font-bold">{compareDiff.length}</span> różnic —
                  <span className="text-yellow-400"> żółty</span> = tylko w DB &nbsp;|&nbsp;
                  <span className="text-green-400"> zielony</span> = Hotres (aktualny)
                </p>
              </div>
              <button onClick={() => setShowCompareModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="overflow-auto flex-1 p-4">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-800 text-slate-300 text-left">
                    <th className="p-2 border border-slate-700 whitespace-nowrap">Jednostka</th>
                    <th className="p-2 border border-slate-700">Data</th>
                    <th className="p-2 border border-slate-700 text-center">CTA DB</th>
                    <th className="p-2 border border-slate-700 text-center">CTA Hotres</th>
                    <th className="p-2 border border-slate-700 text-center">CTD DB</th>
                    <th className="p-2 border border-slate-700 text-center">CTD Hotres</th>
                    <th className="p-2 border border-slate-700 text-center">MIN DB</th>
                    <th className="p-2 border border-slate-700 text-center">MIN Hotres</th>
                  </tr>
                </thead>
                <tbody>
                  {compareDiff.map((row, i) => (
                    <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/40">
                      <td className="p-2 border border-slate-700 text-white font-medium">{row.unitName}</td>
                      <td className="p-2 border border-slate-700 text-slate-300">{row.date}</td>
                      <td className={`p-2 border border-slate-700 text-center font-bold ${row.dbCta !== row.hotresCta ? 'bg-yellow-900/40 text-yellow-300' : 'text-slate-400'}`}>
                        {row.dbCta ?? '–'}
                      </td>
                      <td className={`p-2 border border-slate-700 text-center font-bold ${row.dbCta !== row.hotresCta ? 'bg-green-900/40 text-green-300' : 'text-slate-400'}`}>
                        {row.hotresCta ?? '–'}
                      </td>
                      <td className={`p-2 border border-slate-700 text-center font-bold ${row.dbCtd !== row.hotresCtd ? 'bg-yellow-900/40 text-yellow-300' : 'text-slate-400'}`}>
                        {row.dbCtd ?? '–'}
                      </td>
                      <td className={`p-2 border border-slate-700 text-center font-bold ${row.dbCtd !== row.hotresCtd ? 'bg-green-900/40 text-green-300' : 'text-slate-400'}`}>
                        {row.hotresCtd ?? '–'}
                      </td>
                      <td className={`p-2 border border-slate-700 text-center font-bold ${row.dbMin !== row.hotresMin ? 'bg-yellow-900/40 text-yellow-300' : 'text-slate-400'}`}>
                        {row.dbMin ?? '–'}
                      </td>
                      <td className={`p-2 border border-slate-700 text-center font-bold ${row.dbMin !== row.hotresMin ? 'bg-green-900/40 text-green-300' : 'text-slate-400'}`}>
                        {row.hotresMin ?? '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-slate-700 flex gap-3 flex-shrink-0">
              <button
                onClick={() => { setShowCompareModal(false); setCompareDiff([]); setCompareSnapshotRef(new Map()); }}
                className="flex-1 bg-green-700 hover:bg-green-600 text-white font-semibold py-2.5 px-4 rounded-lg transition"
              >
                ✓ Hotres ma rację — zachowaj aktualny stan
              </button>
              <button
                onClick={handleRestoreFromSnapshot}
                disabled={syncing}
                className="flex-1 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-lg transition"
              >
                ↩ Przywróć DB do Hotresa ({compareDiff.length} rekordów)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
