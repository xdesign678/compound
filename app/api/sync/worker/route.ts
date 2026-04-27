import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { runAnalysisWorkerOnce, startAnalysisWorker } from '@/lib/analysis-worker';

export const runtime = 'nodejs';
export const maxDuration = 30;

const REASON_MESSAGES: Record<string, string> = {
  no_queue: '没有待处理的分析任务，worker 未启动。',
  max_workers: '已经达到 worker 并发上限，新任务会自动排队。',
};

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
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    return NextResponse.json(await runAnalysisWorkerOnce());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
