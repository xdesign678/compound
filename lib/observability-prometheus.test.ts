import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeMetricRoute,
  observeHttpRequest,
  renderPrometheusMetrics,
  resetPrometheusMetricsForTests,
} from './observability/prometheus';

test('normalizeMetricRoute avoids high-cardinality id labels', () => {
  assert.equal(
    normalizeMetricRoute('http://example.com/api/review/queue/rv-a1B2c3D4e5?verbose=1'),
    '/api/review/queue/:id',
  );
  assert.equal(normalizeMetricRoute('/api/sources/0123456789abcdef0123'), '/api/sources/:id');
  assert.equal(normalizeMetricRoute('/api/health'), '/api/health');
});

test('renderPrometheusMetrics exposes HTTP counters and duration histogram', () => {
  resetPrometheusMetricsForTests();

  observeHttpRequest({
    method: 'post',
    route: 'http://example.com/api/review/queue/rv-a1B2c3D4e5',
    status: 201,
    durationMs: 42,
  });

  const body = renderPrometheusMetrics();
  assert.match(body, /# TYPE compound_http_requests_total counter/);
  assert.match(
    body,
    /compound_http_requests_total\{method="POST",route="\/api\/review\/queue\/:id",status="201"\} 1/,
  );
  assert.match(
    body,
    /compound_http_request_duration_seconds_bucket\{method="POST",route="\/api\/review\/queue\/:id",status="201",le="0.05"\} 1/,
  );
  assert.match(
    body,
    /compound_http_request_duration_seconds_count\{method="POST",route="\/api\/review\/queue\/:id",status="201"\} 1/,
  );
});

test('renderPrometheusMetrics includes domain gauges and collector errors', () => {
  resetPrometheusMetricsForTests();

  const body = renderPrometheusMetrics({
    syncDashboard: {
      now: 1,
      activeRun: null,
      latestRuns: [
        {
          id: 'run-1',
          kind: 'github',
          trigger_type: 'manual',
          repo: 'owner/repo',
          branch: 'main',
          head_sha: 'abc',
          status: 'done',
          stage: 'complete',
          total_files: 10,
          changed_files: 3,
          created_files: 1,
          updated_files: 2,
          deleted_files: 0,
          skipped_files: 7,
          done_files: 10,
          failed_files: 0,
          current: null,
          error: null,
          started_at: 1,
          finished_at: 2,
          heartbeat_at: null,
        },
      ],
      activeItems: [],
      failedItems: [],
      events: [],
      coverage: {
        sources: 8,
        concepts: 5,
        ftsReady: true,
      },
      itemStats: [{ stage: 'ingest', status: 'succeeded', count: 3 }],
      analysisStats: [{ stage: 'embedding', status: 'queued', count: 2 }],
      errorStats: [],
      pipeline: [],
      errorGroups: [],
      health: {
        startedAt: 1,
        finishedAt: 2,
        heartbeatAt: null,
        heartbeatAgeMs: null,
        runtimeMs: 1,
        stalled: false,
        stalledFor: 0,
        lastEventAt: null,
      },
      throughput: [],
      itemSummary: {
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
      },
    },
    reviewMetrics: {
      reviewOpen: 4,
      reviewResolved: 6,
    },
    embeddingMetrics: {
      embeddingProvider: 'local',
      embeddingModel: 'local-hash-256',
    },
    collectionErrors: [{ collector: 'sync', message: 'database unavailable' }],
  });

  assert.match(body, /compound_sync_run_files\{state="total"\} 10/);
  assert.match(body, /compound_sync_items\{stage="ingest",status="succeeded"\} 3/);
  assert.match(body, /compound_analysis_jobs\{stage="embedding",status="queued"\} 2/);
  assert.match(body, /compound_knowledge_records\{kind="sources"\} 8/);
  assert.match(body, /compound_review_items\{status="open"\} 4/);
  assert.match(
    body,
    /compound_embedding_provider_info\{provider="local",model="local-hash-256"\} 1/,
  );
  assert.match(
    body,
    /compound_metrics_collection_error\{collector="sync",message="database unavailable"\} 1/,
  );
});
