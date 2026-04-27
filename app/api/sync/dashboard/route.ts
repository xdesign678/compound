import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { syncObs } from '@/lib/sync-observability';
import { getEmbeddingMetrics } from '@/lib/embedding';
import { getReviewMetrics } from '@/lib/review-queue';
import { startAnalysisWorker } from '@/lib/analysis-worker';

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * Aggregate dashboard payload for the `/sync` page. Starts the analysis
 * worker on-demand, then returns the live sync observability snapshot
 * merged with embedding coverage and review-queue metrics.
 *
 * Guards: admin token.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    startAnalysisWorker('dashboard-poll');
    const dashboard = syncObs.getDashboard();
    return NextResponse.json({
      ...dashboard,
      coverage: {
        ...dashboard.coverage,
        ...getEmbeddingMetrics(),
        ...getReviewMetrics(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync/dashboard] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
