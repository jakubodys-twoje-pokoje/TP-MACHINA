/**
 * Faza zapisu: odpowiedzi Hotres → znormalizowane modele Prismy.
 *
 * Każdy importer:
 *  - upsertuje rekordy po (propertyId, hotresId), więc powtórny eksport aktualizuje,
 *  - kasuje sieroty (rzeczy usunięte w Hotres) - ale tylko gdy lista pobrała się
 *    bez twardego błędu, żeby chwilowa awaria API nie wyczyściła dobrych danych,
 *  - raportuje pola, których schemat nie zna (tabela UnmappedField).
 */

import type { PrismaClient } from '@prisma/client';
import { bool, csv, date, float, int, sample, str, toArray, unknownKeys } from './coerce.js';
import { pickDetail, pickLang, type FetchedGroup } from './fetchAll.js';

export interface ImportContext {
  prisma: PrismaClient;
  propertyId: number;
  langs: string[];
  /** Zbiera pola nieznane schematowi: grupa → pole → próbka. */
  unmapped: Map<string, Map<string, string | null>>;
}

export interface ImportOutcome {
  written: number;
  removed: number;
}

const EMPTY: ImportOutcome = { written: 0, removed: 0 };

function noteUnknown(ctx: ImportContext, group: string, payload: any, known: Set<string>): void {
  const extras = unknownKeys(payload, known);
  if (extras.length === 0) return;
  const bucket = ctx.unmapped.get(group) ?? new Map<string, string | null>();
  for (const field of extras) {
    if (!bucket.has(field)) bucket.set(field, sample(payload[field]));
  }
  ctx.unmapped.set(group, bucket);
}

/** Kasuje dzieci, których nie ma już w payloadzie (np. zdjęcie usunięte z galerii). */
async function pruneChildren(
  model: { deleteMany: (args: any) => Promise<{ count: number }> },
  where: Record<string, unknown>,
  field: string,
  keep: string[],
): Promise<number> {
  const { count } = await model.deleteMany({
    where: { ...where, NOT: { [field]: { in: keep } } },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Obiekt
// ---------------------------------------------------------------------------

const OBJECT_KEYS = new Set([
  'oid', 'identifier', 'contract_date', 'category_id', 'currency', 'lang', 'logo', 'type',
  'google_x', 'google_y', 'child_1', 'child_2', 'child_3', 'address', 'city', 'zip',
  'phone', 'phone_prefix', 'phone2', 'phone2_prefix', 'email', 'www',
  'company_name', 'company_nip', 'company_address', 'company_city', 'company_zip',
  'photo', 'photo_s', 'photos', 'arrival_hour', 'departure_hour', 'today_arrival_hour',
  'vat_tax', 'vat_invoice', 'add_date', 'description', 'terms', 'active', 'test', 'places',
  // Poświadczenia - świadomie NIE zapisujemy ich w bazie.
  'auth', 'apikey',
]);

export async function importObject(ctx: ImportContext, group: FetchedGroup): Promise<ImportOutcome> {
  const canonical = pickLang(group, ctx.langs[0]);
  if (!canonical || typeof canonical !== 'object') return EMPTY;

  noteUnknown(ctx, 'object', canonical, OBJECT_KEYS);

  const data = {
    identifier: str(canonical.identifier),
    categoryId: str(canonical.category_id),
    type: str(canonical.type),
    currency: str(canonical.currency),
    defaultLang: str(canonical.lang),
    contractDate: date(canonical.contract_date),
    logo: str(canonical.logo),
    photo: str(canonical.photo),
    photoS: str(canonical.photo_s),
    googleX: float(canonical.google_x),
    googleY: float(canonical.google_y),
    child1: bool(canonical.child_1),
    child2: bool(canonical.child_2),
    child3: bool(canonical.child_3),
    address: str(canonical.address),
    city: str(canonical.city),
    zip: str(canonical.zip),
    phone: str(canonical.phone),
    phonePrefix: str(canonical.phone_prefix),
    phone2: str(canonical.phone2),
    phone2Prefix: str(canonical.phone2_prefix),
    email: str(canonical.email),
    www: str(canonical.www),
    companyName: str(canonical.company_name),
    companyNip: str(canonical.company_nip),
    companyAddress: str(canonical.company_address),
    companyCity: str(canonical.company_city),
    companyZip: str(canonical.company_zip),
    arrivalHour: str(canonical.arrival_hour),
    departureHour: str(canonical.departure_hour),
    todayArrivalHour: str(canonical.today_arrival_hour),
    vatTax: str(canonical.vat_tax),
    vatInvoice: bool(canonical.vat_invoice),
    active: bool(canonical.active),
    test: bool(canonical.test),
    places: bool(canonical.places),
    hotresAddDate: date(canonical.add_date),
  };

  await ctx.prisma.property.update({ where: { id: ctx.propertyId }, data });

  for (const lang of ctx.langs) {
    const payload = group.byLang[lang];
    if (!payload) continue;
    const translation = { description: str(payload.description), terms: str(payload.terms) };
    await ctx.prisma.propertyTranslation.upsert({
      where: { propertyId_lang: { propertyId: ctx.propertyId, lang } },
      create: { propertyId: ctx.propertyId, lang, ...translation },
      update: translation,
    });
  }

  const photos = toArray(canonical.photos);
  let position = 0;
  for (const photo of photos) {
    const src = str(photo?.src);
    if (!src) continue;
    const data = { url: str(photo?.url), position: position++ };
    await ctx.prisma.propertyPhoto.upsert({
      where: { propertyId_src: { propertyId: ctx.propertyId, src } },
      create: { propertyId: ctx.propertyId, src, ...data },
      update: data,
    });
  }

  const removed = await pruneChildren(
    ctx.prisma.propertyPhoto,
    { propertyId: ctx.propertyId },
    'src',
    photos.map(photo => str(photo?.src)).filter((src): src is string => Boolean(src)),
  );

  return { written: 1, removed };
}

// ---------------------------------------------------------------------------
// Parametry i słowniki
// ---------------------------------------------------------------------------

export async function importParams(ctx: ImportContext, group: FetchedGroup): Promise<ImportOutcome> {
  const payload = group.byLang._;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return EMPTY;

  const keys = Object.keys(payload);
  for (const key of keys) {
    const value = payload[key] === null ? null : String(payload[key]);
    await ctx.prisma.param.upsert({
      where: { propertyId_key: { propertyId: ctx.propertyId, key } },
      create: { propertyId: ctx.propertyId, key, value },
      update: { value },
    });
  }

  const removed = group.ok
    ? await pruneChildren(ctx.prisma.param, { propertyId: ctx.propertyId }, 'key', keys)
    : 0;

  return { written: keys.length, removed };
}

const FACILITY_KEYS = new Set(['id', 'code', 'icon']);

export async function importDefinitions(
  ctx: ImportContext,
  group: FetchedGroup,
): Promise<ImportOutcome> {
  const payload = group.byLang._;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return EMPTY;

  // Poza `facilities` Hotres potrafi dorzucić kolejne słowniki - schemat ich
  // nie zna, więc zamiast je zgubić, raportujemy je jako nieznane.
  noteUnknown(ctx, 'definitions', payload, new Set(['facilities']));

  const facilities = toArray(payload.facilities);
  const ids: string[] = [];

  for (const facility of facilities) {
    const hotresId = str(facility?.id);
    if (!hotresId) continue;
    noteUnknown(ctx, 'definitions.facilities', facility, FACILITY_KEYS);
    ids.push(hotresId);
    const data = { code: str(facility.code), icon: str(facility.icon) };
    await ctx.prisma.facility.upsert({
      where: { propertyId_hotresId: { propertyId: ctx.propertyId, hotresId } },
      create: { propertyId: ctx.propertyId, hotresId, ...data },
      update: data,
    });
  }

  const removed = group.ok
    ? await pruneChildren(ctx.prisma.facility, { propertyId: ctx.propertyId }, 'hotresId', ids)
    : 0;

  return { written: ids.length, removed };
}

// ---------------------------------------------------------------------------
// Standardy
// ---------------------------------------------------------------------------

const ROOMTYPE_KEYS = new Set([
  'type_id', 'oid', 'title', 'advert', 'single', 'double', 'sofa', 'bunk_bed', 'extra_bed',
  'max_persons', 'max_adults', 'area', 'bedroom_cnt', 'bathroom_cnt', 'rooms_cnt', 'facilities',
  'price_from', 'floor', 'address', 'city', 'zip', 'google_x', 'google_y', 'yt_url',
  'photo', 'photo_s', 'photos', 'category', 'tags', 'niceurl', 'extrainfo', 'promo',
  'description', 'instructions', 'meta_title', 'meta_description',
]);

export async function importRoomTypes(
  ctx: ImportContext,
  group: FetchedGroup,
): Promise<ImportOutcome> {
  const canonicalLang = ctx.langs[0];
  const list = toArray(pickLang(group, canonicalLang));
  const ids: string[] = [];
  let removed = 0;

  for (const item of list) {
    const hotresId = str(item?.type_id);
    if (!hotresId) continue;
    ids.push(hotresId);

    const detail = pickDetail(group, canonicalLang, hotresId) ?? {};
    const merged = { ...item, ...detail };
    noteUnknown(ctx, 'roomstypes', merged, ROOMTYPE_KEYS);

    const data = {
      single: int(merged.single),
      double: int(merged.double),
      sofa: int(merged.sofa),
      bunkBed: int(merged.bunk_bed),
      extraBed: int(merged.extra_bed),
      maxAdults: int(merged.max_adults ?? merged.max_persons),
      area: float(merged.area),
      bedroomCnt: int(merged.bedroom_cnt),
      bathroomCnt: int(merged.bathroom_cnt),
      roomsCnt: int(merged.rooms_cnt),
      floor: int(merged.floor),
      priceFrom: float(merged.price_from),
      category: str(merged.category),
      tags: str(merged.tags),
      address: str(merged.address),
      city: str(merged.city),
      zip: str(merged.zip),
      googleX: float(merged.google_x),
      googleY: float(merged.google_y),
      ytUrl: str(merged.yt_url),
      photo: str(merged.photo),
      photoS: str(merged.photo_s),
    };

    const roomType = await ctx.prisma.roomType.upsert({
      where: { propertyId_hotresId: { propertyId: ctx.propertyId, hotresId } },
      create: { propertyId: ctx.propertyId, hotresId, ...data },
      update: data,
    });

    for (const lang of ctx.langs) {
      const listItem = toArray(group.byLang[lang]).find(
        (entry: any) => str(entry?.type_id) === hotresId,
      );
      const langDetail = group.details[lang]?.[hotresId];
      if (!listItem && !langDetail) continue;
      const source = { ...(listItem ?? {}), ...(langDetail ?? {}) };

      const translation = {
        title: str(source.title),
        advert: str(source.advert),
        description: str(source.description),
        instructions: str(source.instructions),
        extrainfo: str(source.extrainfo),
        promo: str(source.promo),
        niceurl: str(source.niceurl),
        metaTitle: str(source.meta_title),
        metaDescription: str(source.meta_description),
      };

      await ctx.prisma.roomTypeTranslation.upsert({
        where: { roomTypeId_lang: { roomTypeId: roomType.id, lang } },
        create: { roomTypeId: roomType.id, lang, ...translation },
        update: translation,
      });
    }

    const photos = toArray(merged.photos);
    let position = 0;
    for (const photo of photos) {
      const src = str(photo?.src);
      if (!src) continue;
      const photoData = { url: str(photo?.url), position: position++ };
      await ctx.prisma.roomTypePhoto.upsert({
        where: { roomTypeId_src: { roomTypeId: roomType.id, src } },
        create: { roomTypeId: roomType.id, src, ...photoData },
        update: photoData,
      });
    }
    removed += await pruneChildren(
      ctx.prisma.roomTypePhoto,
      { roomTypeId: roomType.id },
      'src',
      photos.map(photo => str(photo?.src)).filter((src): src is string => Boolean(src)),
    );

    const facilityIds = csv(merged.facilities);
    for (const facilityId of facilityIds) {
      await ctx.prisma.roomTypeFacility.upsert({
        where: { roomTypeId_facilityId: { roomTypeId: roomType.id, facilityId } },
        create: { roomTypeId: roomType.id, facilityId },
        update: {},
      });
    }
    removed += await pruneChildren(
      ctx.prisma.roomTypeFacility,
      { roomTypeId: roomType.id },
      'facilityId',
      facilityIds,
    );
  }

  if (group.ok) {
    removed += await pruneChildren(
      ctx.prisma.roomType,
      { propertyId: ctx.propertyId },
      'hotresId',
      ids,
    );
  }

  return { written: ids.length, removed };
}

// ---------------------------------------------------------------------------
// Pokoje
// ---------------------------------------------------------------------------

const ROOM_KEYS = new Set([
  'room_id', 'type_id', 'oid', 'code', 'single', 'double', 'sofa', 'bunk_bed', 'extra_bed',
  'state', 'custom1', 'custom2', 'custom3', 'priority', 'priority_alloc',
]);

export async function importRooms(ctx: ImportContext, group: FetchedGroup): Promise<ImportOutcome> {
  const list = toArray(group.byLang._);
  const ids: string[] = [];

  for (const item of list) {
    const hotresId = str(item?.room_id);
    if (!hotresId) continue;
    ids.push(hotresId);
    noteUnknown(ctx, 'rooms', item, ROOM_KEYS);

    const typeHotresId = str(item.type_id);
    const roomType = typeHotresId
      ? await ctx.prisma.roomType.findUnique({
          where: { propertyId_hotresId: { propertyId: ctx.propertyId, hotresId: typeHotresId } },
          select: { id: true },
        })
      : null;

    const data = {
      typeHotresId,
      roomTypeId: roomType?.id ?? null,
      code: str(item.code),
      single: int(item.single),
      double: int(item.double),
      sofa: int(item.sofa),
      bunkBed: int(item.bunk_bed),
      extraBed: int(item.extra_bed),
      state: str(item.state),
      priority: int(item.priority),
      priorityAlloc: int(item.priority_alloc),
      custom1: str(item.custom1),
      custom2: str(item.custom2),
      custom3: str(item.custom3),
    };

    await ctx.prisma.room.upsert({
      where: { propertyId_hotresId: { propertyId: ctx.propertyId, hotresId } },
      create: { propertyId: ctx.propertyId, hotresId, ...data },
      update: data,
    });
  }

  const removed = group.ok
    ? await pruneChildren(ctx.prisma.room, { propertyId: ctx.propertyId }, 'hotresId', ids)
    : 0;

  return { written: ids.length, removed };
}

// ---------------------------------------------------------------------------
// Plany cenowe
// ---------------------------------------------------------------------------

const RATE_KEYS = new Set([
  'rate_id', 'oid', 'title', 'advert', 'currency', 'package', 'board', 'minimum_stay',
  'maximum_stay', 'photo', 'photo_s', 'photos', 'category_id', 'price', 'last_price', 'tags',
  'niceurl', 'custom_url', 'description', 'meta_title', 'meta_description',
]);

export async function importRates(ctx: ImportContext, group: FetchedGroup): Promise<ImportOutcome> {
  const canonicalLang = ctx.langs[0];
  const list = toArray(pickLang(group, canonicalLang));
  const ids: string[] = [];
  let removed = 0;

  for (const item of list) {
    const hotresId = str(item?.rate_id);
    if (!hotresId) continue;
    ids.push(hotresId);

    const detail = pickDetail(group, canonicalLang, hotresId) ?? {};
    const merged = { ...item, ...detail };
    noteUnknown(ctx, 'rates', merged, RATE_KEYS);

    const data = {
      currency: str(merged.currency),
      isPackage: bool(merged.package),
      board: str(merged.board),
      minimumStay: int(merged.minimum_stay),
      maximumStay: int(merged.maximum_stay),
      categoryId: str(merged.category_id),
      price: float(merged.price),
      lastPrice: float(merged.last_price),
      tags: str(merged.tags),
      photo: str(merged.photo),
      photoS: str(merged.photo_s),
      customUrl: str(merged.custom_url),
    };

    const ratePlan = await ctx.prisma.ratePlan.upsert({
      where: { propertyId_hotresId: { propertyId: ctx.propertyId, hotresId } },
      create: { propertyId: ctx.propertyId, hotresId, ...data },
      update: data,
    });

    for (const lang of ctx.langs) {
      const listItem = toArray(group.byLang[lang]).find(
        (entry: any) => str(entry?.rate_id) === hotresId,
      );
      const langDetail = group.details[lang]?.[hotresId];
      if (!listItem && !langDetail) continue;
      const source = { ...(listItem ?? {}), ...(langDetail ?? {}) };

      const translation = {
        title: str(source.title),
        advert: str(source.advert),
        description: str(source.description),
        niceurl: str(source.niceurl),
        metaTitle: str(source.meta_title),
        metaDescription: str(source.meta_description),
      };

      await ctx.prisma.ratePlanTranslation.upsert({
        where: { ratePlanId_lang: { ratePlanId: ratePlan.id, lang } },
        create: { ratePlanId: ratePlan.id, lang, ...translation },
        update: translation,
      });
    }

    const photos = toArray(merged.photos);
    let position = 0;
    for (const photo of photos) {
      const src = str(photo?.src);
      if (!src) continue;
      const photoData = { url: str(photo?.url), position: position++ };
      await ctx.prisma.ratePlanPhoto.upsert({
        where: { ratePlanId_src: { ratePlanId: ratePlan.id, src } },
        create: { ratePlanId: ratePlan.id, src, ...photoData },
        update: photoData,
      });
    }
    removed += await pruneChildren(
      ctx.prisma.ratePlanPhoto,
      { ratePlanId: ratePlan.id },
      'src',
      photos.map(photo => str(photo?.src)).filter((src): src is string => Boolean(src)),
    );
  }

  if (group.ok) {
    removed += await pruneChildren(
      ctx.prisma.ratePlan,
      { propertyId: ctx.propertyId },
      'hotresId',
      ids,
    );
  }

  return { written: ids.length, removed };
}

// ---------------------------------------------------------------------------
// Dodatki
// ---------------------------------------------------------------------------

const ADDON_KEYS = new Set([
  'addon_id', 'code', 'mode', 'groups_id', 'price', 'price_child1', 'price_child2',
  'price_child3', 'tax', 'stock', 'included', 'upselling', 'bookingengine', 'ondiscount',
  'visible', 'active', 'photo', 'template', 'min_nights', 'max_nights', 'date_from', 'date_to',
  'arrival_from', 'arrival_to', 'departure_from', 'departure_to', 'min_adults', 'max_adults',
  'min_advance', 'max_advance', 'exclude_from', 'exclude_to', 'rates_ids', 'rooms_types_ids',
]);

export async function importAddons(ctx: ImportContext, group: FetchedGroup): Promise<ImportOutcome> {
  const list = toArray(group.byLang._);
  const ids: string[] = [];
  let removed = 0;

  for (const item of list) {
    const hotresId = str(item?.addon_id);
    if (!hotresId) continue;
    ids.push(hotresId);
    noteUnknown(ctx, 'addons', item, ADDON_KEYS);

    const data = {
      code: str(item.code),
      mode: str(item.mode),
      groupsId: str(item.groups_id),
      template: str(item.template),
      photo: str(item.photo),
      price: float(item.price),
      priceChild1: float(item.price_child1),
      priceChild2: float(item.price_child2),
      priceChild3: float(item.price_child3),
      tax: str(item.tax),
      stock: int(item.stock),
      included: bool(item.included),
      upselling: bool(item.upselling),
      bookingengine: bool(item.bookingengine),
      ondiscount: bool(item.ondiscount),
      visible: bool(item.visible),
      active: bool(item.active),
      minNights: int(item.min_nights),
      maxNights: int(item.max_nights),
      minAdults: int(item.min_adults),
      maxAdults: int(item.max_adults),
      minAdvance: int(item.min_advance),
      maxAdvance: int(item.max_advance),
      dateFrom: date(item.date_from),
      dateTo: date(item.date_to),
      arrivalFrom: date(item.arrival_from),
      arrivalTo: date(item.arrival_to),
      departureFrom: date(item.departure_from),
      departureTo: date(item.departure_to),
      excludeFrom: date(item.exclude_from),
      excludeTo: date(item.exclude_to),
    };

    const addon = await ctx.prisma.addon.upsert({
      where: { propertyId_hotresId: { propertyId: ctx.propertyId, hotresId } },
      create: { propertyId: ctx.propertyId, hotresId, ...data },
      update: data,
    });

    const rateIds = csv(item.rates_ids);
    for (const rateHotresId of rateIds) {
      const ratePlan = await ctx.prisma.ratePlan.findUnique({
        where: { propertyId_hotresId: { propertyId: ctx.propertyId, hotresId: rateHotresId } },
        select: { id: true },
      });
      await ctx.prisma.addonRatePlan.upsert({
        where: { addonId_rateHotresId: { addonId: addon.id, rateHotresId } },
        create: { addonId: addon.id, rateHotresId, ratePlanId: ratePlan?.id ?? null },
        update: { ratePlanId: ratePlan?.id ?? null },
      });
    }
    removed += await pruneChildren(
      ctx.prisma.addonRatePlan,
      { addonId: addon.id },
      'rateHotresId',
      rateIds,
    );

    const typeIds = csv(item.rooms_types_ids);
    for (const typeHotresId of typeIds) {
      const roomType = await ctx.prisma.roomType.findUnique({
        where: { propertyId_hotresId: { propertyId: ctx.propertyId, hotresId: typeHotresId } },
        select: { id: true },
      });
      await ctx.prisma.addonRoomType.upsert({
        where: { addonId_typeHotresId: { addonId: addon.id, typeHotresId } },
        create: { addonId: addon.id, typeHotresId, roomTypeId: roomType?.id ?? null },
        update: { roomTypeId: roomType?.id ?? null },
      });
    }
    removed += await pruneChildren(
      ctx.prisma.addonRoomType,
      { addonId: addon.id },
      'typeHotresId',
      typeIds,
    );
  }

  if (group.ok) {
    removed += await pruneChildren(ctx.prisma.addon, { propertyId: ctx.propertyId }, 'hotresId', ids);
  }

  return { written: ids.length, removed };
}

// ---------------------------------------------------------------------------
// Vouchery i bilety
// ---------------------------------------------------------------------------

const VOUCHER_KEYS = new Set([
  'voucher_id', 'title', 'amount', 'currency', 'valid_days', 'priority', 'gift',
  'photo', 'photo_s', 'niceurl', 'description', 'meta_title', 'meta_description',
]);

export async function importVouchers(
  ctx: ImportContext,
  group: FetchedGroup,
): Promise<ImportOutcome> {
  const canonicalLang = ctx.langs[0];
  const list = toArray(pickLang(group, canonicalLang));
  const ids: string[] = [];

  for (const item of list) {
    const hotresId = str(item?.voucher_id);
    if (!hotresId) continue;
    ids.push(hotresId);

    const detail = pickDetail(group, canonicalLang, hotresId) ?? {};
    const merged = { ...item, ...detail };
    noteUnknown(ctx, 'vouchers', merged, VOUCHER_KEYS);

    const data = {
      amount: float(merged.amount),
      currency: str(merged.currency),
      validDays: int(merged.valid_days),
      priority: int(merged.priority),
      gift: bool(merged.gift),
      photo: str(merged.photo),
      photoS: str(merged.photo_s),
    };

    const voucher = await ctx.prisma.voucher.upsert({
      where: { propertyId_hotresId: { propertyId: ctx.propertyId, hotresId } },
      create: { propertyId: ctx.propertyId, hotresId, ...data },
      update: data,
    });

    for (const lang of ctx.langs) {
      const listItem = toArray(group.byLang[lang]).find(
        (entry: any) => str(entry?.voucher_id) === hotresId,
      );
      const langDetail = group.details[lang]?.[hotresId];
      if (!listItem && !langDetail) continue;
      const source = { ...(listItem ?? {}), ...(langDetail ?? {}) };

      const translation = {
        title: str(source.title),
        description: str(source.description),
        niceurl: str(source.niceurl),
        metaTitle: str(source.meta_title),
        metaDescription: str(source.meta_description),
      };

      await ctx.prisma.voucherTranslation.upsert({
        where: { voucherId_lang: { voucherId: voucher.id, lang } },
        create: { voucherId: voucher.id, lang, ...translation },
        update: translation,
      });
    }
  }

  const removed = group.ok
    ? await pruneChildren(ctx.prisma.voucher, { propertyId: ctx.propertyId }, 'hotresId', ids)
    : 0;

  return { written: ids.length, removed };
}

const TICKET_KEYS = new Set([
  'ticket_id', 'title', 'price', 'currency', 'stock', 'max_cnt', 'date', 'priority',
  'photo', 'photo_s', 'description',
]);

export async function importTickets(
  ctx: ImportContext,
  group: FetchedGroup,
): Promise<ImportOutcome> {
  const canonicalLang = ctx.langs[0];
  const list = toArray(pickLang(group, canonicalLang));
  const ids: string[] = [];

  for (const item of list) {
    const hotresId = str(item?.ticket_id);
    if (!hotresId) continue;
    ids.push(hotresId);

    const detail = pickDetail(group, canonicalLang, hotresId) ?? {};
    const merged = { ...item, ...detail };
    noteUnknown(ctx, 'tickets', merged, TICKET_KEYS);

    const data = {
      price: float(merged.price),
      currency: str(merged.currency),
      stock: int(merged.stock),
      maxCnt: int(merged.max_cnt),
      date: date(merged.date),
      priority: int(merged.priority),
      photo: str(merged.photo),
      photoS: str(merged.photo_s),
    };

    const ticket = await ctx.prisma.ticket.upsert({
      where: { propertyId_hotresId: { propertyId: ctx.propertyId, hotresId } },
      create: { propertyId: ctx.propertyId, hotresId, ...data },
      update: data,
    });

    for (const lang of ctx.langs) {
      const listItem = toArray(group.byLang[lang]).find(
        (entry: any) => str(entry?.ticket_id) === hotresId,
      );
      const langDetail = group.details[lang]?.[hotresId];
      if (!listItem && !langDetail) continue;
      const source = { ...(listItem ?? {}), ...(langDetail ?? {}) };

      const translation = {
        title: str(source.title),
        description: str(source.description),
      };

      await ctx.prisma.ticketTranslation.upsert({
        where: { ticketId_lang: { ticketId: ticket.id, lang } },
        create: { ticketId: ticket.id, lang, ...translation },
        update: translation,
      });
    }
  }

  const removed = group.ok
    ? await pruneChildren(ctx.prisma.ticket, { propertyId: ctx.propertyId }, 'hotresId', ids)
    : 0;

  return { written: ids.length, removed };
}

// ---------------------------------------------------------------------------
// Treści i konta
// ---------------------------------------------------------------------------

const REVIEW_KEYS = new Set(['add_date', 'source', 'author', 'rate', 'description', 'lang']);

export async function importReviews(
  ctx: ImportContext,
  group: FetchedGroup,
): Promise<ImportOutcome> {
  const list = toArray(group.byLang._);
  let written = 0;

  for (const item of list) {
    noteUnknown(ctx, 'reviews', item, REVIEW_KEYS);

    // Opinie nie mają identyfikatora - tożsamość składamy z surowej daty,
    // autora i źródła (puste stringi zamiast null, patrz komentarz w schemacie).
    const addDateRaw = str(item?.add_date) ?? '';
    const author = str(item?.author) ?? '';
    const source = str(item?.source) ?? '';
    if (!addDateRaw && !author) continue;

    const data = {
      addDate: date(item?.add_date),
      rate: float(item?.rate),
      description: str(item?.description),
      lang: str(item?.lang),
    };

    await ctx.prisma.review.upsert({
      where: {
        propertyId_addDateRaw_author_source: {
          propertyId: ctx.propertyId,
          addDateRaw,
          author,
          source,
        },
      },
      create: { propertyId: ctx.propertyId, addDateRaw, author, source, ...data },
      update: data,
    });
    written++;
  }

  return { written, removed: 0 };
}

const INFORMATOR_KEYS = new Set([
  'add_date', 'title', 'advert', 'template', 'width', 'description', 'icon', 'photo',
]);

export async function importInformator(
  ctx: ImportContext,
  group: FetchedGroup,
): Promise<ImportOutcome> {
  let written = 0;
  const keptByLang = new Map<string, string[]>();

  for (const lang of ctx.langs) {
    const list = toArray(group.byLang[lang]);
    const titles: string[] = [];

    for (const item of list) {
      noteUnknown(ctx, 'informator', item, INFORMATOR_KEYS);
      const title = str(item?.title);
      if (!title) continue;
      titles.push(title);

      const data = {
        advert: str(item.advert),
        template: str(item.template),
        width: str(item.width),
        description: str(item.description),
        icon: str(item.icon),
        photo: str(item.photo),
        addDate: date(item.add_date),
      };

      await ctx.prisma.informatorItem.upsert({
        where: {
          propertyId_lang_title: { propertyId: ctx.propertyId, lang, title },
        },
        create: { propertyId: ctx.propertyId, lang, title, ...data },
        update: data,
      });
      written++;
    }

    keptByLang.set(lang, titles);
  }

  let removed = 0;
  if (group.ok) {
    for (const [lang, titles] of keptByLang) {
      removed += await pruneChildren(
        ctx.prisma.informatorItem,
        { propertyId: ctx.propertyId, lang },
        'title',
        titles,
      );
    }
  }

  return { written, removed };
}

const USER_KEYS = new Set(['uid', 'name', 'email', 'login_count', 'login_date', 'active', 'add_date']);

export async function importUsers(ctx: ImportContext, group: FetchedGroup): Promise<ImportOutcome> {
  const list = toArray(group.byLang._);
  const ids: string[] = [];

  for (const item of list) {
    const uid = str(item?.uid);
    if (!uid) continue;
    ids.push(uid);
    noteUnknown(ctx, 'users', item, USER_KEYS);

    const data = {
      name: str(item.name),
      email: str(item.email),
      loginCount: int(item.login_count),
      loginDate: date(item.login_date),
      active: bool(item.active),
      addDate: date(item.add_date),
    };

    await ctx.prisma.propertyUser.upsert({
      where: { propertyId_uid: { propertyId: ctx.propertyId, uid } },
      create: { propertyId: ctx.propertyId, uid, ...data },
      update: data,
    });
  }

  const removed = group.ok
    ? await pruneChildren(ctx.prisma.propertyUser, { propertyId: ctx.propertyId }, 'uid', ids)
    : 0;

  return { written: ids.length, removed };
}

// ---------------------------------------------------------------------------

export const IMPORTERS: Record<
  string,
  (ctx: ImportContext, group: FetchedGroup) => Promise<ImportOutcome>
> = {
  object: importObject,
  params: importParams,
  definitions: importDefinitions,
  roomstypes: importRoomTypes,
  rooms: importRooms,
  rates: importRates,
  addons: importAddons,
  vouchers: importVouchers,
  tickets: importTickets,
  reviews: importReviews,
  informator: importInformator,
  users: importUsers,
};
