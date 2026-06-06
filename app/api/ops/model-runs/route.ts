import { NextResponse } from 'next/server';
import { getModelRunUsageSummary } from '@/lib/model-runs';
import { requireAdmin } from '@/lib/server-auth';
import { parsePositiveInt, MAX_DAYS } from '@/lib/clamp';

export const runtime = 'nodejs';
export const maxDuration = 10;

const DEFAULT_DAYS = 14;

/**
 * GET /api/ops/model-runs?days=14
 * Returns aggregated LLM run telemetry: token totals, provider-reported cost,
 * latency by model/task, daily spend, and recent failure markers.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const rawDays = url.searchParams.get('days');
  const days = rawDays ? parsePositiveInt(rawDays, MAX_DAYS) : DEFAULT_DAYS;
  if (days === undefined) {
    return NextResponse.json({ error: 'days must be a positive integer (1–90)' }, { status: 400 });
  }
  return NextResponse.json(getModelRunUsageSummary(days));
}
