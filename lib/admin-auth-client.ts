import { fetchCompoundPrivateApi, lockPrivateCacheForLogout } from './auth-response-guard';

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

  const res = await fetchCompoundPrivateApi(AUTH_SESSION_PATH, {
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
  lockPrivateCacheForLogout();
  try {
    await fetchCompoundPrivateApi(AUTH_SESSION_PATH, {
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

export const SESSION_CHECK_TIMEOUT_MS = 6_000;

export type SessionProbeResult =
  | { kind: 'authenticated' }
  | { kind: 'unauthenticated' }
  | { kind: 'revoked' }
  | { kind: 'unavailable'; reason: 'timeout' | 'server_error' | 'network' };

export type PrivateCacheDecision =
  | { kind: 'granted'; live: boolean }
  | { kind: 'revoked' }
  | { kind: 'locked' }
  | { kind: 'unavailable'; reason: 'timeout' | 'server_error' | 'network' };

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name?: unknown }).name) : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message) : '';
  return name === 'AbortError' || /aborted|timeout/i.test(message);
}

/**
 * Distinguishes authoritative revoke (401/403), a live anonymous/authenticated
 * session, and unknown outages (timeout/5xx/network).
 */
export async function probeAdminSession(): Promise<SessionProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SESSION_CHECK_TIMEOUT_MS);
  try {
    const res = await fetchCompoundPrivateApi(AUTH_SESSION_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { kind: 'revoked' };
    }
    if (!res.ok) return { kind: 'unavailable', reason: 'server_error' };

    const body = (await res.json()) as { authenticated?: unknown };
    const authenticated = body.authenticated === true;
    updateOfflineAccess(authenticated);
    return authenticated ? { kind: 'authenticated' } : { kind: 'unauthenticated' };
  } catch (error) {
    return { kind: 'unavailable', reason: isAbortError(error) ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks whether the current httpOnly cookie still represents a valid session.
 * Returns false for 401/403 (authoritative revoke). Returns null when the
 * server cannot be reached, timed out, or returned 5xx, so callers can make
 * an explicit offline-access decision instead of treating an outage as logout.
 */
export async function checkAdminSession(): Promise<boolean | null> {
  const probe = await probeAdminSession();
  if (probe.kind === 'authenticated') return true;
  if (probe.kind === 'revoked' || probe.kind === 'unauthenticated') return false;
  return null;
}

export async function resolvePrivateCacheAccess(): Promise<PrivateCacheDecision> {
  if (isPrivateCacheLocallyLocked()) return { kind: 'locked' };
  const probe = await probeAdminSession();
  if (probe.kind === 'authenticated') return { kind: 'granted', live: true };
  if (probe.kind === 'revoked') return { kind: 'revoked' };
  if (probe.kind === 'unauthenticated') return { kind: 'revoked' };
  if (hasOfflineAccess()) return { kind: 'granted', live: false };
  return { kind: 'unavailable', reason: probe.reason };
}

/** Grants access with a live session, or with the last verified offline grant. */
export async function canReadPrivateCache(): Promise<boolean> {
  const decision = await resolvePrivateCacheAccess();
  return decision.kind === 'granted';
}

/**
 * Returns an empty headers object.
 * Authentication is carried automatically by the httpOnly cookie on
 * same-origin requests — no explicit Authorization header is needed.
 */
export function getAdminAuthHeaders(): Record<string, string> {
  return {};
}
