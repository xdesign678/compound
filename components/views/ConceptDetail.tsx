'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { ensureConceptHydrated } from '@/lib/cloud-sync';
import { hasConceptBodyContent } from '@/lib/content-status';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { formatConceptBodyForDisplay } from '@/lib/concept-body-format';
import { getAdminAuthHeaders } from '@/lib/admin-auth-client';
import type { ConceptVersion } from '@/lib/types';
import { SourceTypeIcon } from '../Icons';
import { Prose } from '../Prose';

type VersionDialogState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  versions: ConceptVersion[];
};

export function ConceptDetail({ id }: { id: string }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const openSource = useAppStore((s) => s.openSource);
  const freshIds = useAppStore((s) => s.freshConceptIds);
  const [, setHydrating] = useState(false);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [hydrateAttempt, setHydrateAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [versionDialog, setVersionDialog] = useState<VersionDialogState>({
    open: false,
    loading: false,
    error: null,
    versions: [],
  });
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const concept = useLiveQuery(async () => getDb().concepts.get(id), [id]);
  const sources = useLiveQuery(async () => {
    if (!concept) return [];
    const items = await Promise.all(concept.sources.map((sid) => getDb().sources.get(sid)));
    return items.filter(Boolean);
  }, [concept?.sources.join(',')]);
  const related = useLiveQuery(async () => {
    if (!concept) return [];
    const items = await Promise.all(concept.related.map((cid) => getDb().concepts.get(cid)));
    return items.filter(Boolean);
  }, [concept?.related.join(',')]);
  const hasFullBody = hasConceptBodyContent(concept);

  const hydrateBody = useCallback(async () => {
    setHydrateError(null);
    setHydrating(true);
    try {
      const hydrated = await ensureConceptHydrated(id);
      if (!hasConceptBodyContent(hydrated)) {
        setHydrateError('正文暂时还没同步下来，请稍后再试。');
      }
    } catch (err) {
      console.warn('[concept-detail] hydrate failed:', err);
      setHydrateError('正文拉取失败，请重试。');
    } finally {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      setHydrating(false);
      setRetrying(false);
    }
  }, [id]);

  useEffect(() => {
    setHydrateError(null);
    setHydrating(false);
    setRetrying(false);
    setVersionDialog({
      open: false,
      loading: false,
      error: null,
      versions: [],
    });
  }, [id]);

  useEffect(() => {
    if (!concept || hasFullBody) return;
    void hydrateBody();
  }, [concept, hasFullBody, hydrateAttempt, hydrateBody]);

  useEffect(() => {
    if (!concept || concept.contentStatus === 'full' || !concept.body.trim()) return;
    void getDb().concepts.update(id, { contentStatus: 'full' });
  }, [concept, id]);

  if (!concept) return <div className="empty-state">未找到概念</div>;

  const isFresh = freshIds[concept.id];
  const currentVersion = versionDialog.versions.find((item) => item.version === concept.version);
  const canInspectVersion = concept.version > 1;

  async function openVersionDialog() {
    setVersionDialog((state) => ({
      ...state,
      open: true,
      loading: state.versions.length === 0,
      error: null,
    }));
    if (versionDialog.versions.length > 0) return;

    try {
      const res = await fetch(`/api/data/concepts/${encodeURIComponent(id)}/versions`, {
        headers: getAdminAuthHeaders(),
      });
      if (!res.ok) throw new Error('读取失败');
      const data = (await res.json()) as { versions?: ConceptVersion[] };
      setVersionDialog({
        open: true,
        loading: false,
        error: null,
        versions: data.versions ?? [],
      });
    } catch {
      setVersionDialog({
        open: true,
        loading: false,
        error: '暂时读不到这次改动记录，请稍后再试。',
        versions: [],
      });
    }
  }

  function closeVersionDialog() {
    setVersionDialog((state) => ({ ...state, open: false }));
  }

  return (
    <article className="concept-detail">
      <div className="detail-kicker-row">
        <div className="detail-kicker">概念页</div>
        {isFresh && <div className="detail-status">刚更新</div>}
      </div>
      <h1>{concept.title}</h1>
      <div className="detail-meta">
        <span>
          {isFresh ? '刚更新 · ' : '更新于 '}
          {formatRelativeTime(concept.updatedAt)}
        </span>
        <span>·</span>
        <span>{concept.sources.length} 份资料</span>
        <span>·</span>
        <span>{concept.related.length} 个链接</span>
        <span>·</span>
        <span>v{concept.version}</span>
      </div>

      {hasFullBody ? (
        <div className="concept-body-shell">
          <Prose
            markdown={formatConceptBodyForDisplay(concept.body)}
            className="concept-body-prose"
          />
        </div>
      ) : hydrateError ? (
        <div className="empty-state empty-state-compact concept-hydrate-error">
          <div className="concept-hydrate-error-icon" aria-hidden="true">
            ⚠
          </div>
          <p className="concept-hydrate-error-msg">{hydrateError}</p>
          <button
            className="modal-btn primary empty-state-action"
            type="button"
            disabled={retrying}
            onClick={() => {
              if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
              setRetrying(true);
              setHydrateAttempt((count) => count + 1);
              retryTimerRef.current = setTimeout(() => setRetrying(false), 10000);
            }}
          >
            {retrying ? '加载中...' : '重新加载正文'}
          </button>
        </div>
      ) : (
        <div className="concept-body-skeleton">
          <div className="concept-skeleton-line concept-skeleton-line-lg" />
          <div className="concept-skeleton-line concept-skeleton-line-md" />
          <div className="concept-skeleton-line concept-skeleton-line-sm" />
          <div className="concept-skeleton-line concept-skeleton-line-lg" />
          <div className="concept-skeleton-line concept-skeleton-line-md" />
        </div>
      )}

      {sources && sources.length > 0 && (
        <div className="detail-section">
          <h3>基于资料</h3>
          {sources.map((s) => (
            <button key={s!.id} className="source-ref" onClick={() => openSource(s!.id)}>
              <div className="src-icon">
                <SourceTypeIcon type={s!.type} />
              </div>
              <div className="src-info">
                <div className="src-title">{s!.title}</div>
                <div className="src-meta">
                  {s!.author ?? '未知来源'} · {formatRelativeTime(s!.ingestedAt)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {related && related.length > 0 && (
        <div className="detail-section">
          <h3>相关概念</h3>
          <div className="related-grid">
            {related.map((r) => (
              <button key={r!.id} className="related-chip" onClick={() => openConcept(r!.id)}>
                {r!.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="detail-section">
        <h3>AI 编辑记录</h3>
        {canInspectVersion ? (
          <button
            className="edit-log-item edit-log-button"
            type="button"
            onClick={openVersionDialog}
          >
            <span className="time">{formatRelativeTime(concept.updatedAt)}</span>
            <span>当前版本 v{concept.version}</span>
          </button>
        ) : (
          <div className="edit-log-item">
            <span className="time">{formatRelativeTime(concept.updatedAt)}</span>
            <span>当前版本 v{concept.version}</span>
          </div>
        )}
        {concept.createdAt !== concept.updatedAt && (
          <div className="edit-log-item">
            <span className="time">{formatRelativeTime(concept.createdAt)}</span>
            <span>首次创建</span>
          </div>
        )}
      </div>

      {versionDialog.open && (
        <div className="modal-overlay visible" onClick={closeVersionDialog}>
          <div
            className="modal concept-version-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="concept-version-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-handle" />
            <div className="concept-version-head">
              <div>
                <div className="settings-kicker">AI 编辑记录</div>
                <h3 id="concept-version-title">当前版本 v{concept.version}</h3>
              </div>
              <button className="settings-close-btn" type="button" onClick={closeVersionDialog}>
                关闭
              </button>
            </div>

            {versionDialog.loading ? (
              <p className="modal-desc">正在读取这次改动...</p>
            ) : versionDialog.error ? (
              <p className="modal-desc">{versionDialog.error}</p>
            ) : currentVersion ? (
              <div className="concept-version-detail">
                <p className="concept-version-summary">{currentVersion.changeSummary}</p>
                <dl className="concept-version-meta">
                  <div>
                    <dt>更新时间</dt>
                    <dd>{formatRelativeTime(currentVersion.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>关联资料</dt>
                    <dd>{currentVersion.sourceIds.length} 份</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="modal-desc">这版还没有详细改动记录。</p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
