import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/server-auth';
import { retryAnalysisJobs, startAnalysisWorker } from '@/lib/analysis-worker';
import { syncObs } from '@/lib/sync-observability';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';

export const runtime = 'nodejs';
export const maxDuration = 10;
const MAX_BODY_BYTES = 4_000;

export async function POST(req: Request) {
  const denied = requireAdmin(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;
  try {
    let body: { runId?: string; itemId?: string } = {};
    try {
      body = await readJsonWithLimit(req, MAX_BODY_BYTES);
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) throw error;
    }
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
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'sync.retry.failed'), { status: 500 });
  }
}
