'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppStore, type HomeStyle } from '@/lib/store';
import { lintWiki } from '@/lib/api-client';
import { getDb } from '@/lib/db';
import { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } from '@/lib/seed';
import { getLlmConfig, saveLlmConfig, PRESET_MODELS } from '@/lib/llm-config';
import { clearAdminToken, getAdminToken, saveAdminToken } from '@/lib/admin-auth-client';
import type { LintResponse, LlmConfig } from '@/lib/types';

// Centralised inline-style constants for SettingsDrawer
const S = {
  llmSection: { padding: 0, marginBottom: 20 } as React.CSSProperties,
  llmTitle: { fontWeight: 600, marginBottom: 6 } as React.CSSProperties,
  llmDesc: { marginBottom: 12 } as React.CSSProperties,
  fieldCol: { display: 'flex', flexDirection: 'column', gap: 8 } as React.CSSProperties,
  labelCol: { display: 'flex', flexDirection: 'column', gap: 4 } as React.CSSProperties,
  labelText: { fontFamily: 'var(--font-sans)', fontSize: 12, color: 'var(--text-secondary)' } as React.CSSProperties,
  input: {
    padding: '8px 10px',
    border: '1px solid var(--border-section)',
    borderRadius: 8,
    fontFamily: 'var(--font-sans)',
    fontSize: 13,
    background: 'var(--bg-muted)',
    color: 'var(--text-primary)',
    outline: 'none',
  } as React.CSSProperties,
  presetRow: { display: 'flex', flexWrap: 'wrap', gap: 6 } as React.CSSProperties,
  presetBtn: (active: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid var(--border-section)',
    background: active ? 'var(--brand-clay)' : 'var(--bg-muted)',
    color: active ? '#fff' : 'var(--text-secondary)',
    fontFamily: 'var(--font-sans)',
    fontSize: 11,
    cursor: 'pointer',
  }),
  saveBtnMargin: { marginTop: 4 } as React.CSSProperties,
  lintSection: { padding: 0, marginBottom: 20 } as React.CSSProperties,
  lintRow: { flexDirection: 'column', alignItems: 'stretch', gap: 10 } as React.CSSProperties,
  lintRowTitle: { fontWeight: 600 } as React.CSSProperties,
  lintResults: { padding: '10px 0', borderTop: '1px solid var(--border-section)' } as React.CSSProperties,
  lintEmpty: { color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'var(--font-sans)' } as React.CSSProperties,
  findingItem: (isLast: boolean): React.CSSProperties => ({
    padding: '10px 0',
    borderBottom: isLast ? 'none' : '1px solid var(--border-section)',
  }),
  findingType: { fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--brand-clay)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 } as React.CSSProperties,
  findingMsg: { fontFamily: 'var(--font-sans)', fontSize: 13.5, color: 'var(--text-primary)', marginBottom: 6 } as React.CSSProperties,
  findingChips: { display: 'flex', flexWrap: 'wrap', gap: 6 } as React.CSSProperties,
  dataSection: { padding: 0 } as React.CSSProperties,
  confirmDesc: { marginBottom: 10 } as React.CSSProperties,
  confirmDescDanger: { marginBottom: 10, color: 'var(--brand-clay)' } as React.CSSProperties,
  clearBtn: { background: 'var(--brand-clay)' } as React.CSSProperties,
  cancelBtn: { marginTop: 6 } as React.CSSProperties,
  seedBtn: { marginBottom: 8 } as React.CSSProperties,
  conceptChip: {
    background: 'var(--bg-muted)',
    padding: '4px 10px',
    borderRadius: 6,
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    color: 'var(--text-primary)',
    border: 'none',
    cursor: 'pointer',
  } as React.CSSProperties,
};

export function SettingsDrawer() {
  const isOpen = useAppStore((s) => s.settingsOpen);
  const close = useAppStore((s) => s.closeSettings);
  const openConcept = useAppStore((s) => s.openConcept);
  const showToast = useAppStore((s) => s.showToast);
  const hideToast = useAppStore((s) => s.hideToast);
  const clearFresh = useAppStore((s) => s.clearFresh);
  const homeStyle = useAppStore((s) => s.homeStyle);
  const setHomeStyle = useAppStore((s) => s.setHomeStyle);

  const [lintResult, setLintResult] = useState<LintResponse | null>(null);
  const [lintLoading, setLintLoading] = useState(false);
  const [confirming, setConfirming] = useState<'seed' | 'clear' | null>(null);

  const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
  const [llmSaved, setLlmSaved] = useState(false);
  const [adminToken, setAdminToken] = useState('');
  const [adminSaved, setAdminSaved] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const modalRef = useRef<HTMLDivElement>(null);

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    setLlmConfig(getLlmConfig());
    setAdminToken(getAdminToken());
    return () => { timers.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    const el = modalRef.current;
    if (!el || !isOpen) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'Tab') {
        const current = el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const f = current[0];
        const l = current[current.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === f) { e.preventDefault(); l?.focus(); }
        } else {
          if (document.activeElement === l) { e.preventDefault(); f?.focus(); }
        }
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, confirming, close]);

  function saveLlm() {
    saveLlmConfig(llmConfig);
    setLlmSaved(true);
    safeTimeout(() => setLlmSaved(false), 2000);
  }

  function saveAdmin() {
    saveAdminToken(adminToken);
    setAdminSaved(true);
    safeTimeout(() => setAdminSaved(false), 2000);
  }

  function clearAdmin() {
    clearAdminToken();
    setAdminToken('');
    setAdminSaved(true);
    safeTimeout(() => setAdminSaved(false), 2000);
  }

  async function handleLint() {
    setLintLoading(true);
    setLintResult(null);
    showToast('AI 正在体检 Wiki...', true);
    try {
      const res = await lintWiki();
      setLintResult(res);
      showToast(res.findings.length === 0 ? 'Wiki 结构健康' : `发现 ${res.findings.length} 处建议`, false);
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
    safeTimeout(() => hideToast(), 2500);
  }

  return (
    <div className={`modal-overlay ${isOpen ? 'visible' : ''}`} onClick={close}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="settings-drawer-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <h3 id="settings-drawer-title">设置 · 工具</h3>

        {/* LLM 配置 */}
        <div className="settings-section" style={S.llmSection}>
          <div style={S.llmTitle}>LLM 配置</div>
          <div className="desc" style={S.llmDesc}>
            填写后将覆盖服务器端默认配置。留空则使用服务端环境变量。
          </div>

          <div style={S.fieldCol}>
            <label style={S.labelCol}>
              <span style={S.labelText}>API Key</span>
              <input
                type="password"
                placeholder="sk-... 或 OpenRouter key"
                value={llmConfig.apiKey || ''}
                onChange={(e) => setLlmConfig((c) => ({ ...c, apiKey: e.target.value }))}
                style={S.input}
              />
            </label>

            <label style={S.labelCol}>
              <span style={S.labelText}>模型</span>
              <input
                type="text"
                placeholder="anthropic/claude-sonnet-4.6"
                value={llmConfig.model || ''}
                onChange={(e) => setLlmConfig((c) => ({ ...c, model: e.target.value }))}
                style={S.input}
              />
            </label>

            <div style={S.presetRow}>
              {PRESET_MODELS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setLlmConfig((c) => ({ ...c, model: p.value }))}
                  style={S.presetBtn(llmConfig.model === p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label style={S.labelCol}>
              <span style={S.labelText}>
                API URL <span style={{ fontWeight: 400 }}>(可选，默认 OpenRouter)</span>
              </span>
              <input
                type="text"
                placeholder="https://openrouter.ai/api/v1/chat/completions"
                value={llmConfig.apiUrl || ''}
                onChange={(e) => setLlmConfig((c) => ({ ...c, apiUrl: e.target.value }))}
                style={S.input}
              />
            </label>

            <button className="modal-btn primary" onClick={saveLlm} style={S.saveBtnMargin}>
              {llmSaved ? '已保存 ✓' : '保存配置'}
            </button>
          </div>
        </div>

        <div className="settings-section" style={S.llmSection}>
          <div style={S.llmTitle}>访问保护</div>
          <div className="desc" style={S.llmDesc}>
            如果服务端配置了 COMPOUND_ADMIN_TOKEN / ADMIN_TOKEN，这里保存同一个访问密钥后，前端请求会自动带上鉴权头。
          </div>

          <div style={S.fieldCol}>
            <label style={S.labelCol}>
              <span style={S.labelText}>Admin Token</span>
              <input
                type="password"
                placeholder="与服务端 ADMIN_TOKEN 保持一致"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                style={S.input}
              />
            </label>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="modal-btn primary" onClick={saveAdmin} style={S.saveBtnMargin}>
                {adminSaved ? '已保存 ✓' : '保存访问密钥'}
              </button>
              <button className="modal-btn" onClick={clearAdmin} style={S.saveBtnMargin}>
                清除
              </button>
            </div>
          </div>
        </div>

        <div className="settings-section" style={S.lintSection}>
          <div className="settings-row" style={S.lintRow}>
            <div>
              <div style={S.lintRowTitle}>Lint · Wiki 体检</div>
              <div className="desc">让 AI 找出矛盾、孤立页、缺失链接</div>
            </div>
            <button className="modal-btn primary" onClick={handleLint} disabled={lintLoading}>
              {lintLoading ? '体检中...' : '运行 Lint'}
            </button>
          </div>

          {lintResult && (
            <div style={S.lintResults}>
              {lintResult.findings.length === 0 ? (
                <div style={S.lintEmpty}>未发现问题 · Wiki 结构健康</div>
              ) : (
                lintResult.findings.map((f, idx) => (
                  <div key={idx} style={S.findingItem(idx === lintResult.findings.length - 1)}>
                    <div style={S.findingType}>
                      {f.type === 'contradiction' ? '矛盾' : f.type === 'orphan' ? '孤立' : f.type === 'missing-link' ? '缺失链接' : '重复'}
                    </div>
                    <div style={S.findingMsg}>{f.message}</div>
                    <div style={S.findingChips}>
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

        {/* 首页样式 */}
        <div className="settings-section" style={{ padding: 0, marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>首页样式</div>
          <div className="desc" style={{ marginBottom: 12 }}>
            Wiki 首页展示形式：动态流或分类知识库。
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={S.presetBtn(homeStyle === 'feed')}
              onClick={() => setHomeStyle('feed')}
            >
              动态流
            </button>
            <button
              style={S.presetBtn(homeStyle === 'library')}
              onClick={() => setHomeStyle('library')}
            >
              知识库
            </button>
          </div>
        </div>

        <div className={`settings-section settings-data-section${confirming === 'clear' ? ' is-confirming-danger' : ''}`} style={S.dataSection}>
          <div className="settings-data-title">数据管理</div>
          <div className="desc settings-data-desc">
            示例数据可以随时载入；清空数据会删除本机资料、概念和问答记录。
          </div>
          {confirming === 'seed' ? (
            <>
              <p className="modal-desc" style={S.confirmDesc}>
                载入 9 个示例概念页 + 5 份资料(围绕 Karpathy LLM Wiki 主题)? 会添加到你现有 Wiki。
              </p>
              <button className="modal-btn primary" onClick={loadSeed}>确认载入</button>
              <button className="modal-btn" style={S.cancelBtn} onClick={() => setConfirming(null)}>取消</button>
            </>
          ) : confirming === 'clear' ? (
            <>
              <p className="modal-desc" style={S.confirmDescDanger}>
                确认清空所有资料、概念页、问答记录和活动日志? 本操作不可撤销。
              </p>
              <button className="modal-btn primary" style={S.clearBtn} onClick={clearAll}>确认清空</button>
              <button className="modal-btn" style={S.cancelBtn} onClick={() => setConfirming(null)}>取消</button>
            </>
          ) : (
            <>
              <button className="modal-btn" style={S.seedBtn} onClick={() => setConfirming('seed')}>
                载入示例 Wiki
              </button>
              <button className="modal-btn danger" style={S.seedBtn} onClick={() => setConfirming('clear')}>
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
    <button onClick={onClick} style={S.conceptChip}>
      {concept.title}
    </button>
  );
}

// Tiny helper: live query by id
function useLiveConcept(id: string) {
  return useLiveQuery(async () => getDb().concepts.get(id), [id]);
}
