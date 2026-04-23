'use client';

import { useMemo, useCallback, useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { failLintActivity, lintWiki, startLintActivity } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/format';
import { Icon } from '../Icons';
import type { ActivityLog, Concept } from '@/lib/types';

interface Finding {
  type: 'orphan' | 'stale' | 'thin' | 'contradiction' | 'missing-link' | 'duplicate';
  message: string;
  conceptIds: string[];
}

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const THIN_THRESHOLD = 200;

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

  const [localFindings, setLocalFindings] = useState<Finding[]>([]);
  const [conceptTitleMap, setConceptTitleMap] = useState<Map<string, string>>(new Map());
  const [localScanAt, setLocalScanAt] = useState<number | null>(null);

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
              return (
                <div key={`${finding.type}-${index}`} className={`finding-item type-${finding.type}`}>
                  <div className="finding-icon">{findingIcon(finding.type)}</div>
                  <div className="finding-body">
                    <div className="finding-top-row">
                      <span className="finding-badge">{findingLabel(finding.type)}</span>
                      <button className="finding-action-btn" onClick={act.action}>
                        {act.label}
                      </button>
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
          disabled={lintRunning}
        >
          {lintRunning ? (
            <><span className="lint-spinner" /> 检查中...</>
          ) : (
            <><Icon.Sparkle /> 运行深度检查</>
          )}
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
