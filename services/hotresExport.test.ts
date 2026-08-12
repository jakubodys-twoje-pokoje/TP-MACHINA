import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Serwis strzela do Hotres przez funkcję Edge, więc podstawiamy sesję Supabase.
vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

import { runHotresExport, buildHotresUrl, toArray } from './hotresExport';

/** Rejestruje wywołania i odpowiada zgodnie z mapą action → payload. */
function mockHotres(responses: Record<string, any>) {
  const calls: { action: string; params: URLSearchParams }[] = [];

  const fetchMock = vi.fn(async (_proxyUrl: string, init: any) => {
    const target = new URL(JSON.parse(init.body).url);
    const action = target.pathname.replace(/^\//, '');
    calls.push({ action, params: target.searchParams });

    const responder = responses[action];
    if (responder === undefined) {
      return {
        ok: false,
        json: async () => ({ error: `HTTP 404 nieznany endpoint ${action}` }),
      };
    }

    const payload = typeof responder === 'function' ? responder(target.searchParams) : responder;
    if (payload instanceof Error) {
      return { ok: false, json: async () => ({ error: payload.message }) };
    }

    return { ok: true, json: async () => ({ data: JSON.stringify(payload) }) };
  });

  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildHotresUrl', () => {
  it('dokleja dane logowania, oid i parametry', () => {
    const url = new URL(buildHotresUrl('api_roomtype', '474', { type_id: 29411, lang: 'pl' }));
    expect(url.origin + url.pathname).toBe('https://panel.hotres.pl/api_roomtype');
    expect(url.searchParams.get('oid')).toBe('474');
    expect(url.searchParams.get('type_id')).toBe('29411');
    expect(url.searchParams.get('lang')).toBe('pl');
    expect(url.searchParams.get('user')).toBeTruthy();
    expect(url.searchParams.get('password')).toBeTruthy();
  });

  it('pomija puste parametry', () => {
    const url = new URL(buildHotresUrl('api_rates', '474', { lang: '', tag: undefined as any }));
    expect(url.searchParams.has('lang')).toBe(false);
    expect(url.searchParams.has('tag')).toBe(false);
  });
});

describe('toArray', () => {
  it('normalizuje tablicę, pojedynczy obiekt i null', () => {
    expect(toArray([1, 2])).toEqual([1, 2]);
    expect(toArray({ a: 1 })).toEqual([{ a: 1 }]);
    expect(toArray(null)).toEqual([]);
  });
});

describe('runHotresExport', () => {
  it('pobiera listę per język i dociąga szczegóły dla każdego elementu', async () => {
    const calls = mockHotres({
      api_roomstypes: [{ type_id: '29411' }, { type_id: '29412' }],
      api_roomtype: (params: URLSearchParams) => ({
        type_id: params.get('type_id'),
        lang: params.get('lang'),
      }),
    });

    const result = await runHotresExport({
      oid: '474',
      langs: ['pl', 'en'],
      groups: ['roomstypes'],
      delayMs: 0,
    });

    // 2 listy (pl, en) + 2 typy × 2 języki
    expect(calls.filter(call => call.action === 'api_roomstypes')).toHaveLength(2);
    expect(calls.filter(call => call.action === 'api_roomtype')).toHaveLength(4);
    expect(result.requests).toBe(6);

    expect(Object.keys(result.data.roomstypes)).toEqual(['pl', 'en']);
    expect(Object.keys(result.data.roomtypes.pl)).toEqual(['29411', '29412']);
    expect(result.data.roomtypes.en['29411'].lang).toBe('en');
    expect(result.counts.roomstypes).toBe(2);
    expect(result.counts.roomtypes).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('nie dociąga szczegółów przy withDetails=false', async () => {
    const calls = mockHotres({ api_roomstypes: [{ type_id: '29411' }] });

    const result = await runHotresExport({
      oid: '474',
      langs: ['pl'],
      groups: ['roomstypes'],
      withDetails: false,
      delayMs: 0,
    });

    expect(calls.filter(call => call.action === 'api_roomtype')).toHaveLength(0);
    expect(result.data.roomtypes).toBeUndefined();
  });

  it('błąd grupy opcjonalnej jest miękki, a wymaganej twardy', async () => {
    mockHotres({
      api_rooms: new Error('HTTP 500 padło'),
      api_reviews: new Error('HTTP 500 padło'),
    });

    const result = await runHotresExport({
      oid: '474',
      langs: ['pl'],
      groups: ['rooms', 'reviews'],
      delayMs: 0,
    });

    expect(result.errors).toHaveLength(2);
    expect(result.errors.find(error => error.action === 'api_rooms')?.soft).toBe(false);
    expect(result.errors.find(error => error.action === 'api_reviews')?.soft).toBe(true);
  });

  it('404 na pojedynczym elemencie nie przerywa eksportu', async () => {
    mockHotres({
      api_rates: [{ rate_id: '1' }, { rate_id: '2' }],
      api_rate: (params: URLSearchParams) =>
        params.get('rate_id') === '2'
          ? new Error('HTTP 404 not found')
          : { rate_id: '1' },
    });

    const result = await runHotresExport({
      oid: '474',
      langs: ['pl'],
      groups: ['rates'],
      delayMs: 0,
    });

    expect(Object.keys(result.data.rateDetails.pl)).toEqual(['1']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].soft).toBe(true);
  });

  it('traktuje { result: "error" } z HTTP 200 jako błąd', async () => {
    mockHotres({ api_rooms: { result: 'error', message: 'Brak dostępu do obiektu' } });

    const result = await runHotresExport({
      oid: '474',
      langs: ['pl'],
      groups: ['rooms'],
      delayMs: 0,
    });

    expect(result.errors[0].message).toBe('Brak dostępu do obiektu');
    expect(result.errors[0].soft).toBe(false);
  });

  it('raportuje postęp i rozszerza licznik kroków o szczegóły', async () => {
    mockHotres({
      api_roomstypes: [{ type_id: '1' }, { type_id: '2' }],
      api_roomtype: { type_id: '1' },
    });

    const totals: number[] = [];
    await runHotresExport({
      oid: '474',
      langs: ['pl'],
      groups: ['roomstypes'],
      delayMs: 0,
      onProgress: ({ total }) => totals.push(total),
    });

    // start: 1 lista → po poznaniu listy: 1 + 2 szczegóły
    expect(totals[0]).toBe(1);
    expect(totals[totals.length - 1]).toBe(3);
  });

  it('przerywa eksport po abort()', async () => {
    mockHotres({ api_rooms: [], api_addons: [] });
    const controller = new AbortController();
    controller.abort();

    await expect(
      runHotresExport({
        oid: '474',
        langs: ['pl'],
        groups: ['rooms', 'addons'],
        delayMs: 0,
        signal: controller.signal,
      }),
    ).rejects.toThrow('Eksport przerwany');
  });

  it('waliduje wejście', async () => {
    await expect(runHotresExport({ oid: '', langs: ['pl'] })).rejects.toThrow('Brak OID');
    await expect(runHotresExport({ oid: '474', langs: [] })).rejects.toThrow('język');
    await expect(runHotresExport({ oid: '474', groups: [] })).rejects.toThrow('grupę');
  });
});
