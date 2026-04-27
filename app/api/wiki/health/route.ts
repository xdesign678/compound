import { NextResponse } from 'next/server';
import { logger } from '@/lib/logging';
import { requireAdmin } from '@/lib/server-auth';
import { wikiRepo } from '@/lib/wiki-db';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    return NextResponse.json({ ok: true, metrics: wikiRepo.getMetrics() });
  } catch (error) {
    logger.error('wiki.health_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false, error: 'Wiki health check failed' }, { status: 500 });
  }
}
