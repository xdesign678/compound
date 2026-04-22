const STORAGE_KEY = 'compound_admin_token';

export function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function saveAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  const clean = token.trim();
  if (clean) {
    localStorage.setItem(STORAGE_KEY, clean);
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
}

export function clearAdminToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function getAdminAuthHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { 'X-Compound-Admin-Token': token } : {};
}
