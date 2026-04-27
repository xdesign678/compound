import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE_NAME = 'compound_admin_token';
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function clean(value: string | undefined): string {
  return value?.replace(/^["'\s]+|["'\s]+$/g, '') ?? '';
}

function getAdminToken(): string {
  return clean(process.env.COMPOUND_ADMIN_TOKEN) || clean(process.env.ADMIN_TOKEN);
}

/**
 * Constant-time string comparison safe for Edge Runtime (no node:crypto).
 * When lengths differ, pads the shorter string and still performs a full
 * comparison to avoid leaking length information via timing side-channels.
 */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;

  const maxLen = Math.max(a.length, b.length);
  // Pad both strings to the same length so the loop always runs maxLen iterations.
  const paddedA = a.padEnd(maxLen, '\0');
  const paddedB = b.padEnd(maxLen, '\0');

  // XOR every character; also fold in a length mismatch bit.
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= paddedA.charCodeAt(i) ^ paddedB.charCodeAt(i);
  }
  return diff === 0;
}

function decodeBasicToken(value: string): string {
  try {
    const decoded = atob(value);
    const separator = decoded.indexOf(':');
    if (separator === -1) return decoded.trim();
    return decoded.slice(separator + 1).trim();
  } catch {
    return '';
  }
}

function getProvidedToken(req: NextRequest): string {
  const direct = req.headers.get('x-compound-admin-token')?.trim();
  if (direct) return direct;

  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  if (auth.startsWith('Basic ')) return decodeBasicToken(auth.slice('Basic '.length));

  return req.cookies.get(AUTH_COOKIE_NAME)?.value.trim() ?? '';
}

function withAuthCookie(req: NextRequest, res: NextResponse, token: string): NextResponse {
  const existing = req.cookies.get(AUTH_COOKIE_NAME)?.value.trim() ?? '';
  if (existing === token) return res;

  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: req.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  return res;
}

export function middleware(req: NextRequest) {
  const token = getAdminToken();

  if (!token) {
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('COMPOUND_ADMIN_TOKEN or ADMIN_TOKEN must be configured.', {
        status: 503,
      });
    }
    return NextResponse.next();
  }

  if (safeEqual(getProvidedToken(req), token)) {
    return withAuthCookie(req, NextResponse.next(), token);
  }

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Compound", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ['/api/:path*', '/((?!_next/static|_next/image|.*\\..*).*)'],
};
