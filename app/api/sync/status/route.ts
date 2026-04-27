import { NextResponse } from 'next/server';
import { getSyncJobStatus } from '@/lib/github-sync-runner';
import { requireAdmin } from '@/lib/server-auth';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * GET /api/sync/status?jobId=xxx
 * Returns the latest status for a sync job (polled by the client every 1-2s).
 */
export const GET = withRequestTracing(async (req: Request) => {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get('jobId')?.trim();
    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }
    const status = getSyncJobStatus(jobId);
    if (!status) {
      return NextResponse.json({ error: 'job not found' }, { status: 404 });
    }
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('sync.status.failed', { error: message });
    return NextResponse.json(
      { error: message, requestId: getRequestContext()?.requestId },
      { status: 500 }
    );
  }
});
