import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { getCategoryWikiRunStatus } from '@/lib/category-wiki-worker';
import { logger } from '@/lib/logging';

export const runtime = 'nodejs';

/**
 * GET /api/wiki/category/runs/:id
 * Returns the status of a category wiki generation run.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(_req);
  if (denied) return denied;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'run id is required' }, { status: 400 });
  }

  try {
    const status = getCategoryWikiRunStatus(id);
    if (!status) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    return NextResponse.json(status);
  } catch (error) {
    logger.error('wiki.category_run_status_failed', {
      runId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to get run status' }, { status: 500 });
  }
}
