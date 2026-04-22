import { NextResponse } from 'next/server';
import { repo } from '@/lib/server-db';
import { requireAdmin } from '@/lib/server-auth';

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
 * GET /api/data/sources?ids=s-1,s-2
 * Returns full source documents for on-demand hydration.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const ids = parseIdsParam(url.searchParams.get('ids'));
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids is required' }, { status: 400 });
    }

    return NextResponse.json({
      sources: repo.getSourcesByIds(ids),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[data/sources] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
