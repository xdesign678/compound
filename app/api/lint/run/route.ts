import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
  readLlmConfigOverride,
} from '@/lib/request-guards';
import { createLintRun, startLintWorker } from '@/lib/lint-worker';
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
    let body: { llmConfig?: LlmConfig } = {};
    try {
      body = await readJsonWithLimit(req, MAX_BODY_BYTES);
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) throw error;
    }
    const llmConfig = readLlmConfigOverride(req, body);
    const runId = createLintRun();
    startLintWorker(runId, llmConfig);
    return NextResponse.json({ runId, ok: true });
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'lint.run_start_failed'), { status: 500 });
  }
}
