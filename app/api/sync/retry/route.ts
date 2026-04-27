import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { retryAnalysisJobs, startAnalysisWorker } from '@/lib/analysis-worker';
import { syncObs } from '@/lib/sync-observability';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { runId?: string; itemId?: string };
    const retried = retryAnalysisJobs({
      runId: body.runId || undefined,
      itemId: body.itemId || undefined,
    });
    syncObs.recordEvent({
      runId: body.runId,
      itemId: body.itemId,
      stage: 'llm',
      message: `手动重试 ${retried} 个分析任务`,
    });
    const workerInfo = startAnalysisWorker('manual-retry');
    return NextResponse.json({
      retried,
      workerStarted: workerInfo.started,
      activeWorkers: workerInfo.activeWorkers,
      queued: workerInfo.queued,
      recovered: workerInfo.recovered,
      message:
        retried > 0
          ? `已把 ${retried} 个失败任务重新加入队列。${workerInfo.started ? '已启动新的 worker。' : ''}`
          : '没有需要重试的任务。',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
