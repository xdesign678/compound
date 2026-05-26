import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { listCategoryWikiRuns } from '@/lib/category-wiki-worker';
import { logger } from '@/lib/logging';

export const runtime = 'nodejs';

/**
 * GET /api/wiki/category/runs?primary=X&secondary=Y&limit=20
 * Returns the most recent generation runs for a category wiki, used to render
 * the update-history list at the bottom of the wiki detail page.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const primary = url.searchParams.get('primary')?.trim();
  const secondary = url.searchParams.get('secondary')?.trim();
  const limitParam = url.searchParams.get('limit');

  if (!primary || !secondary) {
    return NextResponse.json(
      { error: 'primary and secondary query params are required' },
      { status: 400 },
    );
  }

  const limit = limitParam ? Number.parseInt(limitParam, 10) : 20;

  try {
    const runs = listCategoryWikiRuns(primary, secondary, Number.isFinite(limit) ? limit : 20);
    return NextResponse.json({ runs });
  } catch (error) {
    logger.error('wiki.category_runs_list_failed', {
      primary,
      secondary,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to list category wiki runs' }, { status: 500 });
  }
}
