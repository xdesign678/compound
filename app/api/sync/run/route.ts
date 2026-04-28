import { NextResponse } from 'next/server';
import { startGithubSync } from '@/lib/github-sync-runner';
import { retryAnalysisJobs, startAnalysisWorker } from '@/lib/analysis-worker';
import { requireAdmin } from '@/lib/server-auth';
import { syncRateLimit } from '@/lib/rate-limit';
import { syncObs } from '@/lib/sync-observability';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/sync/run
 *
 * One-button entrypoint used by the V3 console. Delegates to the existing
 * primitives so the user does not have to choose between "sync" / "worker" /
 * "retry":
 *
 *   1. start a new GitHub sync run (or wake the existing one)
 *   2. retry any previously failed analysis jobs
 *   3. wake the analysis worker
 *
 * The legacy `/api/sync/github/run`, `/api/sync/worker`, and `/api/sync/retry`
 * routes stay around so the advanced drawer can still trigger them
 * individually.
 *
 * Guards: admin token + sync rate-limit.
 */
export const POST = withRequestTracing(async (req: Request) => {
  const denied = requireAdmin(req) || syncRateLimit(req);
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => ({}))) as { force?: boolean };
    const force = Boolean(body?.force);

    const sync = startGithubSync({ force });

    let retried = 0;
    try {
      retried = retryAnalysisJobs({});
    } catch (err) {
      logger.warn('sync.run.retry_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const worker = startAnalysisWorker(sync.existing ? 'sync-run-existing' : 'sync-run-fresh');

    const messageParts: string[] = [];
    messageParts.push(sync.existing ? '已有同步任务在运行' : '已启动新的同步任务');
    if (retried > 0) messageParts.push(`重新加入 ${retried} 个失败任务`);
    if (worker.started) messageParts.push(`唤醒 worker（队列 ${worker.queued}）`);
    else if (worker.recovered > 0) messageParts.push(`回收孤儿任务 ${worker.recovered}`);

    syncObs.recordEvent({
      runId: sync.runId ?? null,
      stage: null,
      level: 'info',
      message: `「立即同步」: ${messageParts.join(' · ')}`,
    });

    logger.info('sync.run.merged', {
      jobId: sync.jobId,
      existing: !!sync.existing,
      retried,
      workerStarted: !!worker.started,
      workerQueued: worker.queued,
    });

    return NextResponse.json({
      jobId: sync.jobId,
      runId: sync.runId ?? null,
      existing: !!sync.existing,
      recoveredJobs: sync.recoveredJobs ?? 0,
      recoveredAnalysis: sync.recoveredAnalysis ?? 0,
      retriedFailures: retried,
      worker: {
        started: !!worker.started,
        queued: worker.queued,
        activeWorkers: worker.activeWorkers,
        recovered: worker.recovered,
      },
      message: messageParts.join(' · '),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('sync.run.failed', { error: message });
    return NextResponse.json(
      { error: message, requestId: getRequestContext()?.requestId },
      { status: 500 },
    );
  }
});
