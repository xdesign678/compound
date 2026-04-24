import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { runAnalysisWorkerOnce, startAnalysisWorker } from '@/lib/analysis-worker';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    startAnalysisWorker('manual');
    return NextResponse.json({ started: true });
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
