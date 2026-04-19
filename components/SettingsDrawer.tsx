'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppStore } from '@/lib/store';
import { lintWiki } from '@/lib/api-client';
import { getDb } from '@/lib/db';
import { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } from '@/lib/seed';
import type { LintResponse } from '@/lib/types';

export function SettingsDrawer() {
  const isOpen = useAppStore((s) => s.settingsOpen);
  const close = useAppStore((s) => s.closeSettings);
  const openConcept = useAppStore((s) => s.openConcept);
  const showToast = useAppStore((s) => s.showToast);
  const hideToast = useAppStore((s) => s.hideToast);
  const clearFresh = useAppStore((s) => s.clearFresh);

  const [lintResult, setLintResult] = useState<LintResponse | null>(null);
  const [lintLoading, setLintLoading] = useState(false);
  const [confirming, setConfirming] = useState<'seed' | 'clear' | null>(null);

  async function handleLint() {
    setLintLoading(true);
    setLintResult(null);
    showToast('AI 正在体检 Wiki...', true);
    try {
      const res = await lintWiki();
      setLintResult(res);
      showToast(res.findings.length === 0 ? 'Wiki 结构健康' : `发现 ${res.findings.length} 处建议`, false);
      setTimeout(() => hideToast(), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`体检失败: ${msg.slice(0, 80)}`, false);
      setTimeout(() => hideToast(), 4000);
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
    close();
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
    close();
    showToast('已清空所有数据', false);
    setTimeout(() => hideToast(), 2500);
  }

  return (
    <div className={`modal-overlay ${isOpen ? 'visible' : ''}`} onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="设置" onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <h3>设置 · 工具</h3>
        <p className="modal-desc">
          由 <strong>Claude Sonnet 4.6</strong> (HappyCapy AI Gateway) 提供编译与查询能力。
        </p>

        <div className="settings-section" style={{ padding: 0, marginBottom: 20 }}>
          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600 }}>Lint · Wiki 体检</div>
              <div className="desc">让 AI 找出矛盾、孤立页、缺失链接</div>
            </div>
            <button className="modal-btn primary" onClick={handleLint} disabled={lintLoading}>
              {lintLoading ? '体检中...' : '运行 Lint'}
            </button>
          </div>

          {lintResult && (
            <div style={{ padding: '10px 0', borderTop: '1px solid var(--border-section)' }}>
              {lintResult.findings.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'var(--font-sans)' }}>
                  未发现问题 · Wiki 结构健康
                </div>
              ) : (
                lintResult.findings.map((f, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '10px 0',
                      borderBottom: idx === lintResult.findings.length - 1 ? 'none' : '1px solid var(--border-section)',
                    }}
                  >
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--brand-clay)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                      {f.type === 'contradiction' ? '矛盾' : f.type === 'orphan' ? '孤立' : f.type === 'missing-link' ? '缺失链接' : '重复'}
                    </div>
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13.5, color: 'var(--text-primary)', marginBottom: 6 }}>
                      {f.message}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {f.conceptIds.map((cid) => (
                        <ConceptChip key={cid} id={cid} onClick={() => { close(); openConcept(cid); }} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="settings-section" style={{ padding: 0 }}>
          {confirming === 'seed' ? (
            <>
              <p className="modal-desc" style={{ marginBottom: 10 }}>
                载入 9 个示例概念页 + 5 份资料(围绕 Karpathy LLM Wiki 主题)? 会添加到你现有 Wiki。
              </p>
              <button className="modal-btn primary" onClick={loadSeed}>确认载入</button>
              <button className="modal-btn" style={{ marginTop: 6 }} onClick={() => setConfirming(null)}>取消</button>
            </>
          ) : confirming === 'clear' ? (
            <>
              <p className="modal-desc" style={{ marginBottom: 10, color: 'var(--brand-clay)' }}>
                确认清空所有资料、概念页、问答记录和活动日志? 本操作不可撤销。
              </p>
              <button className="modal-btn primary" style={{ background: 'var(--brand-clay)' }} onClick={clearAll}>
                确认清空
              </button>
              <button className="modal-btn" style={{ marginTop: 6 }} onClick={() => setConfirming(null)}>取消</button>
            </>
          ) : (
            <>
              <button className="modal-btn" style={{ marginBottom: 8 }} onClick={() => setConfirming('seed')}>
                载入示例 Wiki
              </button>
              <button className="modal-btn" style={{ marginBottom: 8 }} onClick={() => setConfirming('clear')}>
                清空所有数据
              </button>
              <button className="modal-btn" onClick={close}>关闭</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConceptChip({ id, onClick }: { id: string; onClick: () => void }) {
  const concept = useLiveConcept(id);
  if (!concept) return null;
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--bg-muted)',
        padding: '4px 10px',
        borderRadius: 6,
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        color: 'var(--text-primary)',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      {concept.title}
    </button>
  );
}

// Tiny helper: live query by id
function useLiveConcept(id: string) {
  return useLiveQuery(async () => getDb().concepts.get(id), [id]);
}
