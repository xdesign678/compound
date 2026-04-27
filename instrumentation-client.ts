/**
 * Sentry browser client configuration.
 *
 * Next.js 15 loads this file automatically on the client. We wire up
 * breadcrumbs (history, console, fetch), session replay-free tracing, and
 * stack trace symbolication via the source maps uploaded by the Next.js
 * plugin during `next build`.
 *
 * The init is a no-op when no DSN is configured so PR previews and local dev
 * do not require Sentry credentials.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE;
const environment =
  process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';

const tracesSampleRate = Number.parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.1');

if (dsn) {
  Sentry.init({
    dsn,
    release,
    environment,
    attachStacktrace: true,
    maxBreadcrumbs: 100,
    tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.1,
    // Browser integrations that come with @sentry/nextjs already include
    // BrowserTracing + breadcrumbs for fetch/xhr/history/console, which is
    // exactly the contextual data agents need to trace prod errors.
    integrations: [Sentry.browserTracingIntegration()],
    // Do not attach raw cookies, IPs, or query strings by default.
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip token-like values from request URLs before send.
      if (event.request?.url) {
        try {
          const url = new URL(event.request.url);
          for (const key of Array.from(url.searchParams.keys())) {
            if (/token|key|secret|auth/i.test(key)) {
              url.searchParams.set(key, '[Filtered]');
            }
          }
          event.request.url = url.toString();
        } catch {
          // ignore invalid URLs
        }
      }
      return event;
    },
  });
}

// Note: explicit `onRouterTransitionStart` is only required from
// @sentry/nextjs v9+. The v8 SDK instruments App Router navigations
// automatically via the BrowserTracing integration above.
