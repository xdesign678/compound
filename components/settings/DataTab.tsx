'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAppStore } from '@/lib/store';
import { lintWiki } from '@/lib/api-client';
import { getDb } from '@/lib/db';
import { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } from '@/lib/seed';
import type { LintResponse } from '@/lib/types';
import { Icon } from '../Icons';
import { readRecentImports, type RecentImportEntry } from '../ImportProgress';

export function DataTab({ onCloseAction }: { onCloseAction: () => void }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const openModal = useAppStore((s) => s.openModal);
  const openObsidianImport = useAppStore((s) => s.openObsidianImport);
  const openGithubSync = useAppStore((s) => s.openGithubSync);
  const showToast = useAppStore((s) => s.showToast);
  const showErrorToast = useAppStore((s) => s.showErrorToast);
  const hideToast = useAppStore((s) => s.hideToast);
  const clearFresh = useAppStore((s) => s.clearFresh);
  const isSample =
    typeof window !== 'undefined' && localStorage.getItem('compound_is_sample') === '1';

  const [lintResult, setLintResult] = useState<LintResponse | null>(null);
  const [lintLoading, setLintLoading] = useState(false);
  const [confirming, setConfirming] = useState<'seed' | 'clear' | 'sample' | null>(null);
  const [dataAction, setDataAction] = useState<'seed' | 'clear' | 'sample' | null>(null);
  const [recentImports, setRecentImports] = useState<RecentImportEntry[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setRecentImports(readRecentImports());
  }, []);

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
      showErrorToast(`体检失败: ${msg.slice(0, 120)}`, () => handleLint());
    } finally {
      setLintLoading(false);
    }
  }

  async function loadSeed() {
    setDataAction('seed');
    const db = getDb();
    try {
      await db.sources.bulkPut(SEED_SOURCES);
      await db.concepts.bulkPut(SEED_CONCEPTS);
      await db.activity.bulkPut(SEED_ACTIVITY);
      setConfirming(null);
      onCloseAction();
      showToast('示例 Wiki 已载入 · 9 个概念, 5 份资料', false);
      setTimeout(() => hideToast(), 3000);
    } finally {
      setDataAction(null);
    }
  }

  async function clearAll() {
    setDataAction('clear');
    const db = getDb();
    try {
      await db.sources.clear();
      await db.concepts.clear();
      await db.activity.clear();
      await db.askHistory.clear();
      clearFresh();
      localStorage.removeItem('compound_is_sample');
      setLintResult(null);
      setConfirming(null);
      onCloseAction();
      showToast('已清空所有数据', false);
      safeTimeout(() => hideToast(), 2500);
    } finally {
      setDataAction(null);
    }
  }

  async function clearSample() {
    setDataAction('sample');
    const db = getDb();
    try {
      await db.sources.clear();
      await db.concepts.clear();
      await db.activity.clear();
      await db.askHistory.clear();
      clearFresh();
      localStorage.removeItem('compound_is_sample');
      setLintResult(null);
      setConfirming(null);
      onCloseAction();
      showToast('示例数据已清除', false);
      safeTimeout(() => hideToast(), 2500);
    } finally {
      setDataAction(null);
    }
  }

  return (
    <div className="settings-tab-content settings-data-tab">
      {/* Wiki 维护 */}
      <div className="settings-card-head">
        <div className="settings-card-icon" aria-hidden="true">
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
        <button
          className="modal-btn primary"
          type="button"
          onClick={handleLint}
          disabled={lintLoading}
          aria-busy={lintLoading}
        >
          {lintLoading ? '体检中...' : '运行 Lint'}
        </button>
      </div>

      {lintResult && (
        <div className="settings-lint-results" role="status" aria-live="polite">
          {lintResult.findings.length === 0 ? (
            <div className="settings-lint-empty">未发现问题 · Wiki 结构健康</div>
          ) : (
            <div role="list" aria-label="Lint 发现的问题">
              {lintResult.findings.map((f, idx) => (
                <div
                  key={idx}
                  role="listitem"
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
              ))}
            </div>
          )}
        </div>
      )}

      {/* 数据管理 */}
      <div className="settings-tab-divider" />

      <div className="settings-card-head">
        <div className="settings-card-icon" aria-hidden="true">
          <Icon.File />
        </div>
        <div>
          <div className="settings-card-title">最近导入</div>
          <div className="settings-card-desc">最多保留 5 条，点击后重新打开对应入口。</div>
        </div>
      </div>

      <div className="settings-data-actions" aria-label="最近导入记录">
        {recentImports.length === 0 ? (
          <div className="settings-card-desc" role="status">
            还没有导入记录。
          </div>
        ) : (
          recentImports.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="modal-btn settings-secondary-action"
              aria-label={`重新打开${entry.label}${entry.detail ? `，${entry.detail}` : ''}`}
              onClick={() => {
                onCloseAction();
                if (entry.kind === 'ingest') openModal();
                else if (entry.kind === 'obsidian') openObsidianImport();
                else openGithubSync();
              }}
            >
              {entry.label}
              {entry.detail ? ` · ${entry.detail}` : ''}
            </button>
          ))
        )}
      </div>

      <div className="settings-tab-divider" />

      <div className="settings-card-head">
        <div className="settings-card-icon" aria-hidden="true">
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
        <div
          className="settings-confirm-block"
          role="group"
          aria-labelledby="settings-confirm-seed"
        >
          <p className="modal-desc">
            <strong id="settings-confirm-seed">确认载入示例 Wiki。</strong>
            载入 9 个示例概念页 + 5 份资料（围绕 Karpathy LLM Wiki 主题），会添加到你现有 Wiki。
          </p>
          <button
            className="modal-btn primary"
            type="button"
            onClick={loadSeed}
            disabled={dataAction !== null}
          >
            {dataAction === 'seed' ? '载入中...' : '确认载入'}
          </button>
          <button
            className="modal-btn"
            type="button"
            disabled={dataAction !== null}
            onClick={() => setConfirming(null)}
          >
            取消
          </button>
        </div>
      ) : confirming === 'clear' ? (
        <div
          className="settings-confirm-block settings-confirm-danger"
          role="alert"
          aria-live="assertive"
        >
          <p className="modal-desc">
            <strong>确认清空所有数据。</strong>
            本操作会删除所有资料、概念页、问答记录和活动日志，且不可撤销。
          </p>
          <button
            className="modal-btn primary danger-confirm"
            type="button"
            onClick={clearAll}
            disabled={dataAction !== null}
          >
            {dataAction === 'clear' ? '清空中...' : '确认清空'}
          </button>
          <button
            className="modal-btn"
            type="button"
            disabled={dataAction !== null}
            onClick={() => setConfirming(null)}
          >
            取消
          </button>
        </div>
      ) : confirming === 'sample' ? (
        <div
          className="settings-confirm-block settings-confirm-danger"
          role="alert"
          aria-live="assertive"
        >
          <p className="modal-desc">
            <strong>确认清除示例数据。</strong>
            清除后会从空白知识库重新开始。
          </p>
          <button
            className="modal-btn primary danger-confirm"
            type="button"
            onClick={clearSample}
            disabled={dataAction !== null}
          >
            {dataAction === 'sample' ? '清除中...' : '确认清除'}
          </button>
          <button
            className="modal-btn"
            type="button"
            disabled={dataAction !== null}
            onClick={() => setConfirming(null)}
          >
            取消
          </button>
        </div>
      ) : (
        <div className="settings-data-actions">
          {isSample && (
            <button
              className="modal-btn danger"
              type="button"
              onClick={() => setConfirming('sample')}
            >
              清除示例数据
            </button>
          )}
          <button
            className="modal-btn settings-secondary-action"
            type="button"
            onClick={() => setConfirming('seed')}
          >
            载入示例 Wiki
          </button>
          <button className="modal-btn danger" type="button" onClick={() => setConfirming('clear')}>
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
    <button type="button" onClick={onClick} className="settings-concept-chip">
      {concept.title}
    </button>
  );
}
