import { NextResponse } from 'next/server';
import { repo } from '@/lib/server-db';

export const runtime = 'nodejs';
export const maxDuration = 30;

function parseSinceParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

/**
 * GET /api/data/snapshot
 * Returns either the summary dataset or an incremental delta since `?since=...`.
 * Full concept bodies / source raw content are fetched on demand by detail views
 * and heavy workflows such as ask / categorize.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const since = parseSinceParam(url.searchParams.get('since'));
    const fetchedAt = Date.now();
    const range = { after: since ?? undefined, before: fetchedAt };

    const sources = since
      ? repo.listSources({ ...range, summariesOnly: true })
      : repo.listSources({ before: fetchedAt, summariesOnly: true });
    const concepts = since
      ? repo.listConcepts({ ...range, summariesOnly: true })
      : repo.listConcepts({ before: fetchedAt, summariesOnly: true });
    const activity = since
      ? repo.listActivity(range)
      : repo.listActivity({ before: fetchedAt, limit: 1000 });
    const ask = since
      ? repo.listAskHistory(range)
      : repo.listAskHistory({ before: fetchedAt, limit: 500 });

    return NextResponse.json({
      fetchedAt,
      mode: since ? 'delta' : 'full',
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
    console.error('[data/snapshot] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
