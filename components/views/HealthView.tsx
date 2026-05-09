'use client';

import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import {
  getRepairStatus,
  pruneDeletedConcepts,
  startRepair,
  startLintRun,
  getLintStatus,
  type RepairFindingPayload,
  type RepairStatusResponse,
  type LintRunStatusResponse,
} from '@/lib/api-client';
import { pullSnapshotFromCloud } from '@/lib/cloud-sync';
import { formatRelativeTime } from '@/lib/format';
import { Icon } from '../Icons';
import type { ActivityLog, Concept } from '@/lib/types';

interface Finding {
  type: 'orphan' | 'stale' | 'thin' | 'contradiction' | 'missing-link' | 'duplicate';
  message: string;
  conceptIds: string[];
}

type RepairFindingType = RepairFindingPayload['type'];
const FIXABLE_TYPES: RepairFindingType[] = ['duplicate', 'missing-link', 'orphan', 'contradiction'];

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const THIN_THRESHOLD = 200;
const REPAIR_RUN_STORAGE_KEY = 'compound_active_repair_run';
const LINT_RUN_STORAGE_KEY = 'compound_active_lint_run';
const POLL_MS = 2000;

function isFixable(type: Finding['type']): type is RepairFindingType {
  return (FIXABLE_TYPES as string[]).includes(type);
}

function toRepairPayload(findings: Finding[]): RepairFindingPayload[] {
  return findings
    .filter((f): f is Finding & { type: RepairFindingType } => isFixable(f.type))
    .map((f) => ({ type: f.type, message: f.message, conceptIds: f.conceptIds }));
}

function maybeNotify(title: string, body: string): void {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {
    // SW-only notifications — silently ignore.
  }
}

function buildLocalFindings(concepts: Concept[]): Finding[] {
  const now = Date.now();
  const findings: Finding[] = [];

  for (const concept of concepts) {
    if (concept.related.length === 0 && concept.sources.length <= 1) {
      findings.push({
        type: 'orphan',
        message: `"${concept.title}" 是孤岛概念 — 没有关联概念，仅有 ${concept.sources.length} 个来源`,
        conceptIds: [concept.id],
      });
    }

    if (now - concept.updatedAt > THIRTY_DAYS) {
      findings.push({
        type: 'stale',
        message: `"${concept.title}" 已超过 30 天未更新`,
        conceptIds: [concept.id],
      });
    }

    if (concept.contentStatus === 'full' && concept.body.length < THIN_THRESHOLD) {
      findings.push({
        type: 'thin',
        message: `"${concept.title}" 内容较单薄 (${concept.body.length} 字符)，建议补充更多资料`,
        conceptIds: [concept.id],
      });
    }
  }

  return findings;
}

export function HealthView() {
  const openConcept = useAppStore((s) => s.openConcept);
  const openModal = useAppStore((s) => s.openModal);
  const lintFindings = useAppStore((s) => s.lintFindings);
  const lastLintAt = useAppStore((s) => s.lastLintAt);
  const lintRunning = useAppStore((s) => s.lintRunning);
  const setLintResult = useAppStore((s) => s.setLintResult);
  const setLintRunning = useAppStore((s) => s.setLintRunning);
  const setLintBanner = useAppStore((s) => s.setLintBanner);
  const hydrateLastLintAt = useAppStore((s) => s.hydrateLastLintAt);

  const showToast = useAppStore((s) => s.showToast);
  const showErrorToast = useAppStore((s) => s.showErrorToast);

  const [localFindings, setLocalFindings] = useState<Finding[]>([]);
  const [conceptTitleMap, setConceptTitleMap] = useState<Map<string, string>>(new Map());
  const [localScanAt, setLocalScanAt] = useState<number | null>(null);
  const [repairRun, setRepairRun] = useState<RepairStatusResponse | null>(null);
  const [repairStarting, setRepairStarting] = useState(false);
  const [repairError, setRepairError] = useState('');
  const repairDoneRef = useRef<Set<string>>(new Set());

  // async lint state (cloud-side)
  const [lintRun, setLintRun] = useState<LintRunStatusResponse | null>(null);
  const lintDoneRef = useRef<Set<string>>(new Set());
  const lintRunId = lintRun?.id;
  const hasLintRun = lintRun !== null;

  useEffect(() => {
    hydrateLastLintAt();
  }, [hydrateLastLintAt]);

  const conceptCount = useLiveQuery(() => getDb().concepts.count(), []);
  const sourceCount = useLiveQuery(() => getDb().sources.count(), []);

  const allFindings = useMemo<Finding[]>(() => {
    const apiFindings: Finding[] = lintFindings.map((finding) => ({
      type: finding.type as Finding['type'],
      message: finding.message,
      conceptIds: finding.conceptIds,
    }));
    return [...localFindings, ...apiFindings];
  }, [lintFindings, localFindings]);

  const healthScore = useMemo(() => {
    const totalConcepts = conceptCount ?? 0;
    if (totalConcepts === 0) return 100;
    const orphanPenalty = allFindings.filter((finding) => finding.type === 'orphan').length * 5;
    const stalePenalty = allFindings.filter((finding) => finding.type === 'stale').length * 3;
    const thinPenalty = allFindings.filter((finding) => finding.type === 'thin').length * 2;
    const lintPenalty =
      allFindings.filter((finding) =>
        ['contradiction', 'missing-link', 'duplicate'].includes(finding.type),
      ).length * 8;
    return Math.max(0, 100 - orphanPenalty - stalePenalty - thinPenalty - lintPenalty);
  }, [allFindings, conceptCount]);

  const scoreColor = healthScore >= 80 ? 'good' : healthScore >= 50 ? 'warn' : 'bad';

  const fixableCount = useMemo(
    () => allFindings.filter((f) => isFixable(f.type)).length,
    [allFindings],
  );
  const repairProgress =
    repairRun && repairRun.total > 0
      ? Math.round(((repairRun.done + repairRun.failed) / repairRun.total) * 100)
      : 0;

  const pollRepairRun = useCallback(async (runId: string): Promise<RepairStatusResponse | null> => {
    try {
      const status = await getRepairStatus(runId);
      setRepairRun(status);
      return status;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRepairError(message);
      if (/run not found/i.test(message)) {
        try {
          localStorage.removeItem(REPAIR_RUN_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        setRepairRun(null);
      }
      return null;
    }
  }, []);

  const pollLintRun = useCallback(async (runId: string): Promise<LintRunStatusResponse> => {
    const status = await getLintStatus(runId);
    setLintRun(status);
    return status;
  }, []);

  const onRepairFinished = useCallback(
    async (status: RepairStatusResponse) => {
      if (repairDoneRef.current.has(status.id)) return;
      repairDoneRef.current.add(status.id);
      try {
        localStorage.removeItem(REPAIR_RUN_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      try {
        await pruneDeletedConcepts(status.summary.deletedConceptIds || []);
        await pullSnapshotFromCloud();
      } catch (err) {
        console.warn('[repair] post-repair sync failed:', err);
      }
      const s = status.summary;
      const toastText = `一键修复完成：合并 ${s.merged}、建链 ${s.linked}、孤岛补 ${s.orphanFixed}、冲突入审 ${s.conflictQueued}`;
      showToast(toastText, false, status.status === 'failed');
      maybeNotify('Compound 一键修复完成', toastText);
      setLintResult([]);
    },
    [setLintResult, showToast],
  );

  const onLintFinished = useCallback(
    async (status: LintRunStatusResponse) => {
      if (lintDoneRef.current.has(status.id)) return;
      lintDoneRef.current.add(status.id);
      try {
        localStorage.removeItem(LINT_RUN_STORAGE_KEY);
      } catch {
        /* ignore */
      }

      setLintRunning(false);

      // Write activity log entry
      const detail =
        status.findings.length === 0
          ? '未发现问题 · Wiki 结构健康'
          : `发现 ${status.findings.length} 处问题需要关注`;
      const activity: ActivityLog = {
        id: 'a-' + nanoid(8),
        type: 'lint',
        title: status.status === 'failed' ? '深度检查失败' : '深度检查完成',
        details: status.status === 'failed' ? (status.error ?? '未知错误').slice(0, 140) : detail,
        status: status.status === 'failed' ? 'error' : 'success',
        at: Date.now(),
      };
      await getDb().activity.put(activity);

      if (status.status === 'failed') {
        setLintBanner({
          tone: 'error',
          title: '深度检查失败',
          details: status.error ?? '未知错误',
        });
        return;
      }

      setLintBanner(null);

      // Merge local + server findings
      const concepts = await getDb().concepts.toArray();
      setConceptTitleMap(new Map(concepts.map((c) => [c.id, c.title])));
      setLocalFindings(buildLocalFindings(concepts));
      setLocalScanAt(Date.now());
      setLintResult(status.findings);
    },
    [setLintResult, setLintRunning, setLintBanner],
  );

  // Poll active repair run
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedId = (() => {
      try {
        return localStorage.getItem(REPAIR_RUN_STORAGE_KEY);
      } catch {
        return null;
      }
    })();
    const activeId = repairRun?.id ?? storedId;
    if (!activeId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      const status = await pollRepairRun(activeId);
      if (cancelled || !status) return;
      if (status.status === 'running') {
        timer = setTimeout(tick, POLL_MS);
      } else {
        await onRepairFinished(status);
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [repairRun?.id, pollRepairRun, onRepairFinished]);

  // Poll active lint run (also resumes after page refresh)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedId = (() => {
      try {
        return localStorage.getItem(LINT_RUN_STORAGE_KEY);
      } catch {
        return null;
      }
    })();
    const activeId = lintRunId ?? storedId;
    if (!activeId) return;
    if (!hasLintRun && storedId) {
      setLintRunning(true);
      setLintRun({
        id: storedId,
        status: 'running',
        phase: 'loading_concepts',
        conceptCount: 0,
        findings: [],
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
      });
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      let status: LintRunStatusResponse;
      try {
        status = await pollLintRun(activeId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/run not found/i.test(message)) {
          try {
            localStorage.removeItem(LINT_RUN_STORAGE_KEY);
          } catch {
            /* ignore */
          }
          setLintRun(null);
          setLintRunning(false);
          setLintBanner({
            tone: 'error',
            title: '深度检查已失效',
            details: '找不到正在运行的检查任务，请重新启动。',
          });
          return;
        }
        setLintBanner({
          tone: 'running',
          title: '深度检查状态同步中',
          details: `暂时无法获取进度：${message}`,
        });
        timer = setTimeout(tick, POLL_MS);
        return;
      }
      if (cancelled) return;
      if (status.status === 'running') {
        // update banner with real progress from server
        const phaseLabel =
          status.phase === 'loading_concepts'
            ? `正在读取 ${status.conceptCount} 个概念`
            : status.phase === 'analyzing'
              ? `正在分析 ${status.conceptCount} 个概念`
              : '处理中...';
        setLintBanner({
          tone: 'running',
          title: '深度检查进行中',
          details: phaseLabel,
        });
        timer = setTimeout(tick, POLL_MS);
      } else {
        await onLintFinished(status);
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasLintRun, lintRunId, pollLintRun, onLintFinished, setLintBanner, setLintRunning]);

  const triggerRepair = useCallback(
    async (findingsToFix: Finding[]) => {
      if (repairStarting) return;
      const payload = toRepairPayload(findingsToFix);
      if (payload.length === 0) return;
      setRepairStarting(true);
      setRepairError('');
      try {
        const res = await startRepair(payload);
        if (!res.runId) {
          showToast('没有可自动修复的条目', false, false);
          return;
        }
        try {
          localStorage.setItem(REPAIR_RUN_STORAGE_KEY, res.runId);
        } catch {
          // ignore
        }
        setRepairRun({
          id: res.runId,
          status: 'running',
          total: res.total,
          done: 0,
          failed: 0,
          startedAt: Date.now(),
          finishedAt: null,
          summary: {
            merged: 0,
            linked: 0,
            orphanFixed: 0,
            conflictQueued: 0,
            deletedConceptIds: [],
            touchedConceptIds: [],
            aiFallbacks: 0,
          },
        });
        if (res.dropped > 0) {
          showToast(`已启动修复 · ${res.dropped} 条超出单次上限,下次再跑`, false, false);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setRepairError(message);
        showErrorToast(`启动修复失败：${message.slice(0, 120)}`, () =>
          triggerRepair(findingsToFix),
        );
      } finally {
        setRepairStarting(false);
      }
    },
    [repairStarting, showErrorToast, showToast],
  );

  const runLint = useCallback(async () => {
    if (lintRunning) return;
    setLintRunning(true);
    setLintBanner({
      tone: 'running',
      title: '启动深度检查',
      details: '正在连接服务器...',
    });
    try {
      const res = await startLintRun();
      if (!res.runId) {
        setLintRunning(false);
        setLintBanner(null);
        showErrorToast('无法启动深度检查', () => runLint());
        return;
      }
      try {
        localStorage.setItem(LINT_RUN_STORAGE_KEY, res.runId);
      } catch {
        /* ignore */
      }
      setLintRun({
        id: res.runId,
        status: 'running',
        phase: 'loading_concepts',
        conceptCount: 0,
        findings: [],
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
      });
    } catch (err) {
      setLintRunning(false);
      const message = err instanceof Error ? err.message : '未知错误';
      setLintBanner({
        tone: 'error',
        title: '深度检查启动失败',
        details: message,
      });
    }
  }, [lintRunning, setLintBanner, setLintRunning, showErrorToast]);

  const findingIcon = (type: Finding['type']) => {
    switch (type) {
      case 'orphan':
        return <Icon.Orphan />;
      case 'stale':
        return <Icon.Stale />;
      case 'thin':
        return <Icon.Thin />;
      case 'contradiction':
        return <Icon.Contradiction />;
      case 'missing-link':
        return <Icon.Link />;
      case 'duplicate':
        return <Icon.Duplicate />;
    }
  };

  const findingLabel = (type: Finding['type']) => {
    switch (type) {
      case 'orphan':
        return '孤岛';
      case 'stale':
        return '陈旧';
      case 'thin':
        return '单薄';
      case 'contradiction':
        return '矛盾';
      case 'missing-link':
        return '缺链';
      case 'duplicate':
        return '重复';
    }
  };

  const findingAction = (finding: Finding) => {
    if (finding.type === 'orphan' || finding.type === 'stale') {
      return {
        label: '查看概念',
        action: () => finding.conceptIds[0] && openConcept(finding.conceptIds[0]),
      };
    }
    if (finding.type === 'thin') {
      return { label: '补充资料', action: () => openModal() };
    }
    return {
      label: '查看详情',
      action: () => finding.conceptIds[0] && openConcept(finding.conceptIds[0]),
    };
  };

  if (conceptCount === undefined || sourceCount === undefined) {
    return (
      <div className="health-loading" role="status" aria-live="polite">
        <span className="lint-spinner" aria-hidden="true" />
        <span>正在读取健康检查数据...</span>
      </div>
    );
  }

  return (
    <div className="health-view" aria-label="知识库健康检查">
      <div className="health-stats" role="list" aria-label="知识库健康指标">
        <div className="stat-card" role="listitem" aria-label={`概念 ${conceptCount}`}>
          <div className="stat-value">{conceptCount}</div>
          <div className="stat-label">概念</div>
        </div>
        <div className="stat-card" role="listitem" aria-label={`资料 ${sourceCount}`}>
          <div className="stat-value">{sourceCount}</div>
          <div className="stat-label">资料</div>
        </div>
        <div className="stat-card" role="listitem" aria-label={`待处理问题 ${allFindings.length}`}>
          <div className="stat-value">{allFindings.length}</div>
          <div className="stat-label">问题</div>
        </div>
        <div
          className={`stat-card score-${scoreColor}`}
          role="listitem"
          aria-label={`健康分 ${healthScore}`}
        >
          <div className="stat-value">{healthScore}</div>
          <div className="stat-label">健康分</div>
        </div>
      </div>

      <section className="health-section" aria-labelledby="health-findings-title">
        <div className="health-section-header">
          <h3 id="health-findings-title">待处理事项</h3>
          <span className="finding-count" aria-label={`共 ${allFindings.length} 项`}>
            {allFindings.length}
          </span>
        </div>

        {repairRun && repairRun.status === 'running' ? (
          <div className="repair-banner" role="status" aria-live="polite">
            <div className="repair-banner-head">
              <span className="lint-spinner" aria-hidden="true" />
              <span>
                一键修复中 {repairRun.done + repairRun.failed} / {repairRun.total}
              </span>
            </div>
            <div
              className="repair-progress"
              role="progressbar"
              aria-label="一键修复进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={repairProgress}
            >
              <div className="repair-progress-bar" style={{ width: `${repairProgress}%` }} />
            </div>
            <div className="repair-banner-sub">
              合并 {repairRun.summary.merged} · 建链 {repairRun.summary.linked} · 孤岛补{' '}
              {repairRun.summary.orphanFixed} · 冲突入审 {repairRun.summary.conflictQueued}
              {repairRun.failed > 0 ? ` · 失败 ${repairRun.failed}` : ''}
            </div>
          </div>
        ) : null}
        {repairError ? (
          <div className="ops-alert" role="alert">
            {repairError}
          </div>
        ) : null}

        {allFindings.length === 0 ? (
          <div className="health-empty">
            <span aria-hidden="true">
              <Icon.Lint />
            </span>
            <span>
              {lastLintAt || localScanAt
                ? '最近一次深度检查没有发现需要处理的问题'
                : '还没有运行深度检查，点击下方按钮开始扫描'}
            </span>
          </div>
        ) : (
          <div className="finding-list" role="list" aria-label="待处理事项列表">
            {allFindings.map((finding, index) => {
              const act = findingAction(finding);
              const fixable = isFixable(finding.type);
              const fixing = Boolean(repairRun && repairRun.status === 'running');
              return (
                <div
                  key={`${finding.type}-${index}`}
                  className={`finding-item type-${finding.type}`}
                  role="listitem"
                >
                  <div className="finding-icon" aria-hidden="true">
                    {findingIcon(finding.type)}
                  </div>
                  <div className="finding-body">
                    <div className="finding-top-row">
                      <span className="finding-badge">{findingLabel(finding.type)}</span>
                      <div className="finding-top-actions">
                        {fixable ? (
                          <button
                            className="finding-action-btn primary"
                            disabled={fixing || repairStarting}
                            onClick={() => void triggerRepair([finding])}
                            aria-label={`修复${findingLabel(finding.type)}问题`}
                          >
                            修复
                          </button>
                        ) : null}
                        <button
                          className="finding-action-btn"
                          onClick={act.action}
                          aria-label={`${act.label}: ${finding.message}`}
                        >
                          {act.label}
                        </button>
                      </div>
                    </div>
                    <div className="finding-msg">{finding.message}</div>
                    <div className="finding-chips">
                      {finding.conceptIds.map((conceptId) => (
                        <button
                          key={conceptId}
                          className="concept-chip"
                          onClick={() => openConcept(conceptId)}
                        >
                          {conceptTitleMap.get(conceptId) ?? conceptId}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="health-action">
        <button
          className="lint-btn"
          onClick={runLint}
          disabled={lintRunning || Boolean(repairRun && repairRun.status === 'running')}
          aria-describedby={lastLintAt || localScanAt ? 'health-last-run' : undefined}
        >
          {lintRunning ? (
            <>
              <span className="lint-spinner" aria-hidden="true" /> 检查中...
            </>
          ) : (
            <>
              <Icon.Sparkle /> 运行深度检查
            </>
          )}
        </button>
        <button
          className="lint-btn secondary"
          onClick={() => void triggerRepair(allFindings)}
          disabled={
            fixableCount === 0 ||
            repairStarting ||
            Boolean(repairRun && repairRun.status === 'running')
          }
          aria-label={`一键修复 ${fixableCount} 个可自动修复问题`}
        >
          一键修复{fixableCount > 0 ? ` (${fixableCount})` : ''}
        </button>
        {(lastLintAt || localScanAt) && (
          <div className="lint-time" id="health-last-run">
            上次检查: {formatRelativeTime(Math.max(lastLintAt ?? 0, localScanAt ?? 0))}
          </div>
        )}
      </div>
    </div>
  );
}
