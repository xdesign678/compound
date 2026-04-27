import { NextResponse } from 'next/server';
import { isAdminAuthConfigured, shouldEnforceAdminAuth } from '@/lib/server-auth';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';

export const runtime = 'nodejs';

/**
 * Liveness / configuration probe. Returns `{ status: 'ok' }` along with
 * boolean flags describing whether admin auth, the LLM gateway, GitHub sync,
 * and the persistent data directory are configured. Safe to call without
 * authentication so platform health checks (Docker, Kubernetes, uptime
 * monitors) can use it as a readiness signal.
 *
 * @returns 200 JSON with `status`, `service`, `auth`, `llm`, `githubSync`, `data`.
 */
export const GET = withRequestTracing(async () => {
  const ctx = getRequestContext();
  return NextResponse.json({
    status: 'ok',
    service: 'compound',
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
    auth: {
      configured: isAdminAuthConfigured(),
      enforced: shouldEnforceAdminAuth(),
    },
    llm: {
      configured: Boolean(process.env.LLM_API_KEY || process.env.AI_GATEWAY_API_KEY),
    },
    githubSync: {
      configured: Boolean(process.env.GITHUB_REPO && process.env.GITHUB_TOKEN),
    },
    data: {
      configured: Boolean(process.env.DATA_DIR),
    },
  });
});
