import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { logger } from '@/lib/logging';
import { repo } from '@/lib/server-db';
import { requireAdmin } from '@/lib/server-auth';
import { autoQueueCategoryWikis } from '@/lib/category-wiki-worker';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_LIMIT = 5000;
const DEFAULT_LIMIT = 5000;

function parseCursorParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
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
 * Returns a stable full snapshot or an incremental change delta after `?cursor=...`.
 * Full snapshots use `?beforeCursor=...` for stable pagination and return the
 * authoritative cursor that clients persist for the next pull.
 * Supports `?limit=N&offset=M` for pagination (defaults: limit=5000, offset=0).
 * Full concept bodies / source raw content are fetched on demand by detail views
 * and heavy workflows such as ask / categorize.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const cursor = parseCursorParam(url.searchParams.get('cursor'));
    const limit = parseIntParam(url.searchParams.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
    const offset = parseIntParam(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    const latestCursor = repo.getLatestSyncCursor();
    const cursorFloor = repo.getSyncCursorFloor();
    const requestedUpperCursor = parseCursorParam(url.searchParams.get('beforeCursor'));
    const upperCursor = Math.min(requestedUpperCursor ?? latestCursor, latestCursor);

    const deltaCursor =
      cursor !== null && cursor >= cursorFloor && cursor <= latestCursor ? cursor : null;

    if (deltaCursor !== null) {
      const changes = repo.listSyncChanges({ after: deltaCursor, before: upperCursor, limit });
      const latestByEntity = new Map<string, (typeof changes)[number]>();
      for (const change of changes) {
        latestByEntity.set(`${change.entityType}:${change.entityId}`, change);
      }

      const upsertIds = {
        source: [] as string[],
        concept: [] as string[],
        activity: [] as string[],
        ask: [] as string[],
      };
      const deleted = {
        sources: [] as string[],
        concepts: [] as string[],
        activity: [] as string[],
        ask: [] as string[],
      };
      for (const change of latestByEntity.values()) {
        if (change.operation === 'upsert') {
          upsertIds[change.entityType].push(change.entityId);
          continue;
        }
        if (change.entityType === 'source') deleted.sources.push(change.entityId);
        if (change.entityType === 'concept') deleted.concepts.push(change.entityId);
        if (change.entityType === 'activity') deleted.activity.push(change.entityId);
        if (change.entityType === 'ask') deleted.ask.push(change.entityId);
      }

      const sources = repo.getSourcesByIds(upsertIds.source, { summariesOnly: true });
      const concepts = repo.getConceptsByIds(upsertIds.concept, { summariesOnly: true });
      const activity = repo.getActivityByIds(upsertIds.activity);
      const ask = repo.getAskHistoryByIds(upsertIds.ask);
      const nextCursor = changes.at(-1)?.seq ?? upperCursor;

      return NextResponse.json({
        fetchedAt: Date.now(),
        mode: 'delta',
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
        sync: {
          cursor: nextCursor,
          upperCursor,
          hasMore: nextCursor < upperCursor,
          deleted,
        },
      });
    }

    const sourceIds = repo.listEntityIdsAtSyncCursor('source', upperCursor, { limit, offset });
    const conceptIds = repo.listEntityIdsAtSyncCursor('concept', upperCursor, { limit, offset });
    const activityIds =
      offset === 0
        ? repo.listEntityIdsAtSyncCursor('activity', upperCursor, { limit: 1000, offset: 0 })
        : [];
    const askIds =
      offset === 0
        ? repo.listEntityIdsAtSyncCursor('ask', upperCursor, { limit: 500, offset: 0 })
        : [];
    const sources = repo.getSourcesByIds(sourceIds, { summariesOnly: true });
    const concepts = repo.getConceptsByIds(conceptIds, { summariesOnly: true });
    const activity = repo.getActivityByIds(activityIds);
    const ask = repo.getAskHistoryByIds(askIds);
    const totalSources = repo.countEntityIdsAtSyncCursor('source', upperCursor);
    const totalConcepts = repo.countEntityIdsAtSyncCursor('concept', upperCursor);

    try {
      const categoryWikiQueue = offset === 0 ? autoQueueCategoryWikis() : null;
      if (categoryWikiQueue && categoryWikiQueue.queued > 0) {
        logger.info('data.snapshot_category_wiki_auto_queued', { ...categoryWikiQueue });
      }
    } catch (error) {
      logger.warn('data.snapshot_category_wiki_auto_queue_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json({
      fetchedAt: Date.now(),
      mode: 'full',
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
      sync: {
        cursor: upperCursor,
        upperCursor,
        hasMore: offset + limit < totalSources || offset + limit < totalConcepts,
        deleted: { sources: [], concepts: [], activity: [], ask: [] },
      },
    });
  } catch (err) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'data.snapshot_failed'), { status: 500 });
  }
}
