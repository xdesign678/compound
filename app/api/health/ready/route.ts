import { NextResponse } from 'next/server';
import { inspectLocalBackupStatus } from '@/lib/backup-status';
import { isProcessReady } from '@/lib/process-readiness';
import { repo } from '@/lib/server-db';
import { logger } from '@/lib/logging';

export const runtime = 'nodejs';

/**
 * GET /api/health/ready
 * Readiness probe. Public body is only `{ status, probe }`. Detailed failure
 * reasons are written to authenticated logs, not the response.
 */
export async function GET() {
  if (!isProcessReady()) {
    return NextResponse.json({ status: 'not_ready', probe: 'ready' }, { status: 503 });
  }

  try {
    const identity = repo.getDatasetIdentity();
    repo.getLatestSyncCursor();
    if (!identity.datasetId) throw new Error('dataset identity missing');
    inspectLocalBackupStatus();
    return NextResponse.json({ status: 'ok', probe: 'ready' });
  } catch (error) {
    logger.error('health.ready_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ status: 'not_ready', probe: 'ready' }, { status: 503 });
  }
}
