import { NextResponse } from 'next/server';
import { analyzeLintConcepts } from '@/lib/lint-worker';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
  readLlmConfigOverride,
} from '@/lib/request-guards';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';
import type { LintRequest, LintResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BODY_BYTES = 512_000;
const MAX_CONCEPTS = 500;

/**
 * Run an LLM-driven consistency lint over a snapshot of the Wiki concept
 * index. Produces `findings`: structured issues such as duplicate concepts,
 * orphaned relations, or category drift. Results are filtered so each
 * finding only references concept ids that exist in the request.
 *
 * Body: `LintRequest` — `concepts: Array<{ id, title, summary, related }>`
 * (<= 500). An empty array short-circuits to `{ findings: [] }`.
 *
 * Guards: admin token, LLM rate limit, 512KB body cap.
 */
export const POST = withRequestTracing(async (req: Request) => {
  const denied =
    requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = await readJsonWithLimit<LintRequest>(req, MAX_BODY_BYTES);
    if (!Array.isArray(body?.concepts)) {
      return NextResponse.json({ error: 'concepts must be an array' }, { status: 400 });
    }
    if (body.concepts.length === 0) {
      return NextResponse.json({ findings: [] });
    }
    if (body.concepts.length > MAX_CONCEPTS) {
      return NextResponse.json({ error: 'Too many concepts' }, { status: 400 });
    }

    const llmConfig = readLlmConfigOverride(req, body);
    const parsed: LintResponse = { findings: await analyzeLintConcepts(body.concepts, llmConfig) };

    const validIds = new Set(body.concepts.map((c) => c.id));
    parsed.findings = parsed.findings.filter((f) => {
      f.conceptIds = (f.conceptIds || []).filter((id) => validIds.has(id));
      return f.conceptIds.length > 0;
    });

    return NextResponse.json(parsed);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    logger.error('lint.failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      {
        error: 'Lint processing failed. Please check your API configuration.',
        requestId: getRequestContext()?.requestId,
      },
      { status: 500 },
    );
  }
});
