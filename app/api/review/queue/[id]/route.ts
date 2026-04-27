import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { resolveReviewItem } from '@/lib/review-queue';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const status =
    body.status === 'approved' || body.status === 'rejected' || body.status === 'resolved'
      ? body.status
      : 'resolved';
  const item = resolveReviewItem(id, status, body.resolution);
  if (!item) return NextResponse.json({ error: 'review item not found' }, { status: 404 });
  return NextResponse.json({ item });
}
