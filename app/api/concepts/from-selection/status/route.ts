import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import {
  getSelectionWikiRunStatus,
  resumePendingSelectionWikiRuns,
  startSelectionWikiWorker,
} from '@/lib/selection-wiki-worker';

export const runtime = 'nodejs';

/**
 * Poll the status of a server-side selection-to-Wiki run.
 *
 * Query: `?runId=<id>`
 * Returns the current phase, error (if any), and final `SelectionWikiResponse`
 * once the run is done. The route also revives still-running jobs if the server
 * lost its in-memory worker reference after a restart.
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

  resumePendingSelectionWikiRuns();

  const status = getSelectionWikiRunStatus(runId);
  if (!status) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }
  if (status.status === 'running') startSelectionWikiWorker(runId);
  return NextResponse.json(status);
}
