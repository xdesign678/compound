import { NextResponse } from 'next/server';
import { isAdminAuthConfigured, shouldEnforceAdminAuth } from '@/lib/server-auth';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { getEmbeddingMode } from '@/lib/embedding';

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
  const embeddingMode = getEmbeddingMode();
  const embeddingWarning =
    embeddingMode !== 'remote'
      ? 'No real embedding endpoint configured. Set COMPOUND_EMBEDDING_API_KEY (and optionally COMPOUND_EMBEDDING_API_URL) to enable semantic vector retrieval; otherwise queries fall back to FTS-only.'
      : null;
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
    embedding: {
      mode: embeddingMode,
      warning: embeddingWarning,
    },
    githubSync: {
      configured: Boolean(process.env.GITHUB_REPO && process.env.GITHUB_TOKEN),
    },
    data: {
      configured: Boolean(process.env.DATA_DIR),
    },
  });
});
