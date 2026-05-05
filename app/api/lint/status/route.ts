import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { getLintRunStatus, resumePendingLintRuns, startLintWorker } from '@/lib/lint-worker';

export const runtime = 'nodejs';

/**
 * Poll the status of an async deep-lint run.
 *
 * Query: `?runId=<id>`
 * Returns: `LintRunStatusResponse` with phase, findings, conceptCount, etc.
 *
 * Also revives any pending lint runs that lost their worker (e.g. server restart).
 *
 * Guards: admin token.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId');
  if (!runId) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 });
  }

  // Revive workers lost after server restart (cheap idempotent call).
  resumePendingLintRuns();

  const status = getLintRunStatus(runId);
  if (!status) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }
  // Ensure the worker is running for still-active runs.
  if (status.status === 'running') startLintWorker(runId);
  return NextResponse.json(status);
}
