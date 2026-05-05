import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import { enforceContentLength, readLlmConfigOverride } from '@/lib/request-guards';
import { createLintRun, startLintWorker } from '@/lib/lint-worker';
import { logger } from '@/lib/logging';
import type { LlmConfig } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BODY_BYTES = 16_000;

/**
 * Start an async deep-lint run. The server reads concepts from its own DB,
 * runs LLM analysis in the background, and stores findings. The client polls
 * GET /api/lint/status for progress and results.
 *
 * No request body required — the server uses its own data. Optional `llmConfig`
 * overrides may be sent in headers or the JSON body for the initial worker.
 * Returns `{ runId, ok: true }`.
 *
 * Guards: admin token, LLM rate limit, 16KB body cap.
 */
export async function POST(req: Request) {
  const denied =
    requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => ({}))) as { llmConfig?: LlmConfig };
    const llmConfig = readLlmConfigOverride(req, body);
    const runId = createLintRun();
    startLintWorker(runId, llmConfig);
    return NextResponse.json({ runId, ok: true });
  } catch (err) {
    logger.error('lint.run_start_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to start lint run' }, { status: 500 });
  }
}
