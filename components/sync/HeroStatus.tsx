'use client';

import { type ReactNode } from 'react';
import { fmtDuration, type DashboardStory, type SyncRun } from './types';

interface Props {
  story: DashboardStory | null;
  run: SyncRun | null;
  busy: boolean;
  reviewOpen: number;
  onPrimary: () => void;
  onCancel: () => void;
  onOpenReview: () => void;
  rightSlot?: ReactNode;
}

const TONE_CLASS: Record<string, string> = {
  idle: 'sync-v2-hero-idle',
  done: 'sync-v2-hero-done',
  running: 'sync-v2-hero-running',
  error: 'sync-v2-hero-error',
  stalled: 'sync-v2-hero-stalled',
  review: 'sync-v2-hero-review',
};

const PRIMARY_LABEL: Record<string, string> = {
  sync: '立即同步',
  retry: '重试失败',
  cancel: '取消运行',
  review: '前往审核',
  wait: '等待中',
};

/**
 * Single-glance "what's happening now" card. Replaces the dense 4-stat grid
 * + topbar that the V2 layout used. Renders the narrative story and exposes
 * exactly one primary action so the user never has to choose between
 * "sync"/"worker"/"retry" buttons.
 */
export default function HeroStatus({
  story,
  run,
  busy,
  reviewOpen,
  onPrimary,
  onCancel,
  onOpenReview,
  rightSlot,
}: Props) {
  const narrative = story?.narrative;
  const tone = narrative?.tone ?? 'idle';
  const headline = narrative?.headline ?? '尚未运行同步';
  const subline = narrative?.subline ?? '点击「立即同步」从 GitHub 拉取最新 Markdown';
  const nextAction = narrative?.nextAction ?? 'sync';
  const showCancel = run?.status === 'running';
  const primaryLabel = PRIMARY_LABEL[nextAction] ?? '立即同步';
  const runtimeMs =
    run?.started_at != null
      ? run.status === 'running'
        ? Date.now() - run.started_at
        : (run.finished_at ?? run.started_at) - run.started_at
      : null;

  const meta: string[] = [];
  if (run?.repo) meta.push(`${run.repo}@${run.branch || 'main'}`);
  if (runtimeMs != null) meta.push(`运行 ${fmtDuration(runtimeMs)}`);

  return (
    <section className={`sync-v2-hero ${TONE_CLASS[tone] ?? ''}`} aria-live="polite">
      <div className="sync-v2-hero-body">
        <span className={`sync-v2-hero-pulse tone-${tone}`} aria-hidden="true" />
        <div className="sync-v2-hero-text">
          <h1>{headline}</h1>
          <p>{subline}</p>
          {meta.length > 0 ? <small>{meta.join(' · ')}</small> : null}
        </div>
      </div>

      <div className="sync-v2-hero-actions">
        {nextAction === 'review' ? (
          <button
            type="button"
            className="sync-v2-btn sync-v2-btn-primary"
            disabled={busy}
            onClick={onOpenReview}
          >
            {primaryLabel}
          </button>
        ) : (
          <button
            type="button"
            className="sync-v2-btn sync-v2-btn-primary"
            disabled={busy || nextAction === 'wait'}
            onClick={onPrimary}
          >
            {busy ? '处理中…' : primaryLabel}
          </button>
        )}
        {showCancel ? (
          <button
            type="button"
            className="sync-v2-btn sync-v2-btn-danger"
            disabled={busy}
            onClick={onCancel}
            title="终止当前运行"
          >
            取消
          </button>
        ) : null}
        {reviewOpen > 0 && nextAction !== 'review' ? (
          <button
            type="button"
            className="sync-v2-btn sync-v2-btn-ghost"
            onClick={onOpenReview}
            title={`${reviewOpen} 条概念待审`}
          >
            审核 · {reviewOpen}
          </button>
        ) : null}
        {rightSlot}
      </div>
    </section>
  );
}
