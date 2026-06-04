const AUTH_SESSION_PATH = '/api/auth/session';

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

  if (res.ok) return;
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
 * Returns an empty headers object.
 * Authentication is carried automatically by the httpOnly cookie on
 * same-origin requests — no explicit Authorization header is needed.
 */
export function getAdminAuthHeaders(): Record<string, string> {
  return {};
}
