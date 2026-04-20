'use client';

import { useMemo, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { lintWiki } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/format';
import { Icon } from '../Icons';

interface Finding {
  type: 'orphan' | 'stale' | 'thin' | 'contradiction' | 'missing-link' | 'duplicate';
  message: string;
  conceptIds: string[];
}

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const THIN_THRESHOLD = 200;

export function HealthView() {
  const openConcept = useAppStore((s) => s.openConcept);
  const openModal = useAppStore((s) => s.openModal);
  const lintFindings = useAppStore((s) => s.lintFindings);
  const lastLintAt = useAppStore((s) => s.lastLintAt);
  const lintRunning = useAppStore((s) => s.lintRunning);
  const setLintResult = useAppStore((s) => s.setLintResult);
  const setLintRunning = useAppStore((s) => s.setLintRunning);
  const hydrateLastLintAt = useAppStore((s) => s.hydrateLastLintAt);
  const showToast = useAppStore((s) => s.showToast);
  const hideToast = useAppStore((s) => s.hideToast);

  useEffect(() => {
    hydrateLastLintAt();
  }, [hydrateLastLintAt]);

  const concepts = useLiveQuery(() => getDb().concepts.toArray(), []);
  const sources = useLiveQuery(() => getDb().sources.toArray(), []);

  // Client-side computed findings
  const localFindings = useMemo<Finding[]>(() => {
    if (!concepts) return [];
    const now = Date.now();
    const findings: Finding[] = [];

    for (const c of concepts) {
      // Orphan: no related concepts AND at most 1 source
      if (c.related.length === 0 && c.sources.length <= 1) {
        findings.push({
          type: 'orphan',
          message: `"${c.title}" 是孤岛概念 — 没有关联概念，仅有 ${c.sources.length} 个来源`,
          conceptIds: [c.id],
        });
      }
      // Stale: not updated in >30 days
      if (now - c.updatedAt > THIRTY_DAYS) {
        findings.push({
          type: 'stale',
          message: `"${c.title}" 已超过 30 天未更新`,
          conceptIds: [c.id],
        });
      }
      // Thin: body too short
      if (c.body.length < THIN_THRESHOLD) {
        findings.push({
          type: 'thin',
          message: `"${c.title}" 内容较单薄 (${c.body.length} 字符)，建议补充更多资料`,
          conceptIds: [c.id],
        });
      }
    }
    return findings;
  }, [concepts]);

  // Merge local findings with lint API findings
  const allFindings = useMemo<Finding[]>(() => {
    const apiFindings: Finding[] = lintFindings.map((f) => ({
      type: f.type as Finding['type'],
      message: f.message,
      conceptIds: f.conceptIds,
    }));
    return [...localFindings, ...apiFindings];
  }, [localFindings, lintFindings]);

  // Stats
  const conceptCount = concepts?.length ?? 0;
  const sourceCount = sources?.length ?? 0;
  const linkCount = useMemo(() => {
    if (!concepts) return 0;
    return concepts.reduce((s, c) => s + c.related.length, 0);
  }, [concepts]);

  // Health score: 100 minus penalties
  const healthScore = useMemo(() => {
    if (conceptCount === 0) return 100;
    const orphanPenalty = allFindings.filter((f) => f.type === 'orphan').length * 5;
    const stalePenalty = allFindings.filter((f) => f.type === 'stale').length * 3;
    const thinPenalty = allFindings.filter((f) => f.type === 'thin').length * 2;
    const lintPenalty = allFindings.filter((f) => ['contradiction', 'missing-link', 'duplicate'].includes(f.type)).length * 8;
    return Math.max(0, 100 - orphanPenalty - stalePenalty - thinPenalty - lintPenalty);
  }, [allFindings, conceptCount]);

  const scoreColor = healthScore >= 80 ? 'good' : healthScore >= 50 ? 'warn' : 'bad';

  const conceptTitleMap = useMemo(() => {
    if (!concepts) return new Map<string, string>();
    return new Map(concepts.map((c) => [c.id, c.title]));
  }, [concepts]);

  const runLint = useCallback(async () => {
    if (lintRunning) return;
    setLintRunning(true);
    showToast('正在运行健康检查...', true);
    try {
      const result = await lintWiki();
      setLintResult(result.findings);
      hideToast();
    } catch (err) {
      setLintRunning(false);
      showToast('健康检查失败: ' + (err instanceof Error ? err.message : '未知错误'));
      setTimeout(hideToast, 3000);
    }
  }, [lintRunning, setLintRunning, showToast, hideToast, setLintResult]);

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

  const findingAction = (f: Finding) => {
    // 孤岛/陈旧/单薄 → 补充资料
    if (['orphan', 'stale', 'thin'].includes(f.type)) {
      return { label: '补充资料', action: () => openModal() };
    }
    // 矛盾/缺链/重复 → 查看第一个概念
    return { label: '查看详情', action: () => f.conceptIds[0] && openConcept(f.conceptIds[0]) };
  };

  if (!concepts) {
    return <div className="empty-state">加载中...</div>;
  }

  return (
    <div className="health-view">
      {/* Stats cards */}
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
          <div className="stat-value">{linkCount}</div>
          <div className="stat-label">链接</div>
        </div>
        <div className={`stat-card score-${scoreColor}`}>
          <div className="stat-value">{healthScore}</div>
          <div className="stat-label">健康分</div>
        </div>
      </div>

      {/* Findings section */}
      <div className="health-section">
        <div className="health-section-header">
          <h3>待处理事项</h3>
          <span className="finding-count">{allFindings.length}</span>
        </div>

        {allFindings.length === 0 ? (
          <div className="health-empty">
            <Icon.Lint />
            <span>Wiki 状态良好，暂无需要处理的问题</span>
          </div>
        ) : (
          <div className="finding-list">
            {allFindings.map((f, i) => {
              const act = findingAction(f);
              return (
                <div key={i} className={`finding-item type-${f.type}`}>
                  <div className="finding-icon">{findingIcon(f.type)}</div>
                  <div className="finding-body">
                    <div className="finding-top-row">
                      <span className="finding-badge">{findingLabel(f.type)}</span>
                      <button className="finding-action-btn" onClick={act.action}>
                        {act.label}
                      </button>
                    </div>
                    <div className="finding-msg">{f.message}</div>
                    <div className="finding-chips">
                      {f.conceptIds.map((cid) => (
                        <button
                          key={cid}
                          className="concept-chip"
                          onClick={() => openConcept(cid)}
                        >
                          {conceptTitleMap.get(cid) ?? cid}
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

      {/* Lint action */}
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
        {lastLintAt && (
          <div className="lint-time">上次检查: {formatRelativeTime(lastLintAt)}</div>
        )}
      </div>
    </div>
  );
}
