/**
 * Prometheus metrics exporter for server-side runtime and domain health.
 *
 * This file intentionally has no third-party dependency: the app only needs a
 * scrapeable text endpoint, while hosting platforms can route it into
 * Prometheus, Datadog, New Relic, CloudWatch, or another collector.
 */
import type { SyncDashboard, SyncRunRow } from '../sync-observability';

type LabelValue = string | number | boolean;
type Labels = Record<string, LabelValue>;

interface HttpSample {
  labels: {
    method: string;
    route: string;
    status: string;
  };
  count: number;
  durationSecondsSum: number;
  bucketCounts: number[];
}

export interface HttpObservation {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}

export interface PrometheusRenderInput {
  syncDashboard?: SyncDashboard;
  reviewMetrics?: Record<string, number>;
  embeddingMetrics?: Record<string, string | number | boolean>;
  collectionErrors?: Array<{ collector: string; message: string }>;
}

const HTTP_DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const httpSamples = new Map<string, HttpSample>();

function escapeLabel(value: LabelValue): string {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labelsToText(labels: Labels = {}): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`;
}

function normalizePathSegment(segment: string): string {
  if (/^\d+$/.test(segment)) return ':id';
  if (/^[a-f0-9]{12,}$/i.test(segment)) return ':id';
  if (/^[a-z]{1,8}-[A-Za-z0-9_-]{6,}$/.test(segment)) return ':id';
  if (segment.length > 48) return ':id';
  return segment;
}

export function normalizeMetricRoute(route: string): string {
  let pathname = route;
  try {
    pathname = new URL(route).pathname;
  } catch {
    pathname = route.split('?')[0] || '/';
  }
  return pathname
    .split('/')
    .map((segment) => (segment ? normalizePathSegment(segment) : segment))
    .join('/');
}

function sampleKey(labels: HttpSample['labels']): string {
  return `${labels.method}\u001f${labels.route}\u001f${labels.status}`;
}

export function observeHttpRequest(observation: HttpObservation): void {
  const labels = {
    method: observation.method.toUpperCase(),
    route: normalizeMetricRoute(observation.route),
    status: String(observation.status),
  };
  const key = sampleKey(labels);
  const existing =
    httpSamples.get(key) ??
    ({
      labels,
      count: 0,
      durationSecondsSum: 0,
      bucketCounts: new Array(HTTP_DURATION_BUCKETS_SECONDS.length).fill(0),
    } satisfies HttpSample);

  const durationSeconds = Math.max(0, observation.durationMs / 1000);
  existing.count += 1;
  existing.durationSecondsSum += durationSeconds;
  HTTP_DURATION_BUCKETS_SECONDS.forEach((bucket, index) => {
    if (durationSeconds <= bucket) existing.bucketCounts[index] += 1;
  });
  httpSamples.set(key, existing);
}

class PrometheusTextBuilder {
  private readonly declared = new Set<string>();
  private readonly lines: string[] = [];

  metric(name: string, type: 'counter' | 'gauge' | 'histogram', help: string): void {
    if (this.declared.has(name)) return;
    this.declared.add(name);
    this.lines.push(`# HELP ${name} ${help}`);
    this.lines.push(`# TYPE ${name} ${type}`);
  }

  sample(name: string, value: number, labels: Labels = {}): void {
    this.lines.push(`${name}${labelsToText(labels)} ${Number.isFinite(value) ? value : 0}`);
  }

  toString(): string {
    return `${this.lines.join('\n')}\n`;
  }
}

function addProcessMetrics(out: PrometheusTextBuilder): void {
  out.metric('compound_app_info', 'gauge', 'Application identity for the Compound service.');
  out.sample('compound_app_info', 1, {
    service: 'compound',
    runtime: 'nextjs',
    node: process.version,
  });

  out.metric('compound_process_uptime_seconds', 'gauge', 'Node.js process uptime in seconds.');
  out.sample('compound_process_uptime_seconds', process.uptime());

  out.metric('compound_process_memory_bytes', 'gauge', 'Node.js process memory usage in bytes.');
  const memory = process.memoryUsage();
  for (const [kind, bytes] of Object.entries(memory)) {
    out.sample('compound_process_memory_bytes', bytes, { kind });
  }
}

function addHttpMetrics(out: PrometheusTextBuilder): void {
  out.metric(
    'compound_http_requests_total',
    'counter',
    'HTTP requests observed by route handlers.',
  );
  out.metric(
    'compound_http_request_duration_seconds',
    'histogram',
    'HTTP route handler duration in seconds.',
  );

  const samples = Array.from(httpSamples.values()).sort((a, b) =>
    sampleKey(a.labels).localeCompare(sampleKey(b.labels)),
  );
  for (const sample of samples) {
    out.sample('compound_http_requests_total', sample.count, sample.labels);
    HTTP_DURATION_BUCKETS_SECONDS.forEach((bucket, index) => {
      out.sample('compound_http_request_duration_seconds_bucket', sample.bucketCounts[index], {
        ...sample.labels,
        le: bucket,
      });
    });
    out.sample('compound_http_request_duration_seconds_bucket', sample.count, {
      ...sample.labels,
      le: '+Inf',
    });
    out.sample(
      'compound_http_request_duration_seconds_sum',
      sample.durationSecondsSum,
      sample.labels,
    );
    out.sample('compound_http_request_duration_seconds_count', sample.count, sample.labels);
  }
}

function latestRun(dashboard: SyncDashboard): SyncRunRow | null {
  return dashboard.activeRun ?? dashboard.latestRuns[0] ?? null;
}

function addSyncMetrics(out: PrometheusTextBuilder, dashboard: SyncDashboard): void {
  const run = latestRun(dashboard);

  out.metric('compound_sync_active_run', 'gauge', 'Whether a sync run is currently active.');
  out.sample('compound_sync_active_run', dashboard.activeRun ? 1 : 0, {
    kind: dashboard.activeRun?.kind ?? 'none',
    stage: dashboard.activeRun?.stage ?? 'none',
    status: dashboard.activeRun?.status ?? 'none',
  });

  out.metric('compound_sync_run_files', 'gauge', 'File counters for the latest sync run.');
  if (run) {
    out.sample('compound_sync_run_files', run.total_files, { state: 'total' });
    out.sample('compound_sync_run_files', run.changed_files, { state: 'changed' });
    out.sample('compound_sync_run_files', run.done_files, { state: 'done' });
    out.sample('compound_sync_run_files', run.failed_files, { state: 'failed' });
    out.sample('compound_sync_run_files', run.skipped_files, { state: 'skipped' });
  }

  out.metric('compound_sync_items', 'gauge', 'Sync item counts by stage and status.');
  for (const item of dashboard.itemStats) {
    out.sample('compound_sync_items', Number(item.count), {
      stage: item.stage,
      status: item.status,
    });
  }

  out.metric('compound_analysis_jobs', 'gauge', 'Analysis job counts by stage and status.');
  for (const item of dashboard.analysisStats) {
    out.sample('compound_analysis_jobs', Number(item.count), {
      stage: item.stage,
      status: item.status,
    });
  }

  out.metric('compound_sync_errors', 'gauge', 'Failed sync item counts grouped by error.');
  for (const item of dashboard.errorStats) {
    out.sample('compound_sync_errors', Number(item.count), {
      error: item.error.slice(0, 160),
    });
  }

  out.metric('compound_knowledge_records', 'gauge', 'Knowledge-base and indexing record counts.');
  for (const [kind, value] of Object.entries(dashboard.coverage)) {
    if (typeof value === 'number') {
      out.sample('compound_knowledge_records', value, { kind });
    }
  }
}

function addReviewMetrics(out: PrometheusTextBuilder, metrics: Record<string, number>): void {
  out.metric('compound_review_items', 'gauge', 'Review queue item counts.');
  if (typeof metrics.reviewOpen === 'number') {
    out.sample('compound_review_items', metrics.reviewOpen, { status: 'open' });
  }
  if (typeof metrics.reviewResolved === 'number') {
    out.sample('compound_review_items', metrics.reviewResolved, { status: 'resolved' });
  }
}

function addEmbeddingMetrics(
  out: PrometheusTextBuilder,
  metrics: Record<string, string | number | boolean>,
): void {
  const provider = metrics.embeddingProvider;
  const model = metrics.embeddingModel;
  if (typeof provider !== 'string' && typeof model !== 'string') return;

  out.metric(
    'compound_embedding_provider_info',
    'gauge',
    'Configured embedding provider and model.',
  );
  out.sample('compound_embedding_provider_info', 1, {
    provider: typeof provider === 'string' ? provider : 'unknown',
    model: typeof model === 'string' ? model : 'unknown',
  });
}

function addCollectionErrors(
  out: PrometheusTextBuilder,
  errors: Array<{ collector: string; message: string }>,
): void {
  out.metric(
    'compound_metrics_collection_error',
    'gauge',
    'Collector failures during this scrape.',
  );
  for (const error of errors) {
    out.sample('compound_metrics_collection_error', 1, {
      collector: error.collector,
      message: error.message.slice(0, 160),
    });
  }
}

export function renderPrometheusMetrics(input: PrometheusRenderInput = {}): string {
  const out = new PrometheusTextBuilder();
  addProcessMetrics(out);
  addHttpMetrics(out);
  if (input.syncDashboard) addSyncMetrics(out, input.syncDashboard);
  if (input.reviewMetrics) addReviewMetrics(out, input.reviewMetrics);
  if (input.embeddingMetrics) addEmbeddingMetrics(out, input.embeddingMetrics);
  if (input.collectionErrors?.length) addCollectionErrors(out, input.collectionErrors);
  return out.toString();
}

export function resetPrometheusMetricsForTests(): void {
  httpSamples.clear();
}
