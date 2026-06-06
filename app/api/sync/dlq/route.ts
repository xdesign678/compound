import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { deleteAnalysisJob, retryAnalysisJobs, startAnalysisWorker } from '@/lib/analysis-worker';
import { requireAdmin } from '@/lib/server-auth';
import { syncObs } from '@/lib/sync-observability';

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * Retry or delete one analysis dead-letter job from the `/sync` advanced
 * drawer.
 *
 * Guards: admin token.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: 'retry' | 'delete';
      jobId?: string;
    };
    const jobId = body.jobId?.trim();
    if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
    if (body.action !== 'retry' && body.action !== 'delete') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    if (body.action === 'delete') {
      const deleted = deleteAnalysisJob({ jobId });
      syncObs.recordEvent({
        stage: 'llm',
        message: `删除死信任务 ${deleted} 个`,
        meta: { event: 'analysis.dlq_deleted', jobId, deleted },
      });
      return NextResponse.json({
        deleted,
        message: deleted > 0 ? '已删除死信任务。' : '没有找到可删除的死信任务。',
      });
    }

    const retried = retryAnalysisJobs({ jobId });
    const workerInfo = startAnalysisWorker('dlq-retry');
    syncObs.recordEvent({
      stage: 'llm',
      message: `重试死信任务 ${retried} 个`,
      meta: { event: 'analysis.dlq_retried', jobId, retried },
    });
    return NextResponse.json({
      retried,
      workerStarted: workerInfo.started,
      activeWorkers: workerInfo.activeWorkers,
      queued: workerInfo.queued,
      message: retried > 0 ? '已把死信任务重新加入队列。' : '没有找到可重试的死信任务。',
    });
  } catch (err) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'sync.dlq.failed'), { status: 500 });
  }
}
