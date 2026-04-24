'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppStore, type HomeStyle } from '@/lib/store';
import { lintWiki } from '@/lib/api-client';
import { getDb } from '@/lib/db';
import { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } from '@/lib/seed';
import {
  fetchCustomModels,
  getLlmConfig,
  modelLabel,
  PRESET_MODELS,
  rememberCustomModelOnServer,
  saveLlmConfig,
} from '@/lib/llm-config';
import { clearAdminToken, getAdminToken, saveAdminToken } from '@/lib/admin-auth-client';
import type { LintResponse, LlmConfig } from '@/lib/types';
import { Icon } from './Icons';

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
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [llmExpanded, setLlmExpanded] = useState(false);
  const [llmAdvancedExpanded, setLlmAdvancedExpanded] = useState(false);
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
    void fetchCustomModels().then(setCustomModels).catch(() => setCustomModels([]));
    return () => { timers.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    const el = modalRef.current;
    if (!el || !isOpen) return;
    el.focus({ preventScroll: true });

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

  async function saveLlm() {
    saveLlmConfig(llmConfig);
    const model = llmConfig.model?.trim();
    if (model) {
      const models = await rememberCustomModelOnServer(model).catch(() => customModels);
      setCustomModels(models);
    }
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
      <div className="modal settings-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="settings-drawer-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="settings-hero">
          <div>
            <div className="settings-kicker">Compound 设置</div>
            <h3 id="settings-drawer-title">设置 · 工具</h3>
            <p>管理模型、访问密钥和 Wiki 维护工具。</p>
          </div>
          <button className="settings-close-btn" onClick={close} aria-label="关闭设置">
            关闭
          </button>
        </div>

        {/* LLM 配置 */}
        <div className="settings-section settings-card" style={S.llmSection}>
          <div className="settings-card-head">
            <div className="settings-card-icon"><Icon.Sparkle /></div>
            <div>
              <div className="settings-card-title">LLM 配置</div>
              <div className="settings-card-desc">
                默认使用 Zeabur 服务端配置；需要临时覆盖当前浏览器时再展开。
              </div>
            </div>
            <button
              className="settings-card-toggle"
              type="button"
              aria-expanded={llmExpanded}
              onClick={() => setLlmExpanded((value) => !value)}
            >
              {llmExpanded ? '收起' : '展开'}
            </button>
          </div>

          {!llmExpanded && (
            <div className="settings-collapsed-note">
              正在使用服务端默认模型配置。
            </div>
          )}

          {llmExpanded && (
          <div className="settings-fields">
            <label className="settings-field">
              <span>API Key</span>
              <input
                type="password"
                placeholder="sk-... 或 OpenRouter key"
                value={llmConfig.apiKey || ''}
                onChange={(e) => setLlmConfig((c) => ({ ...c, apiKey: e.target.value }))}
              />
            </label>

            <label className="settings-field">
              <span>模型</span>
              <input
                type="text"
                placeholder="anthropic/claude-sonnet-4.6"
                value={llmConfig.model || ''}
                onChange={(e) => setLlmConfig((c) => ({ ...c, model: e.target.value }))}
              />
            </label>

            <div className="settings-preset-row">
              {[...PRESET_MODELS.map((item) => item.value), ...customModels].map((model) => (
                <button
                  key={model}
                  className={`settings-preset${llmConfig.model === model ? ' active' : ''}`}
                  title={model}
                  onClick={() => setLlmConfig((c) => ({ ...c, model }))}
                >
                  {modelLabel(model)}
                </button>
              ))}
            </div>

            <div className="settings-advanced-block">
              <button
                className="settings-inline-toggle"
                type="button"
                aria-expanded={llmAdvancedExpanded}
                onClick={() => setLlmAdvancedExpanded((value) => !value)}
              >
                <span>高级配置</span>
                <span>{llmAdvancedExpanded ? '收起' : '展开'}</span>
              </button>

              {!llmAdvancedExpanded && (
                <div className="settings-inline-note">
                  API URL 默认跟随服务端配置。
                </div>
              )}

              {llmAdvancedExpanded && (
                <label className="settings-field">
                  <span>
                    API URL <em>可选</em>
                  </span>
                  <input
                    type="text"
                    placeholder="https://openrouter.ai/api/v1/chat/completions"
                    value={llmConfig.apiUrl || ''}
                    onChange={(e) => setLlmConfig((c) => ({ ...c, apiUrl: e.target.value }))}
                  />
                </label>
              )}
            </div>

            <button className="modal-btn primary settings-primary-action" onClick={saveLlm}>
              {llmSaved ? '已保存 ✓' : '保存配置'}
            </button>
          </div>
          )}
        </div>

        <div className="settings-section settings-card" style={S.llmSection}>
          <div className="settings-card-head">
            <div className="settings-card-icon"><Icon.Settings /></div>
            <div>
              <div className="settings-card-title">访问保护</div>
              <div className="settings-card-desc">
                服务端开启 ADMIN_TOKEN 后，在这里保存同一个密钥。
              </div>
            </div>
          </div>

          <div className="settings-fields">
            <label className="settings-field">
              <span>Admin Token</span>
              <input
                type="password"
                placeholder="与服务端 ADMIN_TOKEN 保持一致"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
              />
            </label>

            <div className="settings-action-row">
              <button className="modal-btn primary" onClick={saveAdmin}>
                {adminSaved ? '已保存 ✓' : '保存访问密钥'}
              </button>
              <button className="modal-btn settings-secondary-action" onClick={clearAdmin}>
                清除
              </button>
            </div>
          </div>
        </div>

        <div className="settings-section settings-card" style={S.lintSection}>
          <div className="settings-card-head">
            <div className="settings-card-icon"><Icon.Lint /></div>
            <div>
              <div className="settings-card-title">Wiki 维护</div>
              <div className="settings-card-desc">体检结构问题，调整首页展示方式。</div>
            </div>
          </div>

          <div className="settings-tool-row">
            <div>
              <div className="settings-tool-title">Lint · Wiki 体检</div>
              <div className="settings-card-desc">找出矛盾、孤立页和缺失链接</div>
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
          <div className="settings-tool-row settings-tool-row-flat">
            <div>
              <div className="settings-tool-title">首页样式</div>
              <div className="settings-card-desc">选择动态流或分类知识库</div>
            </div>
            <div className="settings-segmented">
            <button
              className={homeStyle === 'feed' ? 'active' : ''}
              onClick={() => setHomeStyle('feed')}
            >
              动态流
            </button>
            <button
              className={homeStyle === 'library' ? 'active' : ''}
              onClick={() => setHomeStyle('library')}
            >
              知识库
            </button>
            </div>
          </div>
        </div>

        <div className={`settings-section settings-card settings-data-section${confirming === 'clear' ? ' is-confirming-danger' : ''}`} style={S.dataSection}>
          <div className="settings-card-head">
            <div className="settings-card-icon"><Icon.Trash /></div>
            <div>
              <div className="settings-card-title">数据管理</div>
              <div className="settings-card-desc">
                示例数据可随时载入；清空会删除本机资料、概念和问答记录。
              </div>
            </div>
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
              <button className="modal-btn settings-secondary-action" style={S.seedBtn} onClick={() => setConfirming('seed')}>
                载入示例 Wiki
              </button>
              <button className="modal-btn danger" style={S.seedBtn} onClick={() => setConfirming('clear')}>
                清空所有数据
              </button>
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
