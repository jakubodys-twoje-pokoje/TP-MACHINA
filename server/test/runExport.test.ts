import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runExport } from '../src/runExport.js';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// atrapa Hotresa
// ---------------------------------------------------------------------------

type Responder = Record<string, any | ((params: URLSearchParams) => any)>;

function fakeHotres(responses: Responder) {
  const calls: { action: string; params: URLSearchParams }[] = [];

  const fetchImpl = (async (input: any) => {
    const url = new URL(String(input));
    const action = url.pathname.replace(/^\//, '');
    calls.push({ action, params: url.searchParams });

    const responder = responses[action];
    if (responder === undefined) {
      return { ok: false, status: 404, text: async () => 'not found' } as Response;
    }

    const payload = typeof responder === 'function' ? responder(url.searchParams) : responder;
    if (payload instanceof Error) {
      return { ok: false, status: 500, text: async () => payload.message } as Response;
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) } as Response;
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

const CREDENTIALS = { user: 'test', password: 'test' };

function run(oid: string, responses: Responder, overrides: Record<string, any> = {}) {
  const { fetchImpl, calls } = fakeHotres(responses);
  return runExport({
    prisma,
    oid,
    langs: ['pl'],
    delayMs: 0,
    credentials: CREDENTIALS,
    fetchImpl,
    ...overrides,
  }).then(summary => ({ summary, calls }));
}

// ---------------------------------------------------------------------------
// dane odwzorowane na próbkach z dokumentacji Hotres
// ---------------------------------------------------------------------------

const FIXTURES: Responder = {
  api_object: {
    oid: '474',
    auth: 'sekret',
    apikey: 'sekret',
    identifier: 'demo',
    currency: 'PLN',
    lang: 'pl',
    google_x: '51.49129308093768',
    google_y: '15.26707047053128',
    child_1: '1',
    child_2: '0',
    address: 'Wolności',
    city: 'Zakopane',
    zip: '58-560',
    phone: '512275961',
    phone_prefix: '48',
    email: 'admin@hotres.pl',
    company_name: 'LEMONPIXEL.pl',
    company_nip: '611-227-24-34',
    arrival_hour: '14:00',
    departure_hour: '10:00',
    vat_tax: '23',
    vat_invoice: '1',
    add_date: '2015-08-18 22:54:08',
    description: '<p>ładny obiekt…</p>',
    terms: 'regulamin',
    active: '1',
    test: '1',
    photos: [
      { src: '/474/foto-1.jpg', url: 'https://img.hotres.pl/474/foto-1.jpg' },
      { src: '/474/foto-2.jpg', url: 'https://img.hotres.pl/474/foto-2.jpg' },
    ],
  },
  api_params: { be_currency: 'PLN', be_max_adults: '2', be_checkin: '1' },
  api_definitions: {
    facilities: [
      { id: '1', code: 'WiFi', icon: 'https://panel.hotres.pl/1.svg' },
      { id: '22', code: 'Balkon', icon: 'https://panel.hotres.pl/22.svg' },
    ],
  },
  api_roomstypes: [
    {
      type_id: '29411',
      oid: '474',
      title: 'Pokój dwuosobowy',
      advert: '',
      single: '2',
      double: '1',
      sofa: '0',
      area: '25',
      bedroom_cnt: '1',
      bathroom_cnt: '1',
      rooms_cnt: '2',
      facilities: '22,1',
      price_from: '190',
      floor: '3',
      category: 'room',
      niceurl: 'pokoj-dwuosobowy',
    },
    {
      type_id: '29412',
      oid: '474',
      title: 'JEDYNKA',
      single: '1',
      double: '0',
      area: '15',
      facilities: '22',
      category: 'room',
    },
  ],
  api_roomtype: (params: URLSearchParams) => ({
    type_id: params.get('type_id'),
    title: params.get('type_id') === '29411' ? 'Pokój dwuosobowy' : 'JEDYNKA',
    description: '<p>opis pokoju</p>',
    instructions: 'instrukcja wejścia',
    meta_title: 'meta',
    meta_description: 'meta opis',
    yt_url: 'https://youtu.be/xyz',
    photos:
      params.get('type_id') === '29411'
        ? [{ src: '/474/pokoj-1.png', url: 'https://img/pokoj-1.png' }]
        : [],
  }),
  api_rooms: [
    {
      room_id: '35776',
      type_id: '29411',
      oid: '474',
      code: '303',
      single: '1',
      double: '0',
      state: 'dirty',
      custom1: 'ParkingXYZ',
      priority: '1',
      priority_alloc: '0',
    },
    { room_id: '6259', type_id: '99999', oid: '474', code: 'SkyRoom', single: '3', double: '1' },
  ],
  api_rates: [
    {
      rate_id: '22784',
      oid: '474',
      title: 'Standard ze śniadaniem',
      currency: null,
      package: '0',
      board: 'BB',
      minimum_stay: '1',
      maximum_stay: '30',
      category_id: '0',
      price: '0',
      last_price: '0',
      niceurl: 'standard',
    },
  ],
  api_rate: () => ({
    rate_id: '22784',
    title: 'Standard ze śniadaniem',
    description: '<p>opis cennika</p>',
    photos: [{ src: '/474/cennik-1.jpg', url: 'https://img/cennik-1.jpg' }],
  }),
  api_addons: [
    {
      addon_id: '2',
      code: 'wino',
      mode: 'once',
      groups_id: '4',
      price: '179',
      tax: '23',
      stock: '100',
      included: '0',
      upselling: '1',
      visible: '1',
      active: '1',
      template: 'full',
      date_from: '2025-12-04',
      date_to: '2025-12-20',
      rates_ids: ['22784'],
      rooms_types_ids: ['29411', '77777'],
    },
  ],
  api_vouchers: [
    {
      voucher_id: '145',
      title: 'Voucher nr 1',
      amount: 200,
      currency: 'EUR',
      valid_days: 60,
      priority: '1',
      gift: '0',
      niceurl: 'voucher-nr-1',
    },
  ],
  api_voucher: () => ({
    voucher_id: '145',
    title: 'Voucher nr 1',
    description: '<p>opis vouchera</p>',
    photo_s: '/474/voucher.jpg',
  }),
  api_tickets: [
    {
      ticket_id: '269',
      title: 'Wycieczka do Pragi',
      price: 1250,
      currency: 'PLN',
      stock: 100,
      date: '2020-01-25 17:00:00',
      priority: '1',
    },
  ],
  api_ticket: () => ({ ticket_id: '269', title: 'Wycieczka do Pragi', max_cnt: 2, description: '' }),
  api_reviews: [
    { add_date: '2024-02-18 22:18:02', source: 'booking', author: 'Joanna', rate: '10', description: ' ', lang: 'pl' },
    { add_date: '2024-02-16 21:45:23', source: 'airbnb', author: 'Jacob', rate: '9.5', description: 'Super', lang: 'pl' },
  ],
  api_informator: [
    { add_date: '2023-03-23 12:59:28', title: 'Wifi', advert: '', template: 'default', width: '25' },
    { add_date: '2023-03-21 14:47:52', title: 'Karpacz', advert: 'Obok Śnieżki', template: 'popup', width: '50' },
  ],
  api_users: [
    { uid: '2773', name: 'demo@bte.pl', email: 'demo@bte.pl', login_count: '52', login_date: '2022-08-27 01:38:00', active: '1', add_date: '2020-10-29 12:28:04' },
  ],
};

// ---------------------------------------------------------------------------

describe('runExport - pełna normalizacja', () => {
  it('rozkłada odpowiedzi Hotresa na typowane tabele', async () => {
    const { summary } = await run('T-1', FIXTURES);

    expect(summary.status).toBe('ok');
    expect(summary.errors).toHaveLength(0);

    const property = await prisma.property.findUniqueOrThrow({
      where: { oid: 'T-1' },
      include: { translations: true, photos: true, params: true, facilities: true },
    });

    expect(property.city).toBe('Zakopane');
    expect(property.googleX).toBeCloseTo(51.4912, 3);
    expect(property.child1).toBe(true);
    expect(property.child2).toBe(false);
    expect(property.vatInvoice).toBe(true);
    expect(property.hotresAddDate?.toISOString()).toBe('2015-08-18T22:54:08.000Z');
    expect(property.translations[0].description).toContain('ładny obiekt');
    expect(property.photos).toHaveLength(2);
    expect(property.params).toHaveLength(3);
    expect(property.facilities.map(f => f.code).sort()).toEqual(['Balkon', 'WiFi']);
  });

  it('nie zapisuje poświadczeń z api_object', async () => {
    await run('T-2', FIXTURES);
    const columns = Object.keys(await prisma.property.findUniqueOrThrow({ where: { oid: 'T-2' } }));

    expect(columns).not.toContain('auth');
    expect(columns).not.toContain('apikey');
  });

  it('scala listę ze szczegółami i rozbija tłumaczenia, zdjęcia i udogodnienia', async () => {
    await run('T-3', FIXTURES);

    const roomType = await prisma.roomType.findFirstOrThrow({
      where: { property: { oid: 'T-3' }, hotresId: '29411' },
      include: { translations: true, photos: true, facilities: true },
    });

    expect(roomType.area).toBe(25);
    expect(roomType.floor).toBe(3);
    expect(roomType.ytUrl).toBe('https://youtu.be/xyz');
    expect(roomType.translations).toHaveLength(1);
    expect(roomType.translations[0].title).toBe('Pokój dwuosobowy');
    expect(roomType.translations[0].description).toContain('opis pokoju');
    expect(roomType.translations[0].instructions).toBe('instrukcja wejścia');
    expect(roomType.photos).toHaveLength(1);
    expect(roomType.facilities.map(f => f.facilityId).sort()).toEqual(['1', '22']);
  });

  it('dowiązuje pokój do standardu, a nieistniejący standard zostawia jako sam identyfikator', async () => {
    await run('T-4', FIXTURES);

    const linked = await prisma.room.findFirstOrThrow({
      where: { property: { oid: 'T-4' }, hotresId: '35776' },
      include: { roomType: true },
    });
    expect(linked.roomType?.hotresId).toBe('29411');
    expect(linked.custom1).toBe('ParkingXYZ');

    const orphan = await prisma.room.findFirstOrThrow({
      where: { property: { oid: 'T-4' }, hotresId: '6259' },
    });
    expect(orphan.roomTypeId).toBeNull();
    expect(orphan.typeHotresId).toBe('99999');
  });

  it('rozbija rates_ids i rooms_types_ids dodatku na relacje', async () => {
    await run('T-5', FIXTURES);

    const addon = await prisma.addon.findFirstOrThrow({
      where: { property: { oid: 'T-5' }, hotresId: '2' },
      include: { ratePlanLinks: { include: { ratePlan: true } }, roomTypeLinks: true },
    });

    expect(addon.price).toBe(179);
    expect(addon.upselling).toBe(true);
    expect(addon.included).toBe(false);
    expect(addon.dateFrom?.toISOString()).toBe('2025-12-04T00:00:00.000Z');

    expect(addon.ratePlanLinks).toHaveLength(1);
    expect(addon.ratePlanLinks[0].ratePlan?.hotresId).toBe('22784');

    const links = addon.roomTypeLinks.sort((a, b) => a.typeHotresId.localeCompare(b.typeHotresId));
    expect(links.map(link => link.typeHotresId)).toEqual(['29411', '77777']);
    expect(links[0].roomTypeId).not.toBeNull();
    // Standard, którego nie ma w Hotresie, zostaje bez relacji - ale id nie ginie.
    expect(links[1].roomTypeId).toBeNull();
  });

  it('zapisuje vouchery, bilety, opinie, informator i użytkowników', async () => {
    await run('T-6', FIXTURES);
    const where = { property: { oid: 'T-6' } };

    const voucher = await prisma.voucher.findFirstOrThrow({ where, include: { translations: true } });
    expect(voucher.amount).toBe(200);
    expect(voucher.translations[0].description).toContain('opis vouchera');

    const ticket = await prisma.ticket.findFirstOrThrow({ where, include: { translations: true } });
    expect(ticket.maxCnt).toBe(2);
    expect(ticket.date?.toISOString()).toBe('2020-01-25T17:00:00.000Z');

    expect(await prisma.review.count({ where })).toBe(2);
    expect(await prisma.informatorItem.count({ where })).toBe(2);

    const user = await prisma.propertyUser.findFirstOrThrow({ where });
    expect(user.loginCount).toBe(52);
    expect(user.active).toBe(true);
  });

  it('drugi przebieg aktualizuje zamiast duplikować', async () => {
    await run('T-7', FIXTURES);
    const before = {
      roomTypes: await prisma.roomType.count({ where: { property: { oid: 'T-7' } } }),
      reviews: await prisma.review.count({ where: { property: { oid: 'T-7' } } }),
      params: await prisma.param.count({ where: { property: { oid: 'T-7' } } }),
      photos: await prisma.propertyPhoto.count({ where: { property: { oid: 'T-7' } } }),
    };

    await run('T-7', FIXTURES);
    const after = {
      roomTypes: await prisma.roomType.count({ where: { property: { oid: 'T-7' } } }),
      reviews: await prisma.review.count({ where: { property: { oid: 'T-7' } } }),
      params: await prisma.param.count({ where: { property: { oid: 'T-7' } } }),
      photos: await prisma.propertyPhoto.count({ where: { property: { oid: 'T-7' } } }),
    };

    expect(after).toEqual(before);
    expect(await prisma.property.count({ where: { oid: 'T-7' } })).toBe(1);
  });

  it('kasuje to, co zniknęło z Hotresa', async () => {
    await run('T-8', FIXTURES);
    expect(await prisma.roomType.count({ where: { property: { oid: 'T-8' } } })).toBe(2);

    const trimmed: Responder = {
      ...FIXTURES,
      api_roomstypes: [(FIXTURES.api_roomstypes as any[])[0]],
    };
    await run('T-8', trimmed);

    const left = await prisma.roomType.findMany({ where: { property: { oid: 'T-8' } } });
    expect(left.map(item => item.hotresId)).toEqual(['29411']);
  });

  it('NIE kasuje, gdy pobranie listy padło', async () => {
    await run('T-9', FIXTURES);
    expect(await prisma.roomType.count({ where: { property: { oid: 'T-9' } } })).toBe(2);

    const broken: Responder = { ...FIXTURES, api_roomstypes: new Error('padło') };
    const { summary } = await run('T-9', broken);

    expect(summary.status).toBe('error');
    expect(await prisma.roomType.count({ where: { property: { oid: 'T-9' } } })).toBe(2);
  });

  it('zapisuje pola, których schemat nie zna', async () => {
    const withNewField: Responder = {
      ...FIXTURES,
      api_rooms: [{ room_id: '35776', type_id: '29411', nowe_pole_hotresa: 'niespodzianka' }],
    };
    const { summary } = await run('T-10', withNewField);

    const unmapped = summary.unmapped.find(item => item.field === 'nowe_pole_hotresa');
    expect(unmapped).toBeDefined();
    expect(unmapped?.group).toBe('rooms');
    expect(unmapped?.sample).toBe('niespodzianka');

    const stored = await prisma.unmappedField.findMany({ where: { runId: summary.runId } });
    expect(stored.some(row => row.field === 'nowe_pole_hotresa')).toBe(true);
  });

  it('błąd grupy opcjonalnej jest miękki i nie psuje przebiegu', async () => {
    const broken: Responder = { ...FIXTURES, api_reviews: new Error('padło') };
    const { summary } = await run('T-11', broken);

    expect(summary.status).toBe('ok');
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].soft).toBe(true);
  });

  it('zapisuje przebieg wraz ze statystykami i błędami', async () => {
    const { summary } = await run('T-12', FIXTURES);

    const stored = await prisma.exportRun.findUniqueOrThrow({
      where: { id: summary.runId },
      include: { stats: true, errors: true },
    });

    expect(stored.status).toBe('ok');
    expect(stored.langs).toBe('pl');
    expect(stored.requests).toBeGreaterThan(0);
    expect(stored.finishedAt).not.toBeNull();
    expect(stored.stats.find(stat => stat.group === 'roomstypes')?.written).toBe(2);
  });

  it('respektuje wybór grup i pomijanie szczegółów', async () => {
    const { summary, calls } = await run('T-13', FIXTURES, {
      groups: ['rooms'],
      withDetails: false,
    });

    expect(summary.groups).toEqual(['rooms']);
    expect(calls.map(call => call.action)).toEqual(['api_rooms']);
    expect(await prisma.roomType.count({ where: { property: { oid: 'T-13' } } })).toBe(0);
    expect(await prisma.room.count({ where: { property: { oid: 'T-13' } } })).toBe(2);
  });

  it('importuje standardy przed pokojami niezależnie od kolejności wyboru', async () => {
    const { calls } = await run('T-14', FIXTURES, { groups: ['rooms', 'roomstypes'] });
    const listCalls = calls.map(call => call.action).filter(action => action !== 'api_roomtype');

    expect(listCalls.indexOf('api_roomstypes')).toBeLessThan(listCalls.indexOf('api_rooms'));

    const room = await prisma.room.findFirstOrThrow({
      where: { property: { oid: 'T-14' }, hotresId: '35776' },
    });
    expect(room.roomTypeId).not.toBeNull();
  });

  it('odrzuca nieznany język i nieznaną grupę', async () => {
    await expect(run('T-15', FIXTURES, { langs: ['xx'] })).rejects.toThrow('Nieznany język');
    await expect(run('T-15', FIXTURES, { groups: ['bzdura'] })).rejects.toThrow('Nieznana grupa');
  });
});
