import { requireAdmin } from '@/lib/server-auth';
import { getEmbeddingMetrics } from '@/lib/embedding';
import {
  renderPrometheusMetrics,
  type PrometheusRenderInput,
} from '@/lib/observability/prometheus';
import { getReviewMetrics } from '@/lib/review-queue';
import { withRequestTracing } from '@/lib/request-context';
import { syncObs, type SyncDashboard } from '@/lib/sync-observability';

export const runtime = 'nodejs';
export const maxDuration = 10;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Prometheus-compatible metrics scrape endpoint. Exposes process memory/uptime,
 * HTTP request counters and latency histograms, plus sync, analysis,
 * review-queue, embedding, and knowledge-base gauges for external monitoring
 * systems such as Prometheus, Datadog, New Relic, or CloudWatch agents.
 *
 * Guards: admin token.
 */
export const GET = withRequestTracing(async (req: Request) => {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const input: PrometheusRenderInput = { collectionErrors: [] };

  try {
    input.syncDashboard = syncObs.getDashboard() as SyncDashboard;
  } catch (error) {
    input.collectionErrors?.push({ collector: 'sync', message: errorMessage(error) });
  }

  try {
    input.reviewMetrics = getReviewMetrics();
  } catch (error) {
    input.collectionErrors?.push({ collector: 'review', message: errorMessage(error) });
  }

  try {
    input.embeddingMetrics = getEmbeddingMetrics();
  } catch (error) {
    input.collectionErrors?.push({ collector: 'embedding', message: errorMessage(error) });
  }

  return new Response(renderPrometheusMetrics(input), {
    status: 200,
    headers: {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
});
