import { NextResponse } from 'next/server';
import {
  isAdminAuthConfigured,
  isAuthorizedRequest,
  shouldEnforceAdminAuth,
} from '@/lib/server-auth';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { getEmbeddingMode } from '@/lib/embedding';

export const runtime = 'nodejs';

/**
 * Liveness / configuration probe. Returns `{ status: 'ok' }` publicly.
 * Detailed configuration info (auth, llm, embedding, githubSync, data) is
 * only returned when the request carries a valid admin token.
 *
 * @returns 200 JSON with `status` and optionally detailed config.
 */
export const GET = withRequestTracing(async (req: Request) => {
  const ctx = getRequestContext();
  const timestamp = Date.now();

  // Public response: only liveness signal
  const publicResponse = {
    status: 'ok',
    service: 'compound',
    timestamp,
    requestId: ctx?.requestId,
  };

  // If no admin auth configured or request is not authorized, return minimal info
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json(publicResponse);
  }

  // Authenticated: include detailed configuration
  const embeddingMode = getEmbeddingMode();
  const embeddingWarning =
    embeddingMode !== 'remote'
      ? 'No real embedding endpoint configured. Set COMPOUND_EMBEDDING_API_KEY (and optionally COMPOUND_EMBEDDING_API_URL) to enable semantic vector retrieval; otherwise queries fall back to FTS-only.'
      : null;

  return NextResponse.json({
    ...publicResponse,
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
