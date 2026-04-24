import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { listReviewItems, createReviewItem, getReviewMetrics } from '@/lib/review-queue';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const status = (url.searchParams.get('status') || 'open') as 'open' | 'all';
  const limit = Number(url.searchParams.get('limit') || 100);
  return NextResponse.json({ items: listReviewItems({ status, limit }), metrics: getReviewMetrics() });
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const id = createReviewItem({
    kind: body.kind || 'manual',
    title: body.title || 'Manual review item',
    targetType: body.targetType,
    targetId: body.targetId,
    sourceId: body.sourceId,
    confidence: typeof body.confidence === 'number' ? body.confidence : null,
    payload: body.payload,
  });
  return NextResponse.json({ id });
}
