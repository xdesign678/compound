import { NextResponse } from 'next/server';
import { logger } from '@/lib/logging';
import { repo } from '@/lib/server-db';
import { requireAdmin } from '@/lib/server-auth';
import { autoQueueCategoryWikis } from '@/lib/category-wiki-worker';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_LIMIT = 5000;
const DEFAULT_LIMIT = 5000;

function parseSinceParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function parseIntParam(value: string | null, defaultVal: number, max: number): number {
  if (!value) return defaultVal;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return defaultVal;
  return Math.min(Math.trunc(parsed), max);
}

/**
 * GET /api/data/snapshot
 * Returns either the summary dataset or an incremental delta since `?since=...`.
 * Supports `?limit=N&offset=M` for pagination (defaults: limit=5000, offset=0).
 * Full concept bodies / source raw content are fetched on demand by detail views
 * and heavy workflows such as ask / categorize.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const since = parseSinceParam(url.searchParams.get('since'));
    const limit = parseIntParam(url.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parseIntParam(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    const requestedBefore = parseSinceParam(url.searchParams.get('before'));
    const fetchedAt = requestedBefore ?? Date.now();
    const range = { after: since ?? undefined, before: fetchedAt };

    const recordRange = since ? range : { before: fetchedAt };
    const sources = repo.listSources({
      ...recordRange,
      summariesOnly: true,
      limit,
      offset,
    });
    const concepts = repo.listConcepts({
      ...recordRange,
      summariesOnly: true,
      limit,
      offset,
    });
    const activity = since
      ? repo.listActivity(range)
      : repo.listActivity({ before: fetchedAt, limit: 1000 });
    const ask = since
      ? repo.listAskHistory(range)
      : repo.listAskHistory({ before: fetchedAt, limit: 500 });

    const totalSources = repo.countSources(recordRange);
    const totalConcepts = repo.countConcepts(recordRange);

    try {
      const categoryWikiQueue = autoQueueCategoryWikis();
      if (categoryWikiQueue.queued > 0) {
        logger.info('data.snapshot_category_wiki_auto_queued', { ...categoryWikiQueue });
      }
    } catch (error) {
      logger.warn('data.snapshot_category_wiki_auto_queue_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json({
      fetchedAt,
      mode: since ? 'delta' : 'full',
      pagination: { limit, offset, totalSources, totalConcepts },
      counts: {
        sources: sources.length,
        concepts: concepts.length,
        activity: activity.length,
        ask: ask.length,
      },
      sources,
      concepts,
      activity,
      ask,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('data.snapshot_failed', { error: message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
