/**
 * Shared client-side types for the /sync dashboard. Mirrors the server
 * payload from `app/api/sync/dashboard` so all sub-components can rely on
 * the same shape without re-fetching or re-deriving fields.
 */

export type SyncItemStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface SyncRun {
  id: string;
  status: string;
  stage: string;
  repo: string | null;
  branch: string | null;
  head_sha?: string | null;
  changed_files: number;
  created_files: number;
  updated_files: number;
  deleted_files: number;
  skipped_files: number;
  done_files: number;
  failed_files: number;
  current: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
  heartbeat_at?: number | null;
}

export interface SyncItem {
  id: string;
  path: string;
  change_type: string;
  status: string;
  stage: string;
  attempts?: number;
  chunks: number | null;
  concepts_created: number | null;
  concepts_updated: number | null;
  evidence: number | null;
  error: string | null;
  started_at?: number | null;
  finished_at?: number | null;
  updated_at?: number;
}

export interface SyncEvent {
  id: string;
  at: number;
  level: string;
  stage: string | null;
  path: string | null;
  message: string;
}

export interface PipelineStage {
  stage: string;
  label: string;
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  skipped: number;
}

export interface ErrorGroup {
  fingerprint: string;
  category: 'timeout' | 'github' | 'auth' | 'parse' | 'rate' | 'gateway' | 'unknown';
  message: string;
  stage: string | null;
  count: number;
  lastAt: number;
  examples: Array<{ path: string; itemId: string }>;
  suggestion: string;
}

export interface RunHealth {
  startedAt: number | null;
  finishedAt: number | null;
  heartbeatAt: number | null;
  heartbeatAgeMs: number | null;
  runtimeMs: number | null;
  stalled: boolean;
  stalledFor: number;
  lastEventAt: number | null;
}

export interface ThroughputBucket {
  at: number;
  done: number;
  failed: number;
}

export type NarrativeNextAction = 'sync' | 'wait' | 'retry' | 'review' | 'cancel';
export type NarrativeTone = 'idle' | 'running' | 'error' | 'stalled' | 'done' | 'review';

export interface SyncNarrative {
  headline: string;
  subline: string;
  nextAction: NarrativeNextAction;
  tone: NarrativeTone;
}

export type PhaseKey = 'fetch' | 'analyze' | 'publish';
export type PhaseStatus = 'pending' | 'running' | 'done' | 'failed';

export interface PhaseInfo {
  key: PhaseKey;
  label: string;
  description: string;
  status: PhaseStatus;
  done: number;
  total: number;
  failed: number;
  running: number;
  queued: number;
  rawStages: PipelineStage[];
}

export interface SyncPhases {
  fetch: PhaseInfo;
  analyze: PhaseInfo;
  publish: PhaseInfo;
}

export type HealthScore = 'healthy' | 'warning' | 'critical';

export interface HealthDetail {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface SyncHealth {
  score: HealthScore;
  summary: string;
  details: HealthDetail[];
}

export interface LastRunSnapshot {
  finishedAt: number;
  ageMs: number;
  durationMs: number | null;
  conceptsDelta: number;
  filesProcessed: number;
  status: string;
  repo: string | null;
  branch: string | null;
}

export type DiagnosticSeverity = 'info' | 'warning' | 'critical';
export type DiagnosticActionId =
  | 'open-env'
  | 'switch-fast-model'
  | 'skip-failed'
  | 'retry-all'
  | 'open-runbook';

export interface DiagnosticAction {
  id: DiagnosticActionId;
  label: string;
  href?: string;
  primary?: boolean;
}

export interface SyncDiagnostic {
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  detail: string;
  actions: DiagnosticAction[];
  affectedCount: number;
}

export interface DashboardStory {
  narrative: SyncNarrative;
  phases: SyncPhases;
  health: SyncHealth;
  lastRun: LastRunSnapshot | null;
  diagnostics: SyncDiagnostic[];
}

export interface Dashboard {
  now?: number;
  activeRun: SyncRun | null;
  latestRuns: SyncRun[];
  activeItems: SyncItem[];
  events: SyncEvent[];
  coverage: Record<string, number | string | boolean>;
  analysisStats: Array<{ stage: string; status: string; count: number }>;
  errorStats: Array<{ error: string; count: number; lastAt: number }>;
  pipeline: PipelineStage[];
  errorGroups: ErrorGroup[];
  health: RunHealth;
  throughput: ThroughputBucket[];
  itemSummary: Record<SyncItemStatus, number>;
  story?: DashboardStory;
}

export const STATUS_TEXT: Record<string, string> = {
  queued: '排队',
  running: '运行中',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
  succeeded: '成功',
  skipped: '跳过',
};

export const STAGE_TEXT: Record<string, string> = {
  scan: '扫描',
  diff: '比对',
  download: '下载',
  ingest: '入库',
  github_ingest: '入库',
  llm: '分析',
  chunk: '分块',
  fts: '全文',
  embedding: '向量',
  summarize: '摘要',
  qa_index: '问答索引',
  concepts: '概念',
  relations: '关系',
  delete: '删除',
  complete: '完成',
};

export function fmtDate(value?: number | null): string {
  return value ? new Date(value).toLocaleString() : '-';
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function badgeTone(value: string): 'good' | 'bad' | 'warn' | 'neutral' {
  if (['done', 'succeeded', 'success'].includes(value)) return 'good';
  if (['failed', 'cancelled', 'error'].includes(value)) return 'bad';
  if (['running', 'queued', 'warn'].includes(value)) return 'warn';
  return 'neutral';
}
