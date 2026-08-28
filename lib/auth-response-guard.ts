const OFFLINE_ACCESS_KEY = 'compound:offline-access';
const LOCAL_CACHE_LOCK_KEY = 'compound:local-cache-lock';
const URL_CHECK_BASE = 'http://compound.invalid';

function getBrowserOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.location.origin;
  } catch {
    return null;
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

/** Only Compound's root-relative or same-origin `/api/` URLs are accepted. */
export function isCompoundPrivateApiUrl(input: string | URL): boolean {
  const raw = String(input);
  const browserOrigin = getBrowserOrigin();
  const isRootRelative = raw.startsWith('/') && !raw.startsWith('//');

  try {
    const parsed = new URL(raw, browserOrigin ?? URL_CHECK_BASE);
    if (!parsed.pathname.startsWith('/api/')) return false;
    if (isRootRelative) return parsed.origin === (browserOrigin ?? URL_CHECK_BASE);
    return browserOrigin !== null && parsed.origin === browserOrigin;
  } catch {
    return false;
  }
}

function assertCompoundPrivateApiUrl(input: string | URL): void {
  if (!isCompoundPrivateApiUrl(input)) {
    throw new TypeError('Compound API guard only accepts relative or same-origin /api/ URLs.');
  }
}

/** Apply authoritative auth rejection only to a verified Compound private API response. */
export function guardCompoundPrivateApiResponse(input: string | URL, response: Response): Response {
  assertCompoundPrivateApiUrl(input);
  if (response.status === 401 || response.status === 403) lockPrivateCache();
  return response;
}

/** Fetch a Compound private API and lock local private data only on authoritative 401/403. */
export async function fetchCompoundPrivateApi(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  assertCompoundPrivateApiUrl(input);
  const response = await fetch(input, init);
  return guardCompoundPrivateApiResponse(input, response);
}

/** Explicit logout uses the same local lock without depending on an HTTP response. */
export function lockPrivateCacheForLogout(): void {
  lockPrivateCache();
}
