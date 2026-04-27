import { NextResponse } from 'next/server';
import { logger } from '@/lib/logging';
import { requireAdmin } from '@/lib/server-auth';
import { wikiRepo } from '@/lib/wiki-db';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const result = wikiRepo.rebuildAllIndexes();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    logger.error('wiki.rebuild_index_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Wiki index rebuild failed' }, { status: 500 });
  }
}
