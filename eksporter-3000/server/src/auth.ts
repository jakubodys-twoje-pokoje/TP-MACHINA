/**
 * Logowanie na jedno konto wpisane na twardo w .env.
 *
 * Bez bazy użytkowników, bez rejestracji, bez resetu hasła - to narzędzie
 * migracyjne dla kilku osób, a nie portal. Token sesji jest deterministyczną
 * funkcją poświadczeń, więc restart serwisu nie wylogowuje.
 */

import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'eksporter_session';
/** 30 dni - to narzędzie na czas migracji, nikt nie chce logować się co godzinę. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export interface Credentials {
  user: string;
  password: string;
}

export function readCredentials(): Credentials {
  const user = process.env.EKSPORTER_USER ?? '';
  const password = process.env.EKSPORTER_PASSWORD ?? '';
  return { user, password };
}

/** Bez kompletu poświadczeń serwis nie wstaje - lepiej to niż otwarte drzwi. */
export function assertCredentials(credentials: Credentials): void {
  if (!credentials.user || !credentials.password) {
    throw new Error(
      'Brak EKSPORTER_USER / EKSPORTER_PASSWORD w .env - ustaw login i hasło do panelu.',
    );
  }
}

function tokenFor(credentials: Credentials): string {
  return crypto
    .createHash('sha256')
    .update(`eksporter-3000|${credentials.user}|${credentials.password}`)
    .digest('hex');
}

/** Porównanie odporne na wyciek informacji przez czas odpowiedzi. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function isLoggedIn(req: Request): boolean {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return false;
  return safeEqual(token, tokenFor(readCredentials()));
}

export function login(req: Request, res: Response): boolean {
  const credentials = readCredentials();
  const user = String(req.body?.user ?? '');
  const password = String(req.body?.password ?? '');

  if (!safeEqual(user, credentials.user) || !safeEqual(password, credentials.password)) {
    return false;
  }

  res.cookie(COOKIE_NAME, tokenFor(credentials), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE * 1000,
    path: '/',
  });
  return true;
}

export function logout(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** Strażnik dla /api/* - poza logowaniem i pingiem. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isLoggedIn(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'Nie zalogowano' });
}
