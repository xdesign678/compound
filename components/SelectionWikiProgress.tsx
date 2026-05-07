'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getWikiFromSelectionRun, mirrorWikiFromSelectionResult } from '@/lib/api-client';
import {
  forgetSelectionWikiRun,
  readTrackedSelectionWikiRuns,
  SELECTION_WIKI_RUNS_EVENT,
  type TrackedSelectionWikiRun,
} from '@/lib/selection-wiki-runs';
import { useAppStore } from '@/lib/store';
import type { SelectionWikiRunStatusResponse } from '@/lib/types';

const POLL_INTERVAL_MS = 1_500;

const PHASE_LABEL: Record<SelectionWikiRunStatusResponse['phase'], string> = {
  queued: '排队中',
  loading_context: '整理上下文',
  generating: 'AI 正在生成',
  persisting: '写入 Wiki',
  done: '已完成',
};

export function SelectionWikiProgress() {
  const [runs, setRuns] = useState<TrackedSelectionWikiRun[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SelectionWikiRunStatusResponse>>({});
  const completedRef = useRef<Set<string>>(new Set());
  const openConcept = useAppStore((s) => s.openConcept);
  const markFresh = useAppStore((s) => s.markFresh);
  const showToast = useAppStore((s) => s.showToast);
  const showErrorToast = useAppStore((s) => s.showErrorToast);

  useEffect(() => {
    setRuns(readTrackedSelectionWikiRuns());

    const handleRun = (event: Event) => {
      const detail = (event as CustomEvent<TrackedSelectionWikiRun>).detail;
      if (!detail?.runId) return;
      setRuns((current) => [detail, ...current.filter((run) => run.runId !== detail.runId)]);
    };
    const handleStorage = () => setRuns(readTrackedSelectionWikiRuns());

    window.addEventListener(SELECTION_WIKI_RUNS_EVENT, handleRun);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(SELECTION_WIKI_RUNS_EVENT, handleRun);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const activeRunIds = useMemo(
    () =>
      runs
        .filter((run) => statuses[run.runId]?.status !== 'failed')
        .map((run) => run.runId)
        .join('|'),
    [runs, statuses],
  );

  useEffect(() => {
    if (!activeRunIds) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const activeRuns = runs.filter((run) => statuses[run.runId]?.status !== 'failed');
      for (const run of activeRuns) {
        try {
          const status = await getWikiFromSelectionRun(run.runId);
          if (cancelled) return;
          setStatuses((current) => ({ ...current, [run.runId]: status }));

          if (status.status === 'done' && status.result && !completedRef.current.has(run.runId)) {
            completedRef.current.add(run.runId);
            await mirrorWikiFromSelectionResult(status.result);
            forgetSelectionWikiRun(run.runId);
            setRuns(readTrackedSelectionWikiRuns());
            if (status.result.status === 'created') {
              markFresh([status.result.conceptId]);
              showToast('选段 Wiki 已创建');
            } else {
              showToast('已有等价概念，已为你打开');
            }
            openConcept(status.result.conceptId);
          } else if (status.status === 'failed') {
            forgetSelectionWikiRun(run.runId);
            showErrorToast(status.error || '选段建页失败');
          }
        } catch (err) {
          if (cancelled) return;
          const message = err instanceof Error ? err.message : '状态查询失败';
          setStatuses((current) => ({
            ...current,
            [run.runId]: {
              ...(current[run.runId] ?? {
                runId: run.runId,
                phase: 'queued',
                selectionPreview: run.selectionPreview,
                startedAt: run.startedAt,
                finishedAt: null,
                result: null,
              }),
              runId: run.runId,
              status: 'running',
              error: message,
            },
          }));
        }
      }
      if (!cancelled) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeRunIds, markFresh, openConcept, runs, showErrorToast, showToast, statuses]);

  const visibleRuns = runs.filter((run) => {
    const status = statuses[run.runId];
    return !status || status.status === 'running' || status.status === 'failed';
  });

  if (visibleRuns.length === 0) return null;

  return (
    <div className="selection-wiki-progress" role="status" aria-live="polite">
      <div className="selection-wiki-progress-title">Wiki 创建</div>
      {visibleRuns.map((run) => {
        const status = statuses[run.runId];
        const failed = status?.status === 'failed';
        return (
          <div key={run.runId} className="selection-wiki-progress-item">
            <div className="selection-wiki-progress-row">
              <span className={failed ? 'status-dot failed' : 'status-dot'} />
              <span className="selection-wiki-progress-phase">
                {failed ? '创建失败' : PHASE_LABEL[status?.phase ?? 'queued']}
              </span>
              {failed && (
                <button
                  className="selection-wiki-progress-close"
                  type="button"
                  onClick={() => {
                    forgetSelectionWikiRun(run.runId);
                    setRuns(readTrackedSelectionWikiRuns());
                  }}
                  aria-label="关闭"
                >
                  x
                </button>
              )}
            </div>
            <div className="selection-wiki-progress-preview">
              {status?.selectionPreview || run.selectionPreview}
            </div>
            {status?.error && <div className="selection-wiki-progress-error">{status.error}</div>}
          </div>
        );
      })}
    </div>
  );
}
