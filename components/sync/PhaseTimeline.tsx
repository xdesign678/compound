'use client';

import { useState } from 'react';
import { STAGE_TEXT, type PhaseInfo, type PhaseKey, type SyncPhases } from './types';

interface Props {
  phases: SyncPhases | null;
}

const PHASE_ORDER: PhaseKey[] = ['fetch', 'analyze', 'publish'];

const TONE_LABEL: Record<string, string> = {
  pending: '待开始',
  running: '进行中',
  done: '完成',
  failed: '失败',
};

/**
 * Vertical 3-step timeline replacing the 14-stage `PipelineStrip`. Each
 * row collapses several raw `analysis_jobs.stage` rows; the user can
 * expand a phase to see the underlying technical breakdown when
 * troubleshooting.
 */
export default function PhaseTimeline({ phases }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (!phases) return null;
  return (
    <ol className="sync-v2-phases" aria-label="同步与分析阶段">
      {PHASE_ORDER.map((key, idx) => {
        const phase = phases[key];
        const isOpen = !!expanded[key];
        const percent = computePercent(phase);
        return (
          <li key={key} className={`sync-v2-phase tone-${phase.status}`}>
            <button
              type="button"
              className="sync-v2-phase-row"
              onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}
              aria-expanded={isOpen}
            >
              <span className="sync-v2-phase-index" aria-hidden="true">
                {idx + 1}
              </span>
              <span className="sync-v2-phase-content">
                <span className="sync-v2-phase-head">
                  <strong>{phase.label}</strong>
                  <em className={`sync-v2-phase-status tone-${phase.status}`}>
                    {phaseStatusText(phase)}
                  </em>
                </span>
                <span className="sync-v2-phase-desc">{phase.description}</span>
                {phase.total > 0 ? (
                  <span
                    className="sync-v2-phase-bar"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </span>
                ) : null}
              </span>
              <span className="sync-v2-phase-disclosure" aria-hidden="true">
                {isOpen ? '−' : '+'}
              </span>
            </button>
            {isOpen ? <RawStages phase={phase} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function phaseStatusText(phase: PhaseInfo): string {
  if (phase.status === 'running') {
    if (phase.total > 0) return `${phase.done}/${phase.total} · 进行中`;
    return '进行中';
  }
  if (phase.status === 'failed') return `${phase.failed} 失败`;
  if (phase.status === 'pending') {
    return phase.total > 0 ? `${phase.done}/${phase.total}` : '待开始';
  }
  return TONE_LABEL[phase.status] ?? phase.status;
}

function computePercent(phase: PhaseInfo): number {
  if (phase.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((phase.done / phase.total) * 100)));
}

function RawStages({ phase }: { phase: PhaseInfo }) {
  if (phase.rawStages.length === 0) {
    return <div className="sync-v2-phase-detail">该阶段尚未产生明细任务。</div>;
  }
  return (
    <ul className="sync-v2-phase-detail" aria-label={`${phase.label}的子阶段`}>
      {phase.rawStages.map((stage) => (
        <li key={stage.stage} className="sync-v2-phase-detail-row">
          <span className="sync-v2-phase-detail-label">
            {STAGE_TEXT[stage.stage] || stage.label}
          </span>
          <span className="sync-v2-phase-detail-counts">
            {stage.succeeded > 0 ? <em className="good">{stage.succeeded} 成功</em> : null}
            {stage.running > 0 ? <em className="warn">{stage.running} 运行</em> : null}
            {stage.queued > 0 ? <em className="warn">{stage.queued} 排队</em> : null}
            {stage.failed > 0 ? <em className="bad">{stage.failed} 失败</em> : null}
            {stage.skipped > 0 ? <em className="muted">{stage.skipped} 跳过</em> : null}
            {stage.total === 0 ? <em className="muted">空</em> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
