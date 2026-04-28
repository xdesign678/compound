'use client';

import { type SyncHealth } from './types';

interface Props {
  health: SyncHealth | null;
  reviewOpen: number;
  onOpenReview: () => void;
}

const SCORE_LABEL: Record<string, string> = {
  healthy: '健康',
  warning: '需要关注',
  critical: '需要修复',
};

/**
 * Replaces the V2 "Coverage" tab. Renders a one-line summary of the
 * knowledge base state plus a small chip per metric, instead of the
 * confusing % bars whose denominators were sometimes identical to their
 * numerators.
 */
export default function HealthLine({ health, reviewOpen, onOpenReview }: Props) {
  if (!health) return null;
  return (
    <section className={`sync-v2-health tone-${health.score}`} aria-label="知识库健康">
      <header className="sync-v2-section-head">
        <h2>
          知识库健康 ·
          <em className={`sync-v2-health-score tone-${health.score}`}>
            {SCORE_LABEL[health.score] ?? health.score}
          </em>
        </h2>
        {reviewOpen > 0 ? (
          <button type="button" className="sync-v2-link" onClick={onOpenReview}>
            前往审核 · {reviewOpen}
          </button>
        ) : null}
      </header>
      <ul className="sync-v2-health-chips">
        {health.details.map((detail) => (
          <li key={detail.label} className={`sync-v2-health-chip tone-${detail.tone}`}>
            <span className="sync-v2-health-chip-label">{detail.label}</span>
            <span className="sync-v2-health-chip-value">{detail.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
