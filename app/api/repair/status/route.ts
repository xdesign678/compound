import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import {
  getRepairRunStatus,
  resumePendingRepairRuns,
  startRepairWorker,
} from '@/lib/repair-worker';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId');
  if (!runId) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 });
  }

  // If the Node process restarted mid-run the worker loop is gone. Revive it.
  resumePendingRepairRuns();

  const status = getRepairRunStatus(runId);
  if (!status) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }
  // Ensure the worker is running for still-active runs (cheap idempotent call).
  if (status.status === 'running') startRepairWorker(runId);
  return NextResponse.json(status);
}
