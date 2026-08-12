/**
 * Klient Hotres API działający po stronie serwera.
 *
 * W przeciwieństwie do wersji w przeglądarce nie potrzebuje proxy (brak CORS),
 * a poświadczenia bierze z .env zamiast z bundla.
 */

const BASE_URL = 'https://panel.hotres.pl';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class HotresError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Czy ponowienie ma sens: sieć i 5xx tak, 4xx i błędy API nie. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'HotresError';
  }
}

export interface HotresClientOptions {
  user: string;
  password: string;
  oid: string;
  delayMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  /** Wstrzykiwane w testach. */
  fetchImpl?: typeof fetch;
}

/** Hotres na błąd potrafi odpowiedzieć HTTP 200 z { result: 'error', message }. */
function extractApiError(payload: any): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const result = String(payload.result ?? '').toLowerCase();
  if (result === 'error' || result === 'failed') {
    return payload.message || payload.error || 'Hotres API error';
  }
  return null;
}

export function createHotresClient(options: HotresClientOptions) {
  const {
    user,
    password,
    oid,
    delayMs = 350,
    maxRetries = 3,
    timeoutMs = 30000,
    fetchImpl = fetch,
  } = options;

  if (!user || !password) {
    throw new Error('Brak HOTRES_API_USER / HOTRES_API_PASSWORD w .env');
  }

  let requestCount = 0;
  let lastRequestAt = 0;

  function buildUrl(action: string, params: Record<string, string | number> = {}): string {
    const url = new URL(`/${action}`, BASE_URL);
    url.searchParams.set('user', user);
    url.searchParams.set('password', password);
    url.searchParams.set('oid', oid);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /** URL z zamaskowanymi poświadczeniami - do logów. */
  function redact(rawUrl: string): string {
    const url = new URL(rawUrl);
    url.searchParams.set('user', '***');
    url.searchParams.set('password', '***');
    return url.toString();
  }

  async function attempt(url: string): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*' },
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        throw new HotresError(
          `HTTP ${response.status} ${text.slice(0, 200)}`.trim(),
          response.status,
          response.status >= 500,
        );
      }

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new HotresError(`Odpowiedź nie jest JSON-em: ${text.slice(0, 200)}`, 200, false);
      }

      const apiError = extractApiError(parsed);
      if (apiError) throw new HotresError(apiError, 200, false);

      return parsed;
    } catch (error: any) {
      if (error instanceof HotresError) throw error;
      if (error?.name === 'AbortError') {
        throw new HotresError(`Timeout po ${timeoutMs} ms`, 0, true);
      }
      throw new HotresError(error?.message || String(error), 0, true);
    } finally {
      clearTimeout(timer);
    }
  }

  async function get(action: string, params: Record<string, string | number> = {}): Promise<any> {
    const url = buildUrl(action, params);

    for (let tries = 0; ; tries++) {
      const elapsed = Date.now() - lastRequestAt;
      if (lastRequestAt && elapsed < delayMs) await sleep(delayMs - elapsed);
      lastRequestAt = Date.now();
      requestCount++;

      try {
        return await attempt(url);
      } catch (error) {
        const retryable = error instanceof HotresError ? error.retryable : true;
        if (!retryable || tries >= maxRetries - 1) throw error;
        await sleep(2 ** tries * 1000);
      }
    }
  }

  return {
    get,
    buildUrl,
    redact,
    get requestCount() {
      return requestCount;
    },
  };
}

export type HotresClient = ReturnType<typeof createHotresClient>;
