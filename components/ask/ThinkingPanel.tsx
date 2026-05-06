'use client';

import { useState } from 'react';
import { Icon } from '../Icons';
import type { AskMessageStage, AskStageKey } from '../../lib/types';

/**
 * Canonical 5-step pipeline. Order is fixed; stages received from the
 * server fill in their `status` / `detail`. Steps that haven't started
 * yet appear muted, the running one shows a spinner, finished ones get
 * a check.
 *
 * Labels are intentionally 拟人化 (humanized) so non-technical readers
 * can scan them; the technical `detail` from the server is rendered in
 * smaller type underneath as a 副标 ("LLM 重排到 Top-8" etc.).
 */
export const STAGE_DEFS: Array<{ key: AskStageKey; label: string }> = [
  { key: 'rewrite', label: '理解问题' },
  { key: 'retrieve', label: '翻阅 Wiki' },
  { key: 'graph', label: '比对相关概念' },
  { key: 'rerank', label: '整理思路' },
  { key: 'synthesize', label: '落笔' },
];

type StageRow = {
  key: AskStageKey;
  label: string;
  state: 'pending' | 'running' | 'done';
  detail?: string;
  conceptTitles?: string[];
  durationMs?: number;
};

function buildRows(stages: AskMessageStage[]): StageRow[] {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  // Find the last "done" stage; everything before it is implicitly done,
  // the next one is running, the rest are pending.
  const lastDoneIdx = STAGE_DEFS.reduce(
    (acc, def, idx) => (byKey.get(def.key)?.status === 'done' ? idx : acc),
    -1,
  );
  const runningIdx = STAGE_DEFS.findIndex((def) => byKey.get(def.key)?.status === 'running');

  return STAGE_DEFS.map((def, idx) => {
    const observed = byKey.get(def.key);
    let state: StageRow['state'] = 'pending';
    if (observed?.status === 'done' || idx <= lastDoneIdx) state = 'done';
    else if (observed?.status === 'running' || idx === runningIdx) state = 'running';
    else if (lastDoneIdx >= 0 && idx === lastDoneIdx + 1 && runningIdx === -1) state = 'running';
    return {
      key: def.key,
      label: def.label,
      state,
      detail: observed?.detail,
      conceptTitles: observed?.conceptTitles,
      durationMs: observed?.durationMs,
    };
  });
}

/**
 * Live thinking panel rendered while the answer is being produced.
 * Shows a vertical step list (Perplexity-style) plus a row of concept
 * chips for the retrieve / rerank stages so the user can see which
 * pages the AI is leafing through in real time.
 */
export function ThinkingPanel({
  stages,
  conceptCount,
}: {
  stages: AskMessageStage[];
  conceptCount: number | undefined;
}) {
  const rows = buildRows(stages);

  // Pull the most recent concept title list from any stage that surfaced one.
  const chipSource = [...rows].reverse().find((r) => r.conceptTitles && r.conceptTitles.length > 0);

  // Headline label = current running step, or the last done step,
  // or the very first pending one as a fallback.
  const current =
    rows.find((r) => r.state === 'running') ||
    [...rows].reverse().find((r) => r.state === 'done') ||
    rows[0];

  return (
    <div className="thinking-panel" aria-live="polite">
      <div className="thinking-panel-header">
        <span className="thinking-panel-title">
          <span className="thinking-panel-spinner" aria-hidden />
          {current?.label ?? 'Wiki 思考中'}
        </span>
        {typeof conceptCount === 'number' && conceptCount > 0 && (
          <span className="thinking-panel-meta">{conceptCount} 个概念页待检索</span>
        )}
      </div>

      <ol className="thinking-step-list" role="list">
        {rows.map((row) => (
          <li key={row.key} className={`thinking-step thinking-step-${row.state}`}>
            <span className="thinking-step-marker" aria-hidden>
              {row.state === 'done' && <Icon.Check />}
              {row.state === 'running' && <span className="thinking-step-spinner" />}
              {row.state === 'pending' && <span className="thinking-step-dot" />}
            </span>
            <span className="thinking-step-text">
              <span className="thinking-step-label">{row.label}</span>
              {row.detail && <span className="thinking-step-detail">{row.detail}</span>}
            </span>
          </li>
        ))}
      </ol>

      {chipSource?.conceptTitles && chipSource.conceptTitles.length > 0 && (
        <div className="thinking-chips" role="list" aria-label="正在阅读的概念页">
          {chipSource.conceptTitles.map((title, idx) => (
            <span
              key={`${title}-${idx}`}
              role="listitem"
              className="thinking-chip"
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              {title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsed strip rendered next to a finished AI answer so the user
 * can re-open the captured pipeline trace.
 */
export function ThinkingTrace({ stages }: { stages: AskMessageStage[] }) {
  const [open, setOpen] = useState(false);
  const rows = buildRows(stages);
  const doneCount = rows.filter((r) => r.state === 'done').length;
  const totalMs = rows.reduce((acc, r) => acc + (r.durationMs ?? 0), 0);

  return (
    <div className={`thinking-trace${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="thinking-trace-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`thinking-trace-caret${open ? ' is-open' : ''}`} aria-hidden>
          ▾
        </span>
        <span>
          思考过程（{doneCount} 步{totalMs > 0 ? ` · ${(totalMs / 1000).toFixed(1)}s` : ''}）
        </span>
      </button>
      {open && (
        <ol className="thinking-step-list thinking-step-list-collapsed" role="list">
          {rows.map((row) => (
            <li key={row.key} className={`thinking-step thinking-step-${row.state}`}>
              <span className="thinking-step-marker" aria-hidden>
                {row.state === 'done' ? <Icon.Check /> : <span className="thinking-step-dot" />}
              </span>
              <span className="thinking-step-text">
                <span className="thinking-step-label">{row.label}</span>
                {row.detail && <span className="thinking-step-detail">{row.detail}</span>}
                {row.conceptTitles && row.conceptTitles.length > 0 && (
                  <span className="thinking-trace-titles">
                    {row.conceptTitles.slice(0, 6).join(' · ')}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
