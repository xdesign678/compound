import { NextResponse } from 'next/server';
import {
  isAdminAuthConfigured,
  isAuthorizedRequest,
  shouldEnforceAdminAuth,
} from '@/lib/server-auth';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { getEmbeddingMode } from '@/lib/embedding';
import { getModelForTask } from '@/lib/model-history';

export const runtime = 'nodejs';

function cleanEnv(value: string | undefined): string {
  return value?.replace(/^["'\s]+|["'\s]+$/g, '') || '';
}

function envSource(names: string[]): string | null {
  return names.find((name) => Boolean(cleanEnv(process.env[name]))) ?? null;
}

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
      configured: Boolean(envSource(['LLM_API_KEY', 'AI_GATEWAY_API_KEY'])),
      keySource: envSource(['LLM_API_KEY', 'AI_GATEWAY_API_KEY']),
      urlSource: envSource(['LLM_API_URL', 'AI_GATEWAY_URL']) ?? 'default',
      model: getModelForTask('ingest'),
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
