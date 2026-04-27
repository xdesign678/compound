/**
 * Admin authentication is managed via httpOnly cookies set by the middleware.
 * The browser automatically includes the cookie on every same-origin request,
 * so client-side code never needs to read, store, or attach the token manually.
 *
 * The exported functions are kept as no-ops / stubs to preserve API
 * compatibility with existing call-sites.
 */

/**
 * Always returns an empty string.
 * Authentication is handled via httpOnly cookie — no client-side token access needed.
 */
export function getAdminToken(): string {
  return '';
}

/**
 * No-op. Token persistence is managed server-side via httpOnly cookie.
 */
export function saveAdminToken(_token: string): void {
  // Intentionally empty — cookie is set by middleware on successful auth.
}

/**
 * No-op. The httpOnly cookie is managed by the server / middleware.
 */
export function clearAdminToken(): void {
  // Intentionally empty.
  // Clean up any legacy localStorage data left from previous versions.
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('compound_admin_token');
    } catch {
      // Ignore — storage may be unavailable.
    }
  }
}

/**
 * Returns an empty headers object.
 * Authentication is carried automatically by the httpOnly cookie on
 * same-origin requests — no explicit Authorization header is needed.
 */
export function getAdminAuthHeaders(): Record<string, string> {
  return {};
}
