const AUTH_SESSION_PATH = '/api/auth/session';
const OFFLINE_ACCESS_KEY = 'compound:offline-access';
const LOCAL_CACHE_LOCK_KEY = 'compound:local-cache-lock';

function updateOfflineAccess(granted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (granted) {
      window.localStorage.setItem(OFFLINE_ACCESS_KEY, '1');
      window.localStorage.removeItem(LOCAL_CACHE_LOCK_KEY);
    } else {
      window.localStorage.removeItem(OFFLINE_ACCESS_KEY);
    }
  } catch {
    // Ignore — storage may be unavailable.
  }
}

function lockPrivateCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(OFFLINE_ACCESS_KEY);
    window.localStorage.setItem(LOCAL_CACHE_LOCK_KEY, '1');
  } catch {
    // Ignore — storage may be unavailable.
  }
}

function hasOfflineAccess(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem(LOCAL_CACHE_LOCK_KEY) !== '1' &&
      window.localStorage.getItem(OFFLINE_ACCESS_KEY) === '1'
    );
  } catch {
    return false;
  }
}

function isPrivateCacheLocallyLocked(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(LOCAL_CACHE_LOCK_KEY) === '1';
  } catch {
    return true;
  }
}

/**
 * Always returns an empty string.
 * Authentication is handled via httpOnly cookie — no client-side token access needed.
 */
export function getAdminToken(): string {
  return '';
}

/**
 * Validates the Admin Token with the server and lets the server set the
 * httpOnly session cookie. The token is never persisted in browser storage.
 */
export async function saveAdminToken(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('请先填写访问保护密钥。');

  const res = await fetch(AUTH_SESSION_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: trimmed }),
  });

  if (res.ok) {
    updateOfflineAccess(true);
    return;
  }
  if (res.status === 401) throw new Error('访问保护密钥无效，请重新输入。');
  if (res.status === 503) throw new Error('服务端访问保护未配置，请检查环境变量。');

  const text = await res.text().catch(() => '');
  throw new Error(text.slice(0, 200) || `访问保护登录失败 (${res.status})`);
}

/**
 * Clears the httpOnly session cookie on the server and removes legacy local
 * storage credentials left by older builds.
 */
export async function clearAdminToken(): Promise<void> {
  lockPrivateCache();
  try {
    await fetch(AUTH_SESSION_PATH, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
  } finally {
    try {
      window.localStorage.removeItem('compound_admin_token');
    } catch {
      // Ignore — storage may be unavailable.
    }
  }
}

/**
 * Checks whether the current httpOnly cookie still represents a valid session.
 * Returns null when the server cannot be reached, so callers can make an
 * explicit offline-access decision instead of treating an outage as logout.
 */
export async function checkAdminSession(): Promise<boolean | null> {
  try {
    const res = await fetch(AUTH_SESSION_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const body = (await res.json()) as { authenticated?: unknown };
    const authenticated = body.authenticated === true;
    updateOfflineAccess(authenticated);
    return authenticated;
  } catch {
    return null;
  }
}

/** Grants access with a live session, or with the last verified offline grant. */
export async function canReadPrivateCache(): Promise<boolean> {
  if (isPrivateCacheLocallyLocked()) return false;
  const authenticated = await checkAdminSession();
  return authenticated ?? hasOfflineAccess();
}

/**
 * Returns an empty headers object.
 * Authentication is carried automatically by the httpOnly cookie on
 * same-origin requests — no explicit Authorization header is needed.
 */
export function getAdminAuthHeaders(): Record<string, string> {
  return {};
}
