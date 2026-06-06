import { NextResponse } from 'next/server';
import { getAdminToken, isAdminAuthConfigured, safeEqual } from '@/lib/server-auth';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 64_000;

const AUTH_COOKIE_NAME = 'compound_admin_token';
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function secureCookie(req: Request): boolean {
  return process.env.NODE_ENV === 'production' || new URL(req.url).protocol === 'https:';
}

function setAuthCookie(req: Request, res: NextResponse, token: string): NextResponse {
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie(req),
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  return res;
}

function clearAuthCookie(req: Request, res: NextResponse): NextResponse {
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie(req),
    path: '/',
    maxAge: 0,
  });
  return res;
}

/**
 * POST /api/auth/session
 * Validates an Admin Token and sets the httpOnly access-protection cookie.
 *
 * Body: `{ "token": "..." }`.
 *
 * @returns 200 JSON `{ authenticated: true }` and a Set-Cookie header on success.
 */
export async function POST(req: Request) {
  if (!isAdminAuthConfigured()) {
    return NextResponse.json(
      { error: 'COMPOUND_ADMIN_TOKEN or ADMIN_TOKEN must be configured.' },
      { status: 503 },
    );
  }

  const sizeDenied = enforceContentLength(req, MAX_BODY_BYTES);
  if (sizeDenied) return sizeDenied;

  try {
    const body = await readJsonWithLimit<{ token?: unknown }>(req, MAX_BODY_BYTES);
    const provided = typeof body.token === 'string' ? body.token.trim() : '';
    const expected = getAdminToken();

    if (!safeEqual(provided, expected)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return setAuthCookie(req, NextResponse.json({ authenticated: true }), expected);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // Malformed JSON body → treat as empty
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

/**
 * DELETE /api/auth/session
 * Clears the httpOnly access-protection cookie.
 *
 * @returns 200 JSON `{ authenticated: false }`.
 */
export async function DELETE(req: Request) {
  return clearAuthCookie(req, NextResponse.json({ authenticated: false }));
}
