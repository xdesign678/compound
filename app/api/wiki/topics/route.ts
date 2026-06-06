import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { clampLimit, MAX_TOPIC_LIMIT } from '@/lib/clamp';
import { listWikiTopicSummaries } from '@/lib/wiki-topics';

export const runtime = 'nodejs';
export const maxDuration = 10;

const DEFAULT_TOPIC_LIMIT = 50;

/**
 * GET /api/wiki/topics?limit=50
 * Returns lightweight topic/community summaries derived from source analysis
 * topics and entities, with related concept candidates for each topic.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit ? clampLimit(rawLimit, MAX_TOPIC_LIMIT) : DEFAULT_TOPIC_LIMIT;
  if (limit === undefined) {
    return NextResponse.json(
      { error: 'limit must be a positive integer (1–200)' },
      { status: 400 },
    );
  }
  return NextResponse.json({ topics: listWikiTopicSummaries(limit) });
}
