import { NextResponse } from 'next/server';
import { repo } from '@/lib/server-db';

export const runtime = 'nodejs';
export const maxDuration = 30;

function parseIdsParam(value: string | null): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ).slice(0, 100);
}

/**
 * GET /api/data/concepts?ids=c-1,c-2
 * Returns full concept documents for on-demand hydration.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const ids = parseIdsParam(url.searchParams.get('ids'));
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids is required' }, { status: 400 });
    }

    return NextResponse.json({
      concepts: repo.getConceptsByIds(ids),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[data/concepts] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
