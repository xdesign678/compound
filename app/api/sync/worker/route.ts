import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/server-auth';
import { startAnalysisWorker } from '@/lib/analysis-worker';

export const runtime = 'nodejs';
export const maxDuration = 30;

const REASON_MESSAGES: Record<string, string> = {
  no_queue: '没有待处理的分析任务，worker 未启动。',
  max_workers: '已经达到 worker 并发上限，新任务会自动排队。',
};

/**
 * Start the background analysis worker for queued ingest / embedding /
 * summarize / relation jobs. Requires the standard admin token.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const info = startAnalysisWorker('manual');
    const message = info.started
      ? `已启动 worker（活跃 ${info.activeWorkers}，队列 ${info.queued}${info.recovered > 0 ? `，回收孤儿 ${info.recovered}` : ''}）`
      : (REASON_MESSAGES[info.reason] ?? '未启动新的 worker。') +
        (info.recovered > 0 ? `已回收孤儿任务 ${info.recovered} 个。` : '');
    return NextResponse.json({ ...info, message });
  } catch (err) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'sync.worker.failed'), { status: 500 });
  }
}

/**
 * Deprecated read path. Worker execution mutates queue state, so callers must
 * use POST instead of accidentally triggering work through a link prefetch.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ error: 'Use POST to run the analysis worker.' }, { status: 405 });
}
