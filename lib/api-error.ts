/**
 * Unified error response builder for API routes.
 *
 * Returns a stable, generic public message + requestId for the client,
 * while logging the real error detail server-side only.
 *
 * Never leaks internal details (file paths, SQL queries, stack traces,
 * environment variable values, etc.) into the response body.
 *
 * Server-only. Do not import from client components.
 */
import { logger } from './logging';

/** Generic public-facing error message — never includes internal details. */
export const PUBLIC_ERROR_MESSAGE = 'Internal server error';

/**
 * Build a safe, client-facing error response body.
 *
 * - Returns a stable generic message + requestId for the client.
 * - Logs the real error detail server-side for debugging.
 * - The caller is still responsible for setting the correct HTTP status code.
 *
 * @param err - The original error (logged server-side only).
 * @param requestId - Optional request identifier for client correlation.
 * @param event - Structured log event name (default: `'api.unhandled_error'`).
 */
export function apiError(
  err: unknown,
  requestId?: string,
  event?: string,
): { error: string; requestId?: string } {
  // Log real error server-side with full detail
  const detail =
    err instanceof Error
      ? { errorName: err.name, errorMessage: err.message }
      : { errorMessage: String(err) };
  logger.error(event ?? 'api.unhandled_error', { ...detail, requestId });

  return { error: PUBLIC_ERROR_MESSAGE, requestId };
}
