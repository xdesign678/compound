'use client';

import { useState, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppStore } from '@/lib/store';
import { lintWiki } from '@/lib/api-client';
import { getDb } from '@/lib/db';
import { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } from '@/lib/seed';
import type { LintResponse } from '@/lib/types';
import { Icon } from '../Icons';

export function DataTab({ onCloseAction }: { onCloseAction: () => void }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const showToast = useAppStore((s) => s.showToast);
  const hideToast = useAppStore((s) => s.hideToast);
  const clearFresh = useAppStore((s) => s.clearFresh);

  const [lintResult, setLintResult] = useState<LintResponse | null>(null);
  const [lintLoading, setLintLoading] = useState(false);
  const [confirming, setConfirming] = useState<'seed' | 'clear' | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  async function handleLint() {
    setLintLoading(true);
    setLintResult(null);
    showToast('AI 正在体检 Wiki...', true);
    try {
      const res = await lintWiki();
      setLintResult(res);
      showToast(
        res.findings.length === 0 ? 'Wiki 结构健康' : `发现 ${res.findings.length} 处建议`,
        false,
      );
      safeTimeout(() => hideToast(), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`体检失败: ${msg}`, false, true);
    } finally {
      setLintLoading(false);
    }
  }

  async function loadSeed() {
    const db = getDb();
    await db.sources.bulkPut(SEED_SOURCES);
    await db.concepts.bulkPut(SEED_CONCEPTS);
    await db.activity.bulkPut(SEED_ACTIVITY);
    setConfirming(null);
    onCloseAction();
    showToast('示例 Wiki 已载入 · 9 个概念, 5 份资料', false);
    setTimeout(() => hideToast(), 3000);
  }

  async function clearAll() {
    const db = getDb();
    await db.sources.clear();
    await db.concepts.clear();
    await db.activity.clear();
    await db.askHistory.clear();
    clearFresh();
    setLintResult(null);
    setConfirming(null);
    onCloseAction();
    showToast('已清空所有数据', false);
    safeTimeout(() => hideToast(), 2500);
  }

  return (
    <div className="settings-tab-content">
      {/* Wiki 维护 */}
      <div className="settings-card-head">
        <div className="settings-card-icon">
          <Icon.Lint />
        </div>
        <div>
          <div className="settings-card-title">Wiki 维护</div>
          <div className="settings-card-desc">体检结构问题，找出矛盾和缺失链接。</div>
        </div>
      </div>

      <div className="settings-tool-row settings-card-head-adjacent">
        <div>
          <div className="settings-tool-title">Lint · Wiki 体检</div>
          <div className="settings-card-desc">找出矛盾、孤立页和缺失链接</div>
        </div>
        <button className="modal-btn primary" onClick={handleLint} disabled={lintLoading}>
          {lintLoading ? '体检中...' : '运行 Lint'}
        </button>
      </div>

      {lintResult && (
        <div className="settings-lint-results">
          {lintResult.findings.length === 0 ? (
            <div className="settings-lint-empty">未发现问题 · Wiki 结构健康</div>
          ) : (
            lintResult.findings.map((f, idx) => (
              <div
                key={idx}
                className={`settings-lint-finding${idx === lintResult.findings.length - 1 ? ' last' : ''}`}
              >
                <div className="settings-lint-finding-type">
                  {f.type === 'contradiction'
                    ? '矛盾'
                    : f.type === 'orphan'
                      ? '孤立'
                      : f.type === 'missing-link'
                        ? '缺失链接'
                        : '重复'}
                </div>
                <div className="settings-lint-finding-msg">{f.message}</div>
                <div className="settings-lint-finding-chips">
                  {f.conceptIds.map((cid) => (
                    <ConceptChip
                      key={cid}
                      id={cid}
                      onClick={() => {
                        onCloseAction();
                        openConcept(cid);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 数据管理 */}
      <div className="settings-tab-divider" />

      <div className="settings-card-head">
        <div className="settings-card-icon">
          <Icon.Trash />
        </div>
        <div>
          <div className="settings-card-title">数据管理</div>
          <div className="settings-card-desc">
            示例数据可随时载入；清空会删除本机资料、概念和问答记录。
          </div>
        </div>
      </div>

      {confirming === 'seed' ? (
        <div className="settings-confirm-block">
          <p className="modal-desc">
            载入 9 个示例概念页 + 5 份资料(围绕 Karpathy LLM Wiki 主题)? 会添加到你现有 Wiki。
          </p>
          <button className="modal-btn primary" onClick={loadSeed}>
            确认载入
          </button>
          <button className="modal-btn" style={{ marginTop: 6 }} onClick={() => setConfirming(null)}>
            取消
          </button>
        </div>
      ) : confirming === 'clear' ? (
        <div className="settings-confirm-block settings-confirm-danger">
          <p className="modal-desc" style={{ color: 'var(--brand-clay)' }}>
            确认清空所有资料、概念页、问答记录和活动日志? 本操作不可撤销。
          </p>
          <button className="modal-btn primary" style={{ background: 'var(--brand-clay)' }} onClick={clearAll}>
            确认清空
          </button>
          <button className="modal-btn" style={{ marginTop: 6 }} onClick={() => setConfirming(null)}>
            取消
          </button>
        </div>
      ) : (
        <div className="settings-data-actions">
          <button
            className="modal-btn settings-secondary-action"
            onClick={() => setConfirming('seed')}
          >
            载入示例 Wiki
          </button>
          <button
            className="modal-btn danger"
            onClick={() => setConfirming('clear')}
          >
            清空所有数据
          </button>
        </div>
      )}
    </div>
  );
}

function ConceptChip({ id, onClick }: { id: string; onClick: () => void }) {
  const concept = useLiveQuery(async () => getDb().concepts.get(id), [id]);
  if (!concept) return null;
  return (
    <button onClick={onClick} className="settings-concept-chip">
      {concept.title}
    </button>
  );
}
