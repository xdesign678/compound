import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bucketPhases,
  deriveDiagnostics,
  deriveHealth,
  deriveLastRun,
  deriveNarrative,
  deriveStory,
  detectUniformTimeoutPattern,
  formatAge,
} from './sync-narrative';
import type {
  ErrorGroupRow,
  PipelineStageRow,
  RunHealth,
  SyncRunItemRow,
  SyncRunRow,
} from './sync-observability';

function makeFailedItem(parts: Partial<SyncRunItemRow> = {}): SyncRunItemRow {
  const base = Date.now();
  return {
    id: `it-${Math.random().toString(36).slice(2, 8)}`,
    run_id: 'run-1',
    path: 'a.md',
    old_sha: null,
    new_sha: null,
    external_key: null,
    source_id: null,
    change_type: 'update',
    status: 'failed',
    stage: 'llm',
    attempts: 1,
    chunks: null,
    concepts_created: null,
    concepts_updated: null,
    evidence: null,
    error: 'The operation was aborted due to timeout',
    started_at: base - 55_000,
    finished_at: base,
    updated_at: base,
    ...parts,
  };
}

function makeErrorGroup(parts: Partial<ErrorGroupRow> = {}): ErrorGroupRow {
  return {
    fingerprint: 'timeout',
    category: 'timeout',
    message: 'The operation was aborted due to timeout',
    stage: 'llm',
    count: 5,
    lastAt: Date.now(),
    examples: [],
    suggestion: 'fix it',
    ...parts,
  };
}

function pipelineRow(stage: string, parts: Partial<PipelineStageRow> = {}): PipelineStageRow {
  return {
    stage,
    label: stage,
    total: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    ...parts,
  };
}

function makeRun(parts: Partial<SyncRunRow> = {}): SyncRunRow {
  const base = Date.now();
  return {
    id: 'run-1',
    kind: 'github',
    trigger_type: 'manual',
    repo: 'org/repo',
    branch: 'main',
    head_sha: null,
    status: 'done',
    stage: 'complete',
    total_files: 0,
    changed_files: 5,
    created_files: 2,
    updated_files: 3,
    deleted_files: 0,
    skipped_files: 0,
    done_files: 5,
    failed_files: 0,
    current: null,
    error: null,
    started_at: base - 60_000,
    finished_at: base - 30_000,
    heartbeat_at: base - 30_000,
    ...parts,
  };
}

function emptyHealth(): RunHealth {
  return {
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    heartbeatAgeMs: null,
    runtimeMs: null,
    stalled: false,
    stalledFor: 0,
    lastEventAt: null,
  };
}

test('formatAge handles seconds, minutes, hours, days', () => {
  assert.equal(formatAge(0), '0 秒');
  assert.equal(formatAge(45_000), '45 秒');
  assert.equal(formatAge(2 * 60_000), '2 分钟');
  assert.equal(formatAge(3 * 60 * 60_000), '3 小时');
  assert.equal(formatAge(2 * 24 * 60 * 60_000), '2 天');
  assert.equal(formatAge(null), '一段时间');
  assert.equal(formatAge(-1), '一段时间');
});

test('bucketPhases groups raw stages into 3 phases and computes status', () => {
  const phases = bucketPhases([
    pipelineRow('github_ingest', { total: 4, succeeded: 4 }),
    pipelineRow('chunk', { total: 4, succeeded: 4 }),
    pipelineRow('llm', { total: 4, succeeded: 2, running: 1, queued: 1 }),
    pipelineRow('embedding', { total: 4, queued: 4 }),
    pipelineRow('fts', { total: 0 }),
    pipelineRow('qa_index', { total: 0 }),
  ]);
  assert.equal(phases.fetch.status, 'done');
  assert.equal(phases.fetch.done, 4);
  assert.equal(phases.analyze.status, 'running');
  assert.equal(phases.analyze.total, 12);
  assert.equal(phases.publish.status, 'pending');
});

test('bucketPhases marks phase failed when all items finished and some failed', () => {
  const phases = bucketPhases([pipelineRow('chunk', { total: 3, succeeded: 1, failed: 2 })]);
  assert.equal(phases.analyze.status, 'failed');
});

test('deriveNarrative shows running headline with phase context', () => {
  const phases = bucketPhases([
    pipelineRow('chunk', { total: 5, running: 2, queued: 1, succeeded: 2 }),
  ]);
  const narrative = deriveNarrative({
    run: makeRun({ status: 'running', changed_files: 5, done_files: 2, failed_files: 0 }),
    health: emptyHealth(),
    itemSummary: { queued: 1, running: 2, succeeded: 2, failed: 0, skipped: 0, cancelled: 0 },
    errorGroupCount: 0,
    reviewOpen: 0,
    phases,
    lastRun: null,
  });
  assert.equal(narrative.tone, 'running');
  assert.equal(narrative.nextAction, 'cancel');
  assert.match(narrative.headline, /2\/5/);
  assert.match(narrative.subline, /AI 理解/);
});

test('deriveNarrative escalates to stalled when heartbeat is too old', () => {
  const narrative = deriveNarrative({
    run: makeRun({ status: 'running' }),
    health: { ...emptyHealth(), stalled: true, stalledFor: 90_000 },
    itemSummary: { queued: 0, running: 1, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
    errorGroupCount: 0,
    reviewOpen: 0,
    phases: bucketPhases([]),
    lastRun: null,
  });
  assert.equal(narrative.tone, 'stalled');
  assert.equal(narrative.nextAction, 'sync');
});

test('deriveNarrative surfaces failures with retry hint', () => {
  const narrative = deriveNarrative({
    run: makeRun({ status: 'failed', error: 'GitHub 401' }),
    health: emptyHealth(),
    itemSummary: { queued: 0, running: 0, succeeded: 0, failed: 2, skipped: 0, cancelled: 0 },
    errorGroupCount: 1,
    reviewOpen: 0,
    phases: bucketPhases([]),
    lastRun: null,
  });
  assert.equal(narrative.tone, 'error');
  assert.equal(narrative.nextAction, 'retry');
  assert.match(narrative.headline, /失败/);
});

test('deriveNarrative builds idle story with last run + concept delta', () => {
  const lastRun = {
    finishedAt: Date.now() - 17 * 60_000,
    ageMs: 17 * 60_000,
    durationMs: 30_000,
    conceptsDelta: 12,
    filesProcessed: 12,
    status: 'done',
    repo: 'org/repo',
    branch: 'main',
  };
  const narrative = deriveNarrative({
    run: null,
    health: emptyHealth(),
    itemSummary: { queued: 0, running: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
    errorGroupCount: 0,
    reviewOpen: 0,
    phases: bucketPhases([]),
    lastRun,
  });
  assert.equal(narrative.tone, 'done');
  assert.equal(narrative.nextAction, 'sync');
  assert.match(narrative.headline, /17 分钟前/);
  assert.match(narrative.headline, /12 个/);
});

test('deriveNarrative falls back to review prompt when nothing has run yet but reviews are open', () => {
  const narrative = deriveNarrative({
    run: null,
    health: emptyHealth(),
    itemSummary: { queued: 0, running: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
    errorGroupCount: 0,
    reviewOpen: 3,
    phases: bucketPhases([]),
    lastRun: null,
  });
  assert.equal(narrative.tone, 'review');
  assert.equal(narrative.nextAction, 'review');
  assert.match(narrative.headline, /3 条概念待审/);
});

test('deriveHealth scores critical when failures present', () => {
  const health = deriveHealth({
    coverage: { sourceChunks: 100, chunkFtsRows: 100, chunkEmbeddings: 100, ftsReady: true },
    reviewOpen: 0,
    errorGroupCount: 1,
    itemSummary: { queued: 0, running: 0, succeeded: 0, failed: 2, skipped: 0, cancelled: 0 },
  });
  assert.equal(health.score, 'critical');
  assert.match(health.summary, /已同步/);
});

test('deriveHealth scores warning for low FTS coverage', () => {
  const health = deriveHealth({
    coverage: {
      sources: 50,
      sourceChunks: 100,
      chunkFtsRows: 50,
      chunkEmbeddings: 100,
      ftsReady: true,
    },
    reviewOpen: 0,
    errorGroupCount: 0,
    itemSummary: { queued: 0, running: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
  });
  assert.equal(health.score, 'warning');
});

test('deriveHealth scores healthy when all good', () => {
  const health = deriveHealth({
    coverage: {
      sources: 50,
      sourceChunks: 100,
      chunkFtsRows: 100,
      chunkEmbeddings: 100,
      ftsReady: true,
    },
    reviewOpen: 0,
    errorGroupCount: 0,
    itemSummary: { queued: 0, running: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
  });
  assert.equal(health.score, 'healthy');
});

test('deriveLastRun picks the most recent finished run', () => {
  const ref = Date.now();
  const runs = [
    makeRun({ id: 'run-2', status: 'running', finished_at: null }),
    makeRun({
      id: 'run-1',
      status: 'done',
      finished_at: ref - 5 * 60_000,
      started_at: ref - 6 * 60_000,
    }),
  ];
  const lastRun = deriveLastRun(runs, ref);
  assert.ok(lastRun);
  assert.equal(lastRun!.status, 'done');
  assert.equal(lastRun!.ageMs, 5 * 60_000);
});

test('deriveLastRun returns null when no runs are finished', () => {
  const ref = Date.now();
  const runs = [makeRun({ status: 'running', finished_at: null })];
  assert.equal(deriveLastRun(runs, ref), null);
});

test('deriveStory wires everything together', () => {
  const ref = Date.now();
  const story = deriveStory(
    {
      activeRun: null,
      latestRuns: [
        makeRun({
          id: 'run-1',
          status: 'done',
          finished_at: ref - 60_000,
          started_at: ref - 90_000,
          created_files: 4,
          updated_files: 1,
        }),
      ],
      pipeline: [pipelineRow('github_ingest', { total: 5, succeeded: 5 })],
      health: emptyHealth(),
      errorGroups: [],
      coverage: {
        sources: 5,
        sourceChunks: 10,
        chunkFtsRows: 10,
        chunkEmbeddings: 10,
        ftsReady: true,
      },
      itemSummary: { queued: 0, running: 0, succeeded: 5, failed: 0, skipped: 0, cancelled: 0 },
      failedItems: [],
    },
    ref,
  );
  assert.equal(story.narrative.tone, 'done');
  assert.match(story.narrative.headline, /1 分钟前/);
  assert.equal(story.phases.fetch.status, 'done');
  assert.equal(story.health.score, 'healthy');
  assert.ok(story.lastRun);
  assert.deepEqual(story.diagnostics, []);
});

test('detectUniformTimeoutPattern flags 16 files at 55s', () => {
  const base = Date.now();
  const failed: SyncRunItemRow[] = Array.from({ length: 16 }, (_, i) =>
    makeFailedItem({
      id: `it-${i}`,
      started_at: base - 55_500 + i * 80, // tight cluster around 55s ± few hundred ms
      finished_at: base,
      error: 'The operation was aborted due to timeout',
    }),
  );
  const result = detectUniformTimeoutPattern(failed, [makeErrorGroup({ count: 16 })]);
  assert.equal(result.uniform, true);
  assert.equal(result.count, 16);
  assert.ok(result.representativeDurationSec);
  assert.ok(result.representativeDurationSec! >= 54 && result.representativeDurationSec! <= 56);
});

test('detectUniformTimeoutPattern marks scattered failures as non-uniform', () => {
  const base = Date.now();
  const failed: SyncRunItemRow[] = [
    makeFailedItem({ started_at: base - 30_000, finished_at: base }),
    makeFailedItem({ started_at: base - 80_000, finished_at: base }),
    makeFailedItem({ started_at: base - 12_000, finished_at: base }),
    makeFailedItem({ started_at: base - 60_000, finished_at: base }),
    makeFailedItem({ started_at: base - 5_000, finished_at: base }),
  ];
  const result = detectUniformTimeoutPattern(failed, [makeErrorGroup({ count: 5 })]);
  assert.equal(result.uniform, false);
  assert.equal(result.count, 5);
});

test('detectUniformTimeoutPattern ignores non-timeout errors', () => {
  const failed: SyncRunItemRow[] = Array.from({ length: 8 }, () =>
    makeFailedItem({ error: 'GitHub 404 not found' }),
  );
  const result = detectUniformTimeoutPattern(failed, []);
  assert.equal(result.uniform, false);
  assert.equal(result.count, 0);
});

test('deriveDiagnostics produces critical banner for uniform timeout', () => {
  const base = Date.now();
  const failed: SyncRunItemRow[] = Array.from({ length: 6 }, () =>
    makeFailedItem({
      started_at: base - 55_000,
      finished_at: base,
    }),
  );
  const diags = deriveDiagnostics({
    failedItems: failed,
    errorGroups: [makeErrorGroup({ count: 6 })],
    itemSummary: { queued: 0, running: 0, succeeded: 0, failed: 6, skipped: 0, cancelled: 0 },
  });
  assert.equal(diags.length, 1);
  assert.equal(diags[0].severity, 'critical');
  assert.equal(diags[0].id, 'uniform-timeout');
  assert.ok(diags[0].actions.find((a) => a.id === 'switch-fast-model'));
});

test('deriveDiagnostics returns empty for healthy run', () => {
  const diags = deriveDiagnostics({
    failedItems: [],
    errorGroups: [],
    itemSummary: { queued: 0, running: 0, succeeded: 5, failed: 0, skipped: 0, cancelled: 0 },
  });
  assert.deepEqual(diags, []);
});
