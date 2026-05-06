import { NextResponse } from 'next/server';
import { logger } from '@/lib/logging';
import { repo } from '@/lib/server-db';
import { requireAdmin } from '@/lib/server-auth';

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
    const fetchedAt = Date.now();
    const range = { after: since ?? undefined, before: fetchedAt };

    let sources = since
      ? repo.listSources({ ...range, summariesOnly: true })
      : repo.listSources({ before: fetchedAt, summariesOnly: true });
    let concepts = since
      ? repo.listConcepts({ ...range, summariesOnly: true })
      : repo.listConcepts({ before: fetchedAt, summariesOnly: true });
    const activity = since
      ? repo.listActivity(range)
      : repo.listActivity({ before: fetchedAt, limit: 1000 });
    const ask = since
      ? repo.listAskHistory(range)
      : repo.listAskHistory({ before: fetchedAt, limit: 500 });

    // Apply pagination to sources and concepts in full mode
    const totalSources = sources.length;
    const totalConcepts = concepts.length;
    sources = sources.slice(offset, offset + limit);
    concepts = concepts.slice(offset, offset + limit);

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
