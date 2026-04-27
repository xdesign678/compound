/**
 * Client-side helpers for distributed tracing.
 *
 * Generates a fresh `X-Request-ID` header for every outbound API call so that
 * the value can be matched against server-side logs (which capture it via
 * `lib/request-context.ts`).
 *
 * Usage:
 *   const headers = withRequestId({ 'Content-Type': 'application/json' });
 *   await fetch('/api/...', { headers });
 *
 * Safe to import from both browser and SSR contexts.
 */
export const REQUEST_ID_HEADER = 'X-Request-ID';

export function generateClientRequestId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function withRequestId(headers: Record<string, string> = {}): Record<string, string> {
  if (Object.keys(headers).some((key) => key.toLowerCase() === 'x-request-id')) {
    return headers;
  }
  return { ...headers, [REQUEST_ID_HEADER]: generateClientRequestId() };
}
