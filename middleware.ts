import { NextRequest, NextResponse } from 'next/server';

function clean(value: string | undefined): string {
  return value?.replace(/^["'\s]+|["'\s]+$/g, '') ?? '';
}

function getAdminToken(): string {
  return clean(process.env.COMPOUND_ADMIN_TOKEN) || clean(process.env.ADMIN_TOKEN);
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
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

  return req.cookies.get('compound_admin_token')?.value.trim() ?? '';
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
    return NextResponse.next();
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
