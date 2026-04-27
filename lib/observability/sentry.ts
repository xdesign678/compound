/**
 * Thin façade over @sentry/nextjs for the rest of the codebase.
 *
 * Goals:
 * - Provide a single import point for capturing exceptions, attaching
 *   breadcrumbs, and tagging the active user/session so callers do not have
 *   to know whether they are running on the server, edge, or client.
 * - Behave as a no-op when Sentry has not been initialised (no DSN configured)
 *   so unit tests, build steps, and offline development paths stay green.
 *
 * Usage:
 *
 *   import { reportError, addBreadcrumb, setObservabilityUser } from '@/lib/observability/sentry';
 *
 *   try {
 *     await ingestNote(note);
 *   } catch (err) {
 *     reportError(err, { tags: { area: 'ingest' }, extras: { noteId: note.id } });
 *     throw err;
 *   }
 */
import * as Sentry from '@sentry/nextjs';

export interface ReportErrorContext {
  tags?: Record<string, string | number | boolean>;
  extras?: Record<string, unknown>;
  fingerprint?: string[];
  level?: Sentry.SeverityLevel;
}

/**
 * Capture an exception with optional contextual tags, extras, and fingerprint.
 *
 * Returns the Sentry event id (or undefined when the SDK is not initialised)
 * so callers can surface a "report id" to the user when desired.
 */
export function reportError(error: unknown, context: ReportErrorContext = {}): string | undefined {
  const client = Sentry.getClient?.();
  if (!client) return undefined;

  return Sentry.withScope((scope) => {
    if (context.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, String(value));
      }
    }
    if (context.extras) {
      for (const [key, value] of Object.entries(context.extras)) {
        scope.setExtra(key, value);
      }
    }
    if (context.fingerprint && context.fingerprint.length > 0) {
      scope.setFingerprint(context.fingerprint);
    }
    if (context.level) {
      scope.setLevel(context.level);
    }
    return Sentry.captureException(error);
  });
}

/**
 * Append a breadcrumb to the active scope. Breadcrumbs are surfaced alongside
 * exceptions in Sentry and let agents reconstruct the path that led to a
 * failure (e.g. "started github sync run", "downloaded 42 files",
 * "ingest failed for note X").
 */
export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  if (!Sentry.getClient?.()) return;
  Sentry.addBreadcrumb({
    timestamp: Date.now() / 1000,
    ...breadcrumb,
  });
}

export interface ObservabilityUser {
  id?: string;
  username?: string;
  email?: string;
  /** Free-form attributes — keep PII to a minimum. */
  segment?: string;
}

/**
 * Tag the current scope with the active user. Pass `null` to clear the user
 * (e.g. on logout).
 */
export function setObservabilityUser(user: ObservabilityUser | null): void {
  if (!Sentry.getClient?.()) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: user.id,
    username: user.username,
    email: user.email,
    segment: user.segment,
  });
}

/**
 * Tag the current scope with a domain-level identifier (e.g. workspace id,
 * sync run id). Useful for grouping related errors during incident triage.
 */
export function setObservabilityTag(key: string, value: string | number | boolean): void {
  if (!Sentry.getClient?.()) return;
  Sentry.setTag(key, String(value));
}

/**
 * Re-export the underlying SDK so advanced use cases (custom transactions,
 * spans, replay session controls) remain available without an extra import.
 */
export { Sentry };
