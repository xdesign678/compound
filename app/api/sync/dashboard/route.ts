import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/server-auth';
import { syncObs } from '@/lib/sync-observability';
import { getEmbeddingMetrics } from '@/lib/embedding';
import { getReviewMetrics } from '@/lib/review-queue';
import { getAnalysisWorkerPoolStats, startAnalysisWorker } from '@/lib/analysis-worker';
import { getBackgroundLlmBudgetStats, getLlmBudgetStats } from '@/lib/llm-budgets';
import { deriveStory } from '@/lib/sync-narrative';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';

export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * Aggregate dashboard payload for the `/sync` page. Starts the analysis
 * worker on-demand, then returns the live sync observability snapshot
 * merged with embedding coverage and review-queue metrics, plus the
 * `story` block (narrative / phases / health / lastRun) used by the
 * V3 console for a single-glance summary.
 *
 * Guards: admin token.
 */
export const GET = withRequestTracing(async (req: Request) => {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    startAnalysisWorker('dashboard-poll');
    const dashboard = syncObs.getDashboard();
    const totalLlmBudget = getBackgroundLlmBudgetStats();
    const workerPools = getAnalysisWorkerPoolStats();
    const githubWorkerPool = workerPools.find((pool) => pool.name === 'github_ingest');
    const postWorkerPool = workerPools.find((pool) => pool.name === 'post_ingest');
    const merged = {
      ...dashboard,
      coverage: {
        ...dashboard.coverage,
        ...getEmbeddingMetrics(),
        ...getReviewMetrics(),
        webhookConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET?.trim()),
        cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
        webhookDeliveriesReceived: dashboard.webhookDeliveryStats.reduce(
          (sum, item) => sum + Number(item.count || 0),
          0,
        ),
        backgroundLlmTotalConcurrency: totalLlmBudget.concurrency,
        backgroundLlmTotalActive: totalLlmBudget.active,
        backgroundLlmTotalPending: totalLlmBudget.pending,
        backgroundLlmIngestConcurrency: getLlmBudgetStats('github_ingest').concurrency,
        backgroundLlmSummaryConcurrency: getLlmBudgetStats('summarize').concurrency,
        backgroundLlmRelationsConcurrency: getLlmBudgetStats('relations').concurrency,
        backgroundLlmContextualConcurrency: getLlmBudgetStats('contextualize').concurrency,
        backgroundLlmEmbeddingConcurrency: getLlmBudgetStats('embedding').concurrency,
        backgroundWorkerGithubCapacity: githubWorkerPool?.maxWorkers ?? 0,
        backgroundWorkerPostCapacity: postWorkerPool?.maxWorkers ?? 0,
        backgroundWorkerActive: workerPools.reduce((sum, pool) => sum + pool.active, 0),
      },
    };
    const story = deriveStory(merged);
    return NextResponse.json({ ...merged, story });
  } catch (err) {
    return NextResponse.json(
      apiError(err, getRequestContext()?.requestId, 'sync.dashboard.failed'),
      { status: 500 },
    );
  }
});
