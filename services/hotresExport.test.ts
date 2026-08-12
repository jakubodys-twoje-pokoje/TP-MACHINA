import { describe, it, expect, vi, afterEach } from 'vitest';
import { ServiceOfflineError, streamExport, type ExportEvent } from './hotresExport';

/** Odpowiedź serwisu jako strumień - `chunks` mogą dzielić linie w dowolnym miejscu. */
function ndjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true, value: undefined },
        releaseLock: () => {},
      }),
    },
  } as unknown as Response;
}

async function collect(): Promise<ExportEvent[]> {
  const events: ExportEvent[] = [];
  for await (const event of streamExport({
    oid: '474',
    langs: ['pl'],
    groups: ['rooms'],
    withDetails: true,
    delayMs: 0,
  })) {
    events.push(event);
  }
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamExport', () => {
  it('czyta zdarzenia linia po linii', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ndjsonResponse([
          '{"type":"progress","completed":1,"total":2,"message":"Pokoje","level":"ok"}\n',
          '{"type":"done","summary":{"runId":7},"counts":{"rooms":2}}\n',
        ]),
      ),
    );

    const events = await collect();

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'progress', message: 'Pokoje' });
    expect(events[1]).toMatchObject({ type: 'done' });
  });

  it('skleja linię rozciętą między porcjami strumienia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ndjsonResponse([
          '{"type":"progress","completed":1,',
          '"total":2,"message":"Sklejone","level":"ok"}\n{"type":"progress",',
          '"completed":2,"total":2,"message":"Drugie","level":"ok"}\n',
        ]),
      ),
    );

    const events = await collect();

    expect(events.map((event: any) => event.message)).toEqual(['Sklejone', 'Drugie']);
  });

  it('oddaje ostatnią linię bez znaku końca', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ndjsonResponse(['{"type":"error","message":"Brak OID obiektu"}']),
      ),
    );

    const events = await collect();

    expect(events).toEqual([{ type: 'error', message: 'Brak OID obiektu' }]);
  });

  it('ignoruje puste linie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ndjsonResponse(['\n\n{"type":"progress","completed":1,"total":1,"message":"X","level":"ok"}\n\n']),
      ),
    );

    expect(await collect()).toHaveLength(1);
  });

  it('brak serwisu to czytelny błąd z podpowiedzią', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    await expect(collect()).rejects.toThrow(ServiceOfflineError);
    await expect(collect()).rejects.toThrow('cd server && npm run dev');
  });

  it('przerwanie przez użytkownika nie udaje braku serwisu', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }));

    await expect(collect()).rejects.toThrow('aborted');
  });
});
