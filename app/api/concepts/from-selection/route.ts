import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import { enforceContentLength, readLlmConfigOverride } from '@/lib/request-guards';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';
import {
  createSelectionWikiRun,
  getSelectionWikiRunStart,
  SelectionWikiValidationError,
  startSelectionWikiWorker,
} from '@/lib/selection-wiki-worker';
import type { SelectionWikiRequest, SelectionWikiRunStartResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BODY_BYTES = 256_000;

/**
 * Start a server-side Wiki creation run from a free-form text selection. The
 * API returns quickly with a `runId`; the LLM work and SQLite writes continue
 * in the server process so the browser can close or reload without losing the
 * creation job.
 *
 * Body: `SelectionWikiRequest` — `selection` is required (>= 2, <= 4k chars).
 * Optional `sourceConceptId` links the new page back to the page the snippet
 * came from; `contextTitle` gives the worker extra grounding. Poll
 * `/api/concepts/from-selection/status?runId=<id>` for progress and result.
 *
 * Guards: admin token, LLM rate limit, 256KB body cap.
 */
export const POST = withRequestTracing(async (req: Request) => {
  const denied =
    requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = (await req.json()) as SelectionWikiRequest;
    const llmConfig = readLlmConfigOverride(req, body);
    const runId = createSelectionWikiRun(body);
    startSelectionWikiWorker(runId, llmConfig);
    const run = getSelectionWikiRunStart(runId);
    if (!run) throw new Error('selection wiki run was not created');
    return NextResponse.json<SelectionWikiRunStartResponse>(run);
  } catch (err) {
    if (err instanceof SelectionWikiValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error('selection_wiki.run_start_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: '选段建页启动失败，请检查 API 配置或稍后重试。',
        requestId: getRequestContext()?.requestId,
      },
      { status: 500 },
    );
  }
});
