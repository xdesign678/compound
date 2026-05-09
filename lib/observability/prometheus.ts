/**
 * Prometheus metrics exporter for server-side runtime and domain health.
 *
 * This file intentionally has no third-party dependency: the app only needs a
 * scrapeable text endpoint, while hosting platforms can route it into
 * Prometheus, Datadog, New Relic, CloudWatch, or another collector.
 */
import { getCircuitBreakerSnapshots, type CircuitBreakerState } from '../circuit-breaker';
import type { SyncDashboard, SyncRunRow } from '../sync-observability';
import { getQueryAnalyzerSnapshot } from './query-analyzer';

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

interface HistogramSample<TLabels extends Labels> {
  labels: TLabels;
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
const RAG_STAGE_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60,
];
const EMBEDDING_BATCH_SIZE_BUCKETS = [1, 2, 4, 8, 16, 32, 64, 100, 128, 256, 512, 1024];
const httpSamples = new Map<string, HttpSample>();
const ragStageSamples = new Map<string, HistogramSample<{ stage: string }>>();
const embeddingBatchSamples = new Map<string, HistogramSample<{ model: string }>>();
const llmRetries = new Map<string, { labels: { host: string; reason: string }; count: number }>();
const llmSsrfBlocks = new Map<string, { labels: { host: string }; count: number }>();
const llmRuns = new Map<
  string,
  { labels: { task: string; prompt_version: string }; count: number }
>();
const embeddingCacheHits = new Map<string, { labels: { model: string }; count: number }>();
const embeddingCacheMisses = new Map<string, { labels: { model: string }; count: number }>();
const ragRerankOutcomes = new Map<
  string,
  { labels: { outcome: 'success' | 'fallback' | 'cooldown' }; count: number }
>();
let ragRerankFailureRate = 0;

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

function labeledKey(labels: Labels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\u001f');
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

export function observeRagStageDuration(input: { stage: string; durationMs: number }): void {
  const labels = { stage: input.stage };
  const key = labeledKey(labels);
  const existing =
    ragStageSamples.get(key) ??
    ({
      labels,
      count: 0,
      durationSecondsSum: 0,
      bucketCounts: new Array(RAG_STAGE_DURATION_BUCKETS_SECONDS.length).fill(0),
    } satisfies HistogramSample<{ stage: string }>);

  const durationSeconds = Math.max(0, input.durationMs / 1000);
  existing.count += 1;
  existing.durationSecondsSum += durationSeconds;
  RAG_STAGE_DURATION_BUCKETS_SECONDS.forEach((bucket, index) => {
    if (durationSeconds <= bucket) existing.bucketCounts[index] += 1;
  });
  ragStageSamples.set(key, existing);
}

export function recordLlmRetry(labels: { host: string; reason: string }): void {
  const key = labeledKey(labels);
  const existing = llmRetries.get(key) ?? { labels, count: 0 };
  existing.count += 1;
  llmRetries.set(key, existing);
}

export function recordLlmSsrfBlock(labels: { host: string }): void {
  const key = labeledKey(labels);
  const existing = llmSsrfBlocks.get(key) ?? { labels, count: 0 };
  existing.count += 1;
  llmSsrfBlocks.set(key, existing);
}

export function recordLlmRun(labels: { task: string; promptVersion: string }): void {
  const normalizedLabels = {
    task: labels.task || 'chat',
    prompt_version: labels.promptVersion || 'unknown',
  };
  const key = labeledKey(normalizedLabels);
  const existing = llmRuns.get(key) ?? { labels: normalizedLabels, count: 0 };
  existing.count += 1;
  llmRuns.set(key, existing);
}

export function recordRagRerankOutcome(labels: {
  outcome: 'success' | 'fallback' | 'cooldown';
}): void {
  const key = labeledKey(labels);
  const existing = ragRerankOutcomes.get(key) ?? { labels, count: 0 };
  existing.count += 1;
  ragRerankOutcomes.set(key, existing);
}

export function setRagRerankFailureRate(rate: number): void {
  ragRerankFailureRate = Math.max(0, Math.min(1, Number.isFinite(rate) ? rate : 0));
}

export function recordEmbeddingCacheHit(labels: { model: string }): void {
  const key = labeledKey(labels);
  const existing = embeddingCacheHits.get(key) ?? { labels, count: 0 };
  existing.count += 1;
  embeddingCacheHits.set(key, existing);
}

export function recordEmbeddingCacheMiss(labels: { model: string }): void {
  const key = labeledKey(labels);
  const existing = embeddingCacheMisses.get(key) ?? { labels, count: 0 };
  existing.count += 1;
  embeddingCacheMisses.set(key, existing);
}

export function observeEmbeddingBatchSize(input: { model: string; size: number }): void {
  const labels = { model: input.model };
  const key = labeledKey(labels);
  const existing =
    embeddingBatchSamples.get(key) ??
    ({
      labels,
      count: 0,
      durationSecondsSum: 0,
      bucketCounts: new Array(EMBEDDING_BATCH_SIZE_BUCKETS.length).fill(0),
    } satisfies HistogramSample<{ model: string }>);

  const size = Math.max(0, input.size);
  existing.count += 1;
  existing.durationSecondsSum += size;
  EMBEDDING_BATCH_SIZE_BUCKETS.forEach((bucket, index) => {
    if (size <= bucket) existing.bucketCounts[index] += 1;
  });
  embeddingBatchSamples.set(key, existing);
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

function circuitStateValue(state: CircuitBreakerState): number {
  if (state === 'open') return 2;
  if (state === 'half_open') return 1;
  return 0;
}

function hostFromCircuitName(name: string): string {
  return name.startsWith('llm-gateway:') ? name.slice('llm-gateway:'.length) : name;
}

function addLlmMetrics(out: PrometheusTextBuilder): void {
  out.metric(
    'compound_llm_circuit_state',
    'gauge',
    'LLM circuit breaker state by host: closed=0, half_open=1, open=2.',
  );
  for (const snapshot of getCircuitBreakerSnapshots()) {
    if (!snapshot.name.startsWith('llm-gateway:')) continue;
    out.sample('compound_llm_circuit_state', circuitStateValue(snapshot.state), {
      host: hostFromCircuitName(snapshot.name),
    });
  }

  out.metric('compound_llm_retries_total', 'counter', 'LLM retry or fallback attempts by host.');
  for (const item of Array.from(llmRetries.values()).sort((a, b) =>
    labeledKey(a.labels).localeCompare(labeledKey(b.labels)),
  )) {
    out.sample('compound_llm_retries_total', item.count, item.labels);
  }

  out.metric(
    'compound_llm_ssrf_blocks_total',
    'counter',
    'LLM gateway requests blocked by SSRF protection.',
  );
  for (const item of Array.from(llmSsrfBlocks.values()).sort((a, b) =>
    labeledKey(a.labels).localeCompare(labeledKey(b.labels)),
  )) {
    out.sample('compound_llm_ssrf_blocks_total', item.count, item.labels);
  }

  out.metric('compound_llm_runs_total', 'counter', 'LLM calls grouped by task and prompt version.');
  for (const item of Array.from(llmRuns.values()).sort((a, b) =>
    labeledKey(a.labels).localeCompare(labeledKey(b.labels)),
  )) {
    out.sample('compound_llm_runs_total', item.count, item.labels);
  }
}

function addRagMetrics(out: PrometheusTextBuilder): void {
  out.metric(
    'compound_rag_stage_duration_seconds',
    'histogram',
    'RAG pipeline stage duration in seconds.',
  );

  const samples = Array.from(ragStageSamples.values()).sort((a, b) =>
    labeledKey(a.labels).localeCompare(labeledKey(b.labels)),
  );
  for (const sample of samples) {
    RAG_STAGE_DURATION_BUCKETS_SECONDS.forEach((bucket, index) => {
      out.sample('compound_rag_stage_duration_seconds_bucket', sample.bucketCounts[index], {
        ...sample.labels,
        le: bucket,
      });
    });
    out.sample('compound_rag_stage_duration_seconds_bucket', sample.count, {
      ...sample.labels,
      le: '+Inf',
    });
    out.sample('compound_rag_stage_duration_seconds_sum', sample.durationSecondsSum, sample.labels);
    out.sample('compound_rag_stage_duration_seconds_count', sample.count, sample.labels);
  }

  out.metric('compound_rag_rerank_total', 'counter', 'LLM rerank outcomes.');
  for (const item of Array.from(ragRerankOutcomes.values()).sort((a, b) =>
    labeledKey(a.labels).localeCompare(labeledKey(b.labels)),
  )) {
    out.sample('compound_rag_rerank_total', item.count, item.labels);
  }

  out.metric(
    'compound_rag_rerank_failure_rate',
    'gauge',
    'Rolling LLM rerank failure rate over the current in-memory window.',
  );
  out.sample('compound_rag_rerank_failure_rate', ragRerankFailureRate);
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

  out.metric('compound_analysis_queue_depth', 'gauge', 'Queued analysis job depth by stage.');
  for (const item of dashboard.analysisQueueDepth ?? []) {
    out.sample('compound_analysis_queue_depth', Number(item.count), { stage: item.stage });
  }

  out.metric(
    'compound_analysis_job_duration_ms',
    'gauge',
    'Analysis job duration statistics by stage.',
  );
  for (const item of dashboard.analysisDurationStats ?? []) {
    out.sample('compound_analysis_job_duration_ms', Number(item.avgMs || 0), {
      stage: item.stage,
      stat: 'avg',
    });
    out.sample('compound_analysis_job_duration_ms', Number(item.maxMs || 0), {
      stage: item.stage,
      stat: 'max',
    });
  }

  out.metric(
    'compound_analysis_job_duration_seconds',
    'histogram',
    'Analysis job duration histogram by stage and final status.',
  );
  for (const item of dashboard.analysisDurationBuckets ?? []) {
    out.sample('compound_analysis_job_duration_seconds_bucket', Number(item.count), {
      stage: item.stage,
      status: item.status,
      le: item.le,
    });
  }

  out.metric(
    'compound_analysis_job_errors',
    'gauge',
    'Failed analysis job counts by stage and error category.',
  );
  for (const item of dashboard.analysisErrorCategories ?? []) {
    out.sample('compound_analysis_job_errors', Number(item.count), {
      stage: item.stage,
      category: item.category,
    });
  }

  out.metric(
    'compound_github_sync_run_duration_seconds',
    'gauge',
    'GitHub sync run duration statistics by status.',
  );
  for (const item of dashboard.githubRunDurationStats ?? []) {
    out.sample('compound_github_sync_run_duration_seconds', Number(item.avgSeconds || 0), {
      status: item.status,
      stat: 'avg',
    });
    out.sample('compound_github_sync_run_duration_seconds', Number(item.maxSeconds || 0), {
      status: item.status,
      stat: 'max',
    });
  }

  out.metric('compound_webhook_delivery_total', 'counter', 'GitHub webhook deliveries by status.');
  for (const item of dashboard.webhookDeliveryStats ?? []) {
    out.sample('compound_webhook_delivery_total', Number(item.count), { status: item.status });
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
  if (typeof provider === 'string' || typeof model === 'string') {
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

  out.metric(
    'compound_embedding_cache_hits_total',
    'counter',
    'Embedding vector cache hits by model.',
  );
  for (const item of Array.from(embeddingCacheHits.values()).sort((a, b) =>
    labeledKey(a.labels).localeCompare(labeledKey(b.labels)),
  )) {
    out.sample('compound_embedding_cache_hits_total', item.count, item.labels);
  }

  out.metric(
    'compound_embedding_cache_misses_total',
    'counter',
    'Embedding vector cache misses by model.',
  );
  for (const item of Array.from(embeddingCacheMisses.values()).sort((a, b) =>
    labeledKey(a.labels).localeCompare(labeledKey(b.labels)),
  )) {
    out.sample('compound_embedding_cache_misses_total', item.count, item.labels);
  }

  out.metric(
    'compound_embedding_batch_size',
    'histogram',
    'Unique remote embedding request batch size by model.',
  );
  const samples = Array.from(embeddingBatchSamples.values()).sort((a, b) =>
    labeledKey(a.labels).localeCompare(labeledKey(b.labels)),
  );
  for (const sample of samples) {
    EMBEDDING_BATCH_SIZE_BUCKETS.forEach((bucket, index) => {
      out.sample('compound_embedding_batch_size_bucket', sample.bucketCounts[index], {
        ...sample.labels,
        le: bucket,
      });
    });
    out.sample('compound_embedding_batch_size_bucket', sample.count, {
      ...sample.labels,
      le: '+Inf',
    });
    out.sample('compound_embedding_batch_size_sum', sample.durationSecondsSum, sample.labels);
    out.sample('compound_embedding_batch_size_count', sample.count, sample.labels);
  }
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

function addQueryAnalyzerMetrics(out: PrometheusTextBuilder): void {
  const snapshot = getQueryAnalyzerSnapshot(10);

  out.metric(
    'compound_db_queries_total',
    'counter',
    'Total prepared SQL statement executions observed by the query analyzer.',
  );
  out.sample('compound_db_queries_total', snapshot.totalQueries);

  out.metric(
    'compound_db_query_errors_total',
    'counter',
    'Prepared SQL statements that threw during execution.',
  );
  out.sample('compound_db_query_errors_total', snapshot.totalErrors);

  out.metric(
    'compound_db_query_duration_seconds_total',
    'counter',
    'Cumulative wall-clock time spent executing prepared SQL statements.',
  );
  out.sample('compound_db_query_duration_seconds_total', snapshot.totalDurationMs / 1000);

  out.metric(
    'compound_db_query_duration_seconds_max',
    'gauge',
    'Maximum single-statement execution time observed since process start.',
  );
  out.sample('compound_db_query_duration_seconds_max', snapshot.maxDurationMs / 1000);

  out.metric(
    'compound_db_n_plus_one_incidents_total',
    'counter',
    'Number of distinct (scope, fingerprint) pairs that crossed the N+1 threshold.',
  );
  out.sample('compound_db_n_plus_one_incidents_total', snapshot.totalNPlusOneIncidents);

  out.metric(
    'compound_db_query_fingerprint_count',
    'gauge',
    'Cumulative execution count per top SQL fingerprint (top 10).',
  );
  for (const item of snapshot.topFingerprints) {
    out.sample('compound_db_query_fingerprint_count', item.count, {
      fingerprint: item.fingerprint.slice(0, 160),
    });
  }

  out.metric(
    'compound_db_n_plus_one_fingerprint_incidents',
    'gauge',
    'Number of N+1 incidents per offending SQL fingerprint (top 10).',
  );
  for (const item of snapshot.worstNPlusOneFingerprints) {
    out.sample('compound_db_n_plus_one_fingerprint_incidents', item.incidents, {
      fingerprint: item.fingerprint.slice(0, 160),
    });
  }
}

export function renderPrometheusMetrics(input: PrometheusRenderInput = {}): string {
  const out = new PrometheusTextBuilder();
  addProcessMetrics(out);
  addHttpMetrics(out);
  addLlmMetrics(out);
  addRagMetrics(out);
  addQueryAnalyzerMetrics(out);
  if (input.syncDashboard) addSyncMetrics(out, input.syncDashboard);
  if (input.reviewMetrics) addReviewMetrics(out, input.reviewMetrics);
  addEmbeddingMetrics(out, input.embeddingMetrics ?? {});
  if (input.collectionErrors?.length) addCollectionErrors(out, input.collectionErrors);
  return out.toString();
}

export function resetPrometheusMetricsForTests(): void {
  httpSamples.clear();
  ragStageSamples.clear();
  embeddingBatchSamples.clear();
  llmRetries.clear();
  llmSsrfBlocks.clear();
  llmRuns.clear();
  embeddingCacheHits.clear();
  embeddingCacheMisses.clear();
  ragRerankOutcomes.clear();
  ragRerankFailureRate = 0;
}
