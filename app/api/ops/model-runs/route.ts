import { NextResponse } from 'next/server';
import { getModelRunUsageSummary } from '@/lib/model-runs';
import { requireAdmin } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * GET /api/ops/model-runs?days=14
 * Returns aggregated LLM run telemetry: token totals, provider-reported cost,
 * latency by model/task, daily spend, and recent failure markers.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const days = Number(url.searchParams.get('days') || 14);
  return NextResponse.json(getModelRunUsageSummary(days));
}
