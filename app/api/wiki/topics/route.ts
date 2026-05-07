import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { listWikiTopicSummaries } from '@/lib/wiki-topics';

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * GET /api/wiki/topics?limit=50
 * Returns lightweight topic/community summaries derived from source analysis
 * topics and entities, with related concept candidates for each topic.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') || 50);
  return NextResponse.json({ topics: listWikiTopicSummaries(limit) });
}
