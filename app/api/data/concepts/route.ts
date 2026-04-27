import { NextResponse } from 'next/server';
import { repo } from '@/lib/server-db';
import { requireAdmin } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_IDS = 200;

function parseIdsParam(value: string | null): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * GET /api/data/concepts?ids=c-1,c-2
 * Returns full concept documents for on-demand hydration.
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
    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        { error: `Too many ids (max ${MAX_IDS})`, received: ids.length, max: MAX_IDS },
        { status: 413 },
      );
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
