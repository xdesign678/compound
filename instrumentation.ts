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

/**
 * Fail-fast guard against production deploys that silently run without the
 * security controls the codebase assumes are present. This function runs once
 * per Node.js runtime startup (it is intentionally NOT called on the Edge
 * runtime, which doesn't use admin tokens or SSRF DNS guards).
 *
 * Rules:
 *   1. `COMPOUND_SKIP_DNS_GUARD=true` is REJECTED in production — it disables
 *      the SSRF protection inside `lib/gateway.ts` and should only ever be
 *      used in local dev against a loopback LLM.
 *   2. `COMPOUND_ADMIN_TOKEN` / `ADMIN_TOKEN` MUST be set in production so
 *      admin API routes actually enforce auth instead of falling back to a
 *      503 banner that can be removed by deleting the env var.
 *   3. `COMPOUND_TRUST_PROXY=true` SHOULD be set behind a real reverse proxy
 *      (Vercel / Cloudflare / Zeabur / nginx) so the per-IP rate limiter
 *      doesn't collapse every request into a single shared `'anon'` bucket
 *      (which lets a single abusive client starve all other users). Missing
 *      this is loud but non-fatal because local docker-compose runs behind
 *      a naked Next.js server are a legitimate use-case.
 */
function assertProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;

  if (process.env.COMPOUND_SKIP_DNS_GUARD === 'true') {
    throw new Error(
      '[startup] COMPOUND_SKIP_DNS_GUARD=true is disabled in production to prevent SSRF. ' +
        'Remove this variable (local dev only) or change NODE_ENV.',
    );
  }

  const adminToken = (process.env.COMPOUND_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '').trim();
  if (!adminToken) {
    throw new Error(
      '[startup] COMPOUND_ADMIN_TOKEN (or ADMIN_TOKEN) must be set in production. ' +
        'Refusing to start to avoid running admin API routes without authentication.',
    );
  }

  if (process.env.COMPOUND_TRUST_PROXY !== 'true') {
    // eslint-disable-next-line no-console
    console.error(
      '[startup] WARNING: COMPOUND_TRUST_PROXY is not "true" in production. ' +
        'Rate limiting will fall back to a single shared "anon" bucket, letting a ' +
        'single abusive client exhaust quota for everyone. Set COMPOUND_TRUST_PROXY=true ' +
        'behind a trusted reverse proxy (Vercel / Cloudflare / Zeabur / nginx).',
    );
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    assertProductionConfig();
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Forward server-side request errors (server actions, route handlers, RSC) to
// Sentry with full stack traces and request metadata.
export const onRequestError = Sentry.captureRequestError;
