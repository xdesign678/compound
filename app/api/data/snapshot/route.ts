import { NextResponse } from 'next/server';
import { repo } from '@/lib/server-db';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/data/snapshot
 * Returns the full dataset (sources + concepts + activity + ask history) as JSON.
 * The client pulls this on startup and merges into IndexedDB so all browsers
 * share the same view.
 */
export async function GET() {
  try {
    const sources = repo.listSources();
    const concepts = repo.listConcepts();
    const activity = repo.listActivity(1000);
    const ask = repo.listAskHistory(500);

    return NextResponse.json({
      fetchedAt: Date.now(),
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
