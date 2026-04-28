/**
 * Pure derivation layer that turns the dense `SyncDashboard` payload into a
 * user-friendly story (`narrative` + `phases` + `health` + `lastRun`) for the
 * V3 console.
 *
 * No DB / IO — all functions take plain values so they can be unit-tested
 * without the SQLite layer.
 */

import type {
  ErrorGroupRow,
  PipelineStageRow,
  RunHealth,
  SyncDashboard,
  SyncItemStatus,
  SyncRunItemRow,
  SyncRunRow,
} from './sync-observability';

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
  rawStages: PipelineStageRow[];
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

const PHASE_LABELS: Record<PhaseKey, { label: string; description: string }> = {
  fetch: { label: '拉取', description: '从 GitHub 取最新 Markdown' },
  analyze: { label: 'AI 理解', description: '分块、抽取概念、生成向量' },
  publish: { label: '上线索引', description: '写入全文与问答索引' },
};

/**
 * analysis_jobs.stage → phase. Each phase aggregates the underlying stages
 * the user does not need to think about by default.
 */
const STAGE_TO_PHASE: Record<string, PhaseKey> = {
  github_ingest: 'fetch',
  chunk: 'analyze',
  llm: 'analyze',
  summarize: 'analyze',
  concepts: 'analyze',
  relations: 'analyze',
  embedding: 'analyze',
  fts: 'publish',
  qa_index: 'publish',
};

function makeEmptyPhase(key: PhaseKey): PhaseInfo {
  return {
    key,
    label: PHASE_LABELS[key].label,
    description: PHASE_LABELS[key].description,
    status: 'pending',
    done: 0,
    total: 0,
    failed: 0,
    running: 0,
    queued: 0,
    rawStages: [],
  };
}

/** Roll up the 7 raw pipeline stages into the 3 user-visible phases. */
export function bucketPhases(pipeline: PipelineStageRow[]): SyncPhases {
  const phases: SyncPhases = {
    fetch: makeEmptyPhase('fetch'),
    analyze: makeEmptyPhase('analyze'),
    publish: makeEmptyPhase('publish'),
  };
  for (const stage of pipeline) {
    const phaseKey = STAGE_TO_PHASE[stage.stage];
    if (!phaseKey) continue;
    const target = phases[phaseKey];
    target.done += stage.succeeded + stage.skipped;
    target.total += stage.total;
    target.failed += stage.failed;
    target.running += stage.running;
    target.queued += stage.queued;
    target.rawStages.push(stage);
  }
  for (const key of ['fetch', 'analyze', 'publish'] as PhaseKey[]) {
    const p = phases[key];
    if (p.total === 0) {
      p.status = 'pending';
      continue;
    }
    if (p.running > 0 || p.queued > 0) {
      p.status = 'running';
    } else if (p.failed > 0 && p.done + p.failed >= p.total) {
      p.status = 'failed';
    } else if (p.done >= p.total) {
      p.status = 'done';
    } else {
      p.status = 'pending';
    }
  }
  return phases;
}

export interface NarrativeInput {
  run: SyncRunRow | null;
  health: RunHealth | null;
  itemSummary: Record<SyncItemStatus, number>;
  errorGroupCount: number;
  reviewOpen: number;
  phases: SyncPhases;
  lastRun: LastRunSnapshot | null;
}

export function deriveNarrative(input: NarrativeInput): SyncNarrative {
  const { run, health, errorGroupCount, reviewOpen, phases, lastRun } = input;

  if (run?.status === 'running' && health?.stalled) {
    return {
      headline: '同步已停滞',
      subline: '心跳超时 60s 以上，建议点「立即同步」唤醒 worker',
      nextAction: 'sync',
      tone: 'stalled',
    };
  }

  if (run?.status === 'running') {
    const total = run.changed_files;
    const done = (run.done_files ?? 0) + (run.failed_files ?? 0);
    const phaseRunning =
      phases.fetch.status === 'running'
        ? phases.fetch
        : phases.analyze.status === 'running'
          ? phases.analyze
          : phases.publish.status === 'running'
            ? phases.publish
            : null;
    const headline = total > 0 ? `正在同步 · ${done}/${total} 个文件` : '正在同步';
    const subline = phaseRunning
      ? `${phaseRunning.label} · ${phaseRunning.description}`
      : run.current
        ? run.current
        : '处理中';
    return { headline, subline, nextAction: 'cancel', tone: 'running' };
  }

  if (run?.status === 'failed') {
    return {
      headline: '上次同步失败',
      subline: run.error || '点击重试，或前往问题中心查看分组建议',
      nextAction: 'retry',
      tone: 'error',
    };
  }

  if (errorGroupCount > 0) {
    return {
      headline: `有 ${errorGroupCount} 类问题待处理`,
      subline: '问题中心可一键重试同类失败',
      nextAction: 'retry',
      tone: 'error',
    };
  }

  if (lastRun) {
    const ageText = formatAge(lastRun.ageMs);
    const conceptText =
      lastRun.conceptsDelta > 0
        ? `新增 ${lastRun.conceptsDelta} 个文件`
        : `处理 ${lastRun.filesProcessed} 个文件`;
    const subline =
      reviewOpen > 0
        ? `${reviewOpen} 条待审 · 点击「立即同步」获取最新内容`
        : '点击「立即同步」获取最新内容';
    return {
      headline: `上次同步 ${ageText}前 · ${conceptText}`,
      subline,
      nextAction: 'sync',
      tone: 'done',
    };
  }

  if (reviewOpen > 0) {
    return {
      headline: `有 ${reviewOpen} 条概念待审`,
      subline: '前往审核队列处理低置信度变更',
      nextAction: 'review',
      tone: 'review',
    };
  }

  return {
    headline: '尚未运行同步',
    subline: '点击「立即同步」从 GitHub 拉取最新 Markdown',
    nextAction: 'sync',
    tone: 'idle',
  };
}

/** Human-readable relative age such as "17 分钟" / "3 小时" / "2 天". */
export function formatAge(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '一段时间';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时`;
  const d = Math.round(h / 24);
  return `${d} 天`;
}

export interface HealthInput {
  coverage: Record<string, number | string | boolean>;
  reviewOpen: number;
  errorGroupCount: number;
  itemSummary: Record<SyncItemStatus, number>;
}

export function deriveHealth(input: HealthInput): SyncHealth {
  const { coverage, reviewOpen, errorGroupCount, itemSummary } = input;
  const num = (key: string): number => {
    const v = coverage[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  const sources = num('activeSourceFiles') || num('githubSources') || num('sources');
  const chunks = num('sourceChunks');
  const ftsRows = num('chunkFtsRows');
  const embeddings = num('chunkEmbeddings');
  const ftsReady = Boolean(coverage.ftsReady);
  const failedItems = itemSummary.failed ?? 0;
  const queuedItems = itemSummary.queued ?? 0;

  const ftsPct = chunks > 0 ? Math.round((ftsRows / chunks) * 100) : 0;
  const embPct = chunks > 0 ? Math.round((embeddings / chunks) * 100) : 0;

  const details: HealthDetail[] = [
    {
      label: '已同步',
      value: `${sources} 篇`,
      tone: sources > 0 ? 'good' : 'neutral',
    },
    {
      label: '全文索引',
      value: ftsReady ? `${ftsPct}%` : '未启用',
      tone: ftsReady ? (ftsPct >= 95 ? 'good' : 'warn') : 'neutral',
    },
    {
      label: '向量索引',
      value: chunks > 0 ? `${embPct}%` : '—',
      tone: chunks === 0 ? 'neutral' : embPct >= 95 ? 'good' : embPct >= 50 ? 'warn' : 'bad',
    },
    {
      label: '待审',
      value: `${reviewOpen} 条`,
      tone: reviewOpen === 0 ? 'good' : reviewOpen <= 4 ? 'warn' : 'bad',
    },
  ];

  let score: HealthScore;
  if (failedItems > 0 || errorGroupCount > 0 || (chunks > 0 && embPct < 50)) {
    score = 'critical';
  } else if (queuedItems > 0 || reviewOpen > 4 || (ftsReady && ftsPct < 95)) {
    score = 'warning';
  } else {
    score = 'healthy';
  }

  const summary = details.map((d) => `${d.label} ${d.value}`).join(' · ');
  return { score, summary, details };
}

/** Pick the most recent finished run as a "story card" for idle state. */
export function deriveLastRun(
  latestRuns: SyncRunRow[],
  reference = Date.now(),
): LastRunSnapshot | null {
  const finished = latestRuns.find(
    (r) =>
      (r.status === 'done' || r.status === 'failed' || r.status === 'cancelled') && r.finished_at,
  );
  if (!finished || !finished.finished_at) return null;
  return {
    finishedAt: finished.finished_at,
    ageMs: Math.max(0, reference - finished.finished_at),
    durationMs:
      finished.started_at && finished.finished_at
        ? finished.finished_at - finished.started_at
        : null,
    conceptsDelta: (finished.created_files ?? 0) + (finished.updated_files ?? 0),
    filesProcessed: finished.done_files ?? 0,
    status: finished.status,
    repo: finished.repo,
    branch: finished.branch,
  };
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
  /** Optional href for actions that open a URL or runbook. */
  href?: string;
  /** Whether the UI should highlight this as the recommended action. */
  primary?: boolean;
}

export interface SyncDiagnostic {
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  detail: string;
  actions: DiagnosticAction[];
  /** Number of items that triggered this diagnostic. */
  affectedCount: number;
}

export interface DashboardStory {
  narrative: SyncNarrative;
  phases: SyncPhases;
  health: SyncHealth;
  lastRun: LastRunSnapshot | null;
  diagnostics: SyncDiagnostic[];
}

/**
 * "Uniform timeout" pattern: ≥5 failed items in the same run share the same
 * AbortSignal-style timeout error AND their failure durations cluster within
 * a tight band (±5s). This is almost always a configuration issue (the
 * `COMPOUND_LLM_TIMEOUT_MS` env is too low) or a model-selection issue
 * (everyone hits the same wall because the model is too slow).
 *
 * The naïve `category: 'timeout'` from sync-observability flags one big
 * group; we go further and detect that the timeouts are *uniform* (same
 * duration), which is a strong fingerprint for env / model misconfig vs.
 * occasional upstream flakiness.
 */
export function detectUniformTimeoutPattern(
  failedItems: SyncRunItemRow[],
  errorGroups: ErrorGroupRow[],
): {
  uniform: boolean;
  count: number;
  durationsMs: number[];
  representativeDurationSec: number | null;
  representativeMessage: string | null;
} {
  const timeoutItems = failedItems.filter((item) => {
    if (!item.error) return false;
    const text = item.error.toLowerCase();
    return (
      text.includes('operation was aborted') ||
      text.includes('timeouterror') ||
      text.includes('llm call exceeded wall-clock') ||
      text.includes('stream stalled')
    );
  });

  if (timeoutItems.length < 5) {
    return {
      uniform: false,
      count: timeoutItems.length,
      durationsMs: [],
      representativeDurationSec: null,
      representativeMessage: null,
    };
  }

  const durationsMs = timeoutItems
    .map((item) =>
      item.started_at && item.finished_at ? item.finished_at - item.started_at : null,
    )
    .filter((d): d is number => d != null && d > 0);

  // Are durations clustered? Spread = max - min must be ≤ 8 seconds for the
  // group to count as uniform.
  let uniform = false;
  let representativeDurationSec: number | null = null;
  if (durationsMs.length >= 5) {
    const min = Math.min(...durationsMs);
    const max = Math.max(...durationsMs);
    if (max - min <= 8_000) {
      uniform = true;
      const median = durationsMs.slice().sort((a, b) => a - b)[Math.floor(durationsMs.length / 2)];
      representativeDurationSec = Math.round(median / 1000);
    }
  } else if (timeoutItems.length >= 5) {
    // Even without timing data, ≥5 timeouts in one batch hints at a uniform issue.
    // Promote based on errorGroups: the timeout group should be ≥5.
    const tg = errorGroups.find((g) => g.category === 'timeout');
    if (tg && tg.count >= 5) uniform = true;
  }

  return {
    uniform,
    count: timeoutItems.length,
    durationsMs,
    representativeDurationSec,
    representativeMessage: timeoutItems[0]?.error?.slice(0, 200) ?? null,
  };
}

export function deriveDiagnostics(input: {
  failedItems: SyncRunItemRow[];
  errorGroups: ErrorGroupRow[];
  itemSummary: Record<SyncItemStatus, number>;
}): SyncDiagnostic[] {
  const out: SyncDiagnostic[] = [];

  const timeoutPattern = detectUniformTimeoutPattern(input.failedItems, input.errorGroups);
  if (timeoutPattern.uniform) {
    const durationCopy = timeoutPattern.representativeDurationSec
      ? `全部在第 ${timeoutPattern.representativeDurationSec} 秒被中断`
      : '失败时长高度一致';
    out.push({
      id: 'uniform-timeout',
      severity: 'critical',
      title: `${timeoutPattern.count} 个文件以同样方式超时`,
      detail:
        `${durationCopy}。这通常不是网络问题，而是 LLM 总时长 ` +
        `(COMPOUND_LLM_TIMEOUT_MS) 设得过短，或当前模型在你的 prompt 体积下太慢。` +
        `推荐先把 timeout 提到 ≥180000ms，或临时切换到 gpt-4o-mini 让队列尽快清空。`,
      affectedCount: timeoutPattern.count,
      actions: [
        {
          id: 'switch-fast-model',
          label: '换 gpt-4o-mini',
          primary: true,
        },
        {
          id: 'open-env',
          label: '查看 env 变量',
        },
        {
          id: 'open-runbook',
          label: '阅读 runbook',
          href: '/runbooks/llm-timeout-uniform.md',
        },
        {
          id: 'skip-failed',
          label: '跳过这批文件',
        },
      ],
    });
  } else if (timeoutPattern.count >= 3) {
    out.push({
      id: 'scattered-timeout',
      severity: 'warning',
      title: `${timeoutPattern.count} 个文件零散超时`,
      detail:
        '失败的耗时不一致，可能是模型偶发慢响应或网络抖动。可以先点重试；' +
        '若反复出现，再考虑提高 timeout 或换模型。',
      affectedCount: timeoutPattern.count,
      actions: [
        { id: 'retry-all', label: '全部重试', primary: true },
        { id: 'open-runbook', label: '阅读 runbook', href: '/runbooks/llm-gateway-degraded.md' },
      ],
    });
  }

  return out;
}

/** End-to-end derivation: takes a Dashboard payload and returns the story. */
export function deriveStory(
  dashboard: Pick<
    SyncDashboard,
    | 'activeRun'
    | 'latestRuns'
    | 'pipeline'
    | 'health'
    | 'errorGroups'
    | 'coverage'
    | 'itemSummary'
    | 'failedItems'
  >,
  reference = Date.now(),
): DashboardStory {
  const phases = bucketPhases(dashboard.pipeline);
  const lastRun = deriveLastRun(dashboard.latestRuns, reference);
  const reviewOpen =
    typeof dashboard.coverage.reviewOpen === 'number' ? dashboard.coverage.reviewOpen : 0;
  const errorGroupCount = dashboard.errorGroups.length;
  const narrative = deriveNarrative({
    run: dashboard.activeRun ?? dashboard.latestRuns[0] ?? null,
    health: dashboard.health,
    itemSummary: dashboard.itemSummary,
    errorGroupCount,
    reviewOpen,
    phases,
    lastRun,
  });
  const health = deriveHealth({
    coverage: dashboard.coverage,
    reviewOpen,
    errorGroupCount,
    itemSummary: dashboard.itemSummary,
  });
  const diagnostics = deriveDiagnostics({
    failedItems: dashboard.failedItems ?? [],
    errorGroups: dashboard.errorGroups,
    itemSummary: dashboard.itemSummary,
  });
  return { narrative, phases, health, lastRun, diagnostics };
}
