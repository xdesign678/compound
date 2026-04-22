import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { wikiRepo } from '@/lib/wiki-db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    return NextResponse.json({ ok: true, metrics: wikiRepo.getMetrics() });
  } catch (error) {
    console.error('[wiki/health] error:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: 'Wiki health check failed' }, { status: 500 });
  }
}
