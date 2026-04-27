import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import { enforceContentLength } from '@/lib/request-guards';
import { createRepairRun, startRepairWorker, type RepairFindingInput } from '@/lib/repair-worker';

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
    const body = (await req.json()) as RepairRunRequest;
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
    console.error('[repair/run] error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Failed to start repair run' }, { status: 500 });
  }
}
