import { NextResponse } from 'next/server';
import { isRequestBodyTooLargeError, readJsonWithLimit } from '@/lib/request-guards';
import { requireAdmin } from '@/lib/server-auth';
import { reopenReviewItem, resolveReviewItem } from '@/lib/review-queue';

export const runtime = 'nodejs';
export const maxDuration = 10;
const MAX_BODY_BYTES = 64_000;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await readJsonWithLimit<Record<string, unknown>>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    body = {};
  }
  if (body.status === 'open') {
    const item = reopenReviewItem(id, body.resolution);
    if (!item) return NextResponse.json({ error: 'review item not found' }, { status: 404 });
    return NextResponse.json({ item });
  }
  const status =
    body.status === 'approved' || body.status === 'rejected' || body.status === 'resolved'
      ? body.status
      : 'resolved';
  const item = resolveReviewItem(id, status, body.resolution);
  if (!item) return NextResponse.json({ error: 'review item not found' }, { status: 404 });
  return NextResponse.json({ item });
}
