import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';
import { createRepairRun, startRepairWorker, type RepairFindingInput } from '@/lib/repair-worker';
import { logger } from '@/lib/logging';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BODY_BYTES = 128_000;

interface RepairRunRequest {
  findings: RepairFindingInput[];
}

export async function POST(req: Request) {
  const denied =
    requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = await readJsonWithLimit<RepairRunRequest>(req, MAX_BODY_BYTES);
    if (!Array.isArray(body?.findings)) {
      return NextResponse.json({ error: 'findings must be an array' }, { status: 400 });
    }
    const { runId, total, dropped } = createRepairRun(body.findings);
    if (total === 0) {
      return NextResponse.json({ runId: null, total: 0, dropped: 0, ok: true });
    }
    startRepairWorker(runId);
    return NextResponse.json({ runId, total, dropped, ok: true });
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'repair.run_start_failed'), { status: 500 });
  }
}
