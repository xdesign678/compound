/**
 * Sentry server runtime configuration.
 *
 * Loaded via `instrumentation.ts` whenever the Node.js server starts (next
 * start / next dev / standalone server). Errors reported from server actions,
 * API routes, and middleware-adjacent code paths flow through this client.
 *
 * The SDK is a no-op when `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` is not set,
 * so local development continues to work out-of-the-box without an account.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const release = process.env.SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE;
const environment =
  process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';

const tracesSampleRate = Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1');
const profilesSampleRate = Number.parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0');

if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment,
    // Capture full stack traces with source maps. The Next.js plugin uploads
    // the maps at build time so production stack frames map back to source.
    attachStacktrace: true,
    // Breadcrumbs (HTTP, console, fetch, etc.) are enabled by default; cap the
    // queue so noisy background jobs do not balloon payload size.
    maxBreadcrumbs: 100,
    // Conservative trace sampling — overridable per environment.
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,
    profilesSampleRate: Number.isFinite(profilesSampleRate) ? profilesSampleRate : 0,
    // Strip obvious secrets before they hit Sentry's ingestion pipeline.
    sendDefaultPii: false,
    beforeSend(event) {
      const headers = event.request?.headers;
      if (headers) {
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (
            lower === 'authorization' ||
            lower === 'cookie' ||
            lower === 'x-compound-admin-token' ||
            lower.includes('api-key') ||
            lower.includes('token')
          ) {
            headers[key] = '[Filtered]';
          }
        }
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // Drop noisy filesystem polling breadcrumbs that happen during dev.
      if (breadcrumb.category === 'console' && breadcrumb.level === 'debug') {
        return null;
      }
      return breadcrumb;
    },
  });
}
