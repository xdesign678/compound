import { NextResponse } from 'next/server';
import { isRequestBodyTooLargeError, readJsonWithLimit } from '@/lib/request-guards';
import { requireAdmin } from '@/lib/server-auth';
import {
  listReviewItems,
  createReviewItem,
  getReviewMetrics,
  isReviewKind,
} from '@/lib/review-queue';

export const runtime = 'nodejs';
export const maxDuration = 10;
const MAX_BODY_BYTES = 64_000;

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const status = (url.searchParams.get('status') || 'open') as 'open' | 'all';
  const limit = Number(url.searchParams.get('limit') || 100);
  return NextResponse.json({
    items: listReviewItems({ status, limit }),
    metrics: getReviewMetrics(),
  });
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await readJsonWithLimit<Record<string, unknown>>(req, MAX_BODY_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    body = {};
  }

  // Validate required fields
  if (!body.targetType || typeof body.targetType !== 'string') {
    return NextResponse.json(
      { error: 'targetType is required and must be a string' },
      { status: 400 },
    );
  }
  if (!body.targetId || typeof body.targetId !== 'string') {
    return NextResponse.json(
      { error: 'targetId is required and must be a string' },
      { status: 400 },
    );
  }

  const kind = body.kind === undefined ? 'manual' : body.kind;
  if (!isReviewKind(kind)) {
    return NextResponse.json({ error: 'kind is invalid' }, { status: 400 });
  }
  const title =
    typeof body.title === 'string' && body.title.trim() ? body.title : 'Manual review item';
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId : null;

  const id = createReviewItem({
    kind,
    title,
    targetType: body.targetType,
    targetId: body.targetId,
    sourceId,
    confidence: typeof body.confidence === 'number' ? body.confidence : null,
    payload: body.payload,
  });
  return NextResponse.json({ id });
}
