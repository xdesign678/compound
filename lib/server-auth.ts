import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

const ADMIN_TOKEN_ENV_KEYS = ['COMPOUND_ADMIN_TOKEN', 'ADMIN_TOKEN'] as const;

function clean(value: string | undefined): string {
  return value?.replace(/^["'\s]+|["'\s]+$/g, '') ?? '';
}

export function getAdminToken(): string {
  for (const key of ADMIN_TOKEN_ENV_KEYS) {
    const value = clean(process.env[key]);
    if (value) return value;
  }
  return '';
}

export function isAdminAuthConfigured(): boolean {
  return getAdminToken().length > 0;
}

export function shouldEnforceAdminAuth(): boolean {
  return isAdminAuthConfigured() || process.env.NODE_ENV === 'production';
}

/**
 * Constant-time string comparison using Node.js crypto.timingSafeEqual.
 * Exported for use by other server-side modules.
 * When lengths differ, both buffers are still compared at the longer length
 * to avoid leaking length information via timing side-channels.
 */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // Pad the shorter buffer to the length of the longer one so
  // timingSafeEqual always receives equal-length buffers.
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);

  // Fold in a length-mismatch check that doesn't short-circuit.
  return bufA.length === bufB.length && timingSafeEqual(paddedA, paddedB);
}

function tokenFromAuthorizationHeader(value: string | null): string {
  if (!value) return '';

  const bearerPrefix = 'Bearer ';
  if (value.startsWith(bearerPrefix)) {
    return value.slice(bearerPrefix.length).trim();
  }

  const basicPrefix = 'Basic ';
  if (value.startsWith(basicPrefix)) {
    try {
      const decoded = Buffer.from(value.slice(basicPrefix.length), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator === -1) return decoded.trim();
      return decoded.slice(separator + 1).trim();
    } catch {
      return '';
    }
  }

  return '';
}

function tokenFromCookie(value: string | null): string {
  if (!value) return '';

  const pairs = value.split(';').map((part) => part.trim());
  for (const pair of pairs) {
    const [key, ...rest] = pair.split('=');
    if (key === 'compound_admin_token') {
      return decodeURIComponent(rest.join('='));
    }
  }

  return '';
}

export function isAuthorizedRequest(req: Request): boolean {
  const expected = getAdminToken();
  if (!expected) return process.env.NODE_ENV !== 'production';

  const candidates = [
    req.headers.get('x-compound-admin-token') ?? '',
    tokenFromAuthorizationHeader(req.headers.get('authorization')),
    tokenFromCookie(req.headers.get('cookie')),
  ];

  return candidates.some((candidate) => safeEqual(candidate, expected));
}

export function requireAdmin(req: Request): NextResponse | null {
  if (!shouldEnforceAdminAuth()) return null;

  if (!isAdminAuthConfigured()) {
    return NextResponse.json(
      { error: 'COMPOUND_ADMIN_TOKEN or ADMIN_TOKEN must be configured in production.' },
      { status: 503 },
    );
  }

  if (isAuthorizedRequest(req)) return null;

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
