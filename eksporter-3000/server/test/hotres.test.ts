import { describe, it, expect, vi } from 'vitest';
import { createHotresClient, HotresError } from '../src/hotres.js';

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function textResponse(body: string, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

const base = { user: 'u', password: 'p', oid: '474', delayMs: 0 };

describe('klient Hotres', () => {
  it('składa URL z poświadczeniami, oid i parametrami', () => {
    const client = createHotresClient({ ...base, fetchImpl: vi.fn() });
    const url = new URL(client.buildUrl('api_roomtype', { type_id: 29411, lang: 'pl' }));

    expect(url.origin + url.pathname).toBe('https://panel.hotres.pl/api_roomtype');
    expect(url.searchParams.get('oid')).toBe('474');
    expect(url.searchParams.get('type_id')).toBe('29411');
    expect(url.searchParams.get('lang')).toBe('pl');
  });

  it('maskuje poświadczenia w logach', () => {
    const client = createHotresClient({
      ...base,
      user: 'admin@twojepokoje.com.pl',
      password: 'TajneHaslo123',
      fetchImpl: vi.fn(),
    });
    const redacted = client.redact(client.buildUrl('api_rooms'));

    expect(redacted).not.toContain('TajneHaslo123');
    expect(redacted).not.toContain('twojepokoje');
    expect(redacted).toContain('user=***');
    expect(redacted).toContain('password=***');
  });

  it('pomija puste parametry', () => {
    const client = createHotresClient({ ...base, fetchImpl: vi.fn() });
    const url = new URL(client.buildUrl('api_rates', { lang: '', tag: undefined as any }));

    expect(url.searchParams.has('lang')).toBe(false);
    expect(url.searchParams.has('tag')).toBe(false);
  });

  it('ponawia 5xx i w końcu zwraca dane', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(textResponse('bang', 502))
      .mockResolvedValueOnce(jsonResponse([{ room_id: '1' }]));

    const client = createHotresClient({ ...base, fetchImpl });
    await expect(client.get('api_rooms')).resolves.toEqual([{ room_id: '1' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(client.requestCount).toBe(2);
  });

  it('nie ponawia 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('not found', 404));
    const client = createHotresClient({ ...base, fetchImpl });

    await expect(client.get('api_roomtype', { type_id: 1 })).rejects.toThrow(HotresError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('traktuje { result: "error" } z HTTP 200 jako trwały błąd', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ result: 'error', message: 'Brak dostępu' }));
    const client = createHotresClient({ ...base, fetchImpl });

    await expect(client.get('api_rooms')).rejects.toThrow('Brak dostępu');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('odpowiedź nie-JSON to błąd bez ponawiania', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('<html>maintenance</html>', 200));
    const client = createHotresClient({ ...base, fetchImpl });

    await expect(client.get('api_rooms')).rejects.toThrow('nie jest JSON-em');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('ponawia błędy sieciowe', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = createHotresClient({ ...base, fetchImpl });

    await expect(client.get('api_rooms')).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
