/**
 * Next.js instrumentation hook.
 *
 * Loaded once per runtime startup (Node.js or Edge). We dynamically import the
 * runtime-specific Sentry config so the Edge runtime never pulls in Node-only
 * APIs and vice versa.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Forward server-side request errors (server actions, route handlers, RSC) to
// Sentry with full stack traces and request metadata.
export const onRequestError = Sentry.captureRequestError;
