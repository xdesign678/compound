'use client';

import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import {
  failLintActivity,
  getRepairStatus,
  lintWiki,
  pruneDeletedConcepts,
  startLintActivity,
  startRepair,
  type RepairFindingPayload,
  type RepairStatusResponse,
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
const REPAIR_POLL_MS = 3000;

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

  const [localFindings, setLocalFindings] = useState<Finding[]>([]);
  const [conceptTitleMap, setConceptTitleMap] = useState<Map<string, string>>(new Map());
  const [localScanAt, setLocalScanAt] = useState<number | null>(null);
  const [repairRun, setRepairRun] = useState<RepairStatusResponse | null>(null);
  const [repairStarting, setRepairStarting] = useState(false);
  const [repairError, setRepairError] = useState('');
  const repairDoneRef = useRef<Set<string>>(new Set());

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
    const lintPenalty = allFindings.filter((finding) =>
      ['contradiction', 'missing-link', 'duplicate'].includes(finding.type)
    ).length * 8;
    return Math.max(0, 100 - orphanPenalty - stalePenalty - thinPenalty - lintPenalty);
  }, [allFindings, conceptCount]);

  const scoreColor = healthScore >= 80 ? 'good' : healthScore >= 50 ? 'warn' : 'bad';

  const fixableCount = useMemo(
    () => allFindings.filter((f) => isFixable(f.type)).length,
    [allFindings]
  );

  const pollRepairRun = useCallback(
    async (runId: string): Promise<RepairStatusResponse | null> => {
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
            // ignore
          }
          setRepairRun(null);
        }
        return null;
      }
    },
    []
  );

  const onRepairFinished = useCallback(
    async (status: RepairStatusResponse) => {
      if (repairDoneRef.current.has(status.id)) return;
      repairDoneRef.current.add(status.id);
      try {
        localStorage.removeItem(REPAIR_RUN_STORAGE_KEY);
      } catch {
        // ignore
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
      // Refresh the lint findings so fixed items disappear and remaining ones re-render.
      setLintResult([]);
    },
    [setLintResult, showToast]
  );

  // Poll active repair run (also resumes after page refresh).
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
        timer = setTimeout(tick, REPAIR_POLL_MS);
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
        showToast(`启动修复失败：${message}`, false, true);
      } finally {
        setRepairStarting(false);
      }
    },
    [repairStarting, showToast]
  );

  const runLint = useCallback(async () => {
    if (lintRunning) return;
    setLintRunning(true);
    setLintBanner({
      tone: 'running',
      title: '正在运行深度检查',
      details: '先读取本地概念，再检查缺链、矛盾和重复问题',
    });
    let activityId: string | null = null;
    try {
      activityId = await startLintActivity();
      const concepts = await getDb().concepts.toArray();
      setLintBanner({
        tone: 'running',
        title: '正在分析概念关系',
        details: `已载入 ${concepts.length} 个概念，正在检查结构问题和潜在冲突`,
      });
      const result = await lintWiki(activityId);
      setLintBanner({
        tone: 'running',
        title: '正在整理检查结果',
        details: '本地结构扫描和 AI 检查结果正在合并',
      });
      setConceptTitleMap(new Map(concepts.map((concept) => [concept.id, concept.title])));
      setLocalFindings(buildLocalFindings(concepts));
      setLocalScanAt(Date.now());
      setLintResult(result.findings);
    } catch (err) {
      setLintRunning(false);
      const message = err instanceof Error ? err.message : '未知错误';
      if (activityId) {
        await failLintActivity(activityId, message);
      } else {
        const fallbackActivity: ActivityLog = {
          id: 'a-' + nanoid(8),
          type: 'lint',
          title: '健康检查失败',
          details: `检查未完成 · ${message.slice(0, 140)}`,
          status: 'error',
          at: Date.now(),
        };
        await getDb().activity.put(fallbackActivity);
      }
      setLintBanner({
        tone: 'error',
        title: '深度检查失败',
        details: message,
      });
    }
  }, [lintRunning, setLintBanner, setLintResult, setLintRunning]);

  const findingIcon = (type: Finding['type']) => {
    switch (type) {
      case 'orphan': return <Icon.Orphan />;
      case 'stale': return <Icon.Stale />;
      case 'thin': return <Icon.Thin />;
      case 'contradiction': return <Icon.Contradiction />;
      case 'missing-link': return <Icon.Link />;
      case 'duplicate': return <Icon.Duplicate />;
    }
  };

  const findingLabel = (type: Finding['type']) => {
    switch (type) {
      case 'orphan': return '孤岛';
      case 'stale': return '陈旧';
      case 'thin': return '单薄';
      case 'contradiction': return '矛盾';
      case 'missing-link': return '缺链';
      case 'duplicate': return '重复';
    }
  };

  const findingAction = (finding: Finding) => {
    if (finding.type === 'orphan' || finding.type === 'stale') {
      return { label: '查看概念', action: () => finding.conceptIds[0] && openConcept(finding.conceptIds[0]) };
    }
    if (finding.type === 'thin') {
      return { label: '补充资料', action: () => openModal() };
    }
    return { label: '查看详情', action: () => finding.conceptIds[0] && openConcept(finding.conceptIds[0]) };
  };

  if (conceptCount === undefined || sourceCount === undefined) {
    return <div className="empty-state">加载中...</div>;
  }

  return (
    <div className="health-view">
      <div className="health-stats">
        <div className="stat-card">
          <div className="stat-value">{conceptCount}</div>
          <div className="stat-label">概念</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{sourceCount}</div>
          <div className="stat-label">资料</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{allFindings.length}</div>
          <div className="stat-label">问题</div>
        </div>
        <div className={`stat-card score-${scoreColor}`}>
          <div className="stat-value">{healthScore}</div>
          <div className="stat-label">健康分</div>
        </div>
      </div>

      <div className="health-section">
        <div className="health-section-header">
          <h3>待处理事项</h3>
          <span className="finding-count">{allFindings.length}</span>
        </div>

        {repairRun && repairRun.status === 'running' ? (
          <div className="repair-banner">
            <div className="repair-banner-head">
              <span className="lint-spinner" />
              <span>
                一键修复中 {repairRun.done + repairRun.failed} / {repairRun.total}
              </span>
            </div>
            <div className="repair-progress">
              <div
                className="repair-progress-bar"
                style={{
                  width: `${repairRun.total === 0 ? 0 : Math.round(((repairRun.done + repairRun.failed) / repairRun.total) * 100)}%`,
                }}
              />
            </div>
            <div className="repair-banner-sub">
              合并 {repairRun.summary.merged} · 建链 {repairRun.summary.linked} · 孤岛补{' '}
              {repairRun.summary.orphanFixed} · 冲突入审 {repairRun.summary.conflictQueued}
              {repairRun.failed > 0 ? ` · 失败 ${repairRun.failed}` : ''}
            </div>
          </div>
        ) : null}
        {repairError ? <div className="ops-alert">{repairError}</div> : null}

        {allFindings.length === 0 ? (
          <div className="health-empty">
            <Icon.Lint />
            <span>
              {lastLintAt || localScanAt
                ? '最近一次深度检查没有发现需要处理的问题'
                : '还没有运行深度检查，点击下方按钮开始扫描'}
            </span>
          </div>
        ) : (
          <div className="finding-list">
            {allFindings.map((finding, index) => {
              const act = findingAction(finding);
              const fixable = isFixable(finding.type);
              const fixing = Boolean(repairRun && repairRun.status === 'running');
              return (
                <div key={`${finding.type}-${index}`} className={`finding-item type-${finding.type}`}>
                  <div className="finding-icon">{findingIcon(finding.type)}</div>
                  <div className="finding-body">
                    <div className="finding-top-row">
                      <span className="finding-badge">{findingLabel(finding.type)}</span>
                      <div className="finding-top-actions">
                        {fixable ? (
                          <button
                            className="finding-action-btn primary"
                            disabled={fixing || repairStarting}
                            onClick={() => void triggerRepair([finding])}
                          >
                            修复
                          </button>
                        ) : null}
                        <button className="finding-action-btn" onClick={act.action}>
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
      </div>

      <div className="health-action">
        <button
          className="lint-btn"
          onClick={runLint}
          disabled={lintRunning || Boolean(repairRun && repairRun.status === 'running')}
        >
          {lintRunning ? (
            <><span className="lint-spinner" /> 检查中...</>
          ) : (
            <><Icon.Sparkle /> 运行深度检查</>
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
        >
          一键修复{fixableCount > 0 ? ` (${fixableCount})` : ''}
        </button>
        {(lastLintAt || localScanAt) && (
          <div className="lint-time">
            上次检查: {formatRelativeTime(Math.max(lastLintAt ?? 0, localScanAt ?? 0))}
          </div>
        )}
      </div>
    </div>
  );
}
