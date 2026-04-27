/**
 * Sentry runtime configuration for the Edge runtime (middleware + edge route
 * handlers). The Edge runtime cannot use Node-only APIs, so this file mirrors
 * the server config with a smaller surface area.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const release = process.env.SENTRY_RELEASE ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE;
const environment =
  process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';

const tracesSampleRate = Number.parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1');

if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment,
    attachStacktrace: true,
    maxBreadcrumbs: 50,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,
    sendDefaultPii: false,
  });
}
