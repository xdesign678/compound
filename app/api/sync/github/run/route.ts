import { NextResponse } from 'next/server';
import { startGithubSync } from '@/lib/github-sync-runner';
import { requireAdmin } from '@/lib/server-auth';
import { syncRateLimit } from '@/lib/rate-limit';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';

export const runtime = 'nodejs';
// Background loop stays alive beyond this — we respond immediately.
export const maxDuration = 30;

/**
 * POST /api/sync/github/run
 * Starts a server-side GitHub → SQLite sync job and returns the job id.
 * The actual work runs in the background; client polls `/api/sync/status`.
 */
export const POST = withRequestTracing(async (req: Request) => {
  const denied = requireAdmin(req) || syncRateLimit(req);
  if (denied) return denied;

  try {
    const result = startGithubSync();
    logger.info('sync.github.started', {
      jobId: result.jobId,
      existing: !!result.existing,
      recoveredJobs: result.recoveredJobs ?? 0,
      recoveredAnalysis: result.recoveredAnalysis ?? 0,
    });
    return NextResponse.json({
      jobId: result.jobId,
      existing: !!result.existing,
      recoveredJobs: result.recoveredJobs ?? 0,
      recoveredAnalysis: result.recoveredAnalysis ?? 0,
      workerStarted: !!result.workerStarted,
      message: result.existing
        ? '已有同步任务在运行，已尝试唤醒后台 worker。'
        : '已启动新的同步任务。',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('sync.github.run.failed', { error: message });
    return NextResponse.json(
      { error: message, requestId: getRequestContext()?.requestId },
      { status: 500 },
    );
  }
});
