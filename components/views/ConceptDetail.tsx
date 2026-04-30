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
import { createWikiFromSelection } from '@/lib/api-client';
import type { ConceptVersion } from '@/lib/types';
import { SourceTypeIcon } from '../Icons';
import { Prose } from '../Prose';

type VersionDialogState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  versions: ConceptVersion[];
};

type SelectionPopoverState = {
  visible: boolean;
  /** viewport coordinates — popover is `position: fixed`. */
  top: number;
  left: number;
  text: string;
};

// 中文用户常选 2-4 字的词语，阈值过高会让按钮"经常无法触发"。
const MIN_SELECTION_CHARS = 2;
const MAX_SELECTION_CHARS = 4_000;
const POPOVER_ESTIMATED_WIDTH = 148;
const POPOVER_ESTIMATED_HEIGHT = 36;
const POPOVER_EDGE_PADDING = 8;

export function ConceptDetail({ id }: { id: string }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const openSource = useAppStore((s) => s.openSource);
  const showToast = useAppStore((s) => s.showToast);
  const markFresh = useAppStore((s) => s.markFresh);
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
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopoverState>({
    visible: false,
    top: 0,
    left: 0,
    text: '',
  });
  const [creatingFromSelection, setCreatingFromSelection] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const bodyShellRef = useRef<HTMLDivElement>(null);
  // 点击 popover 时浏览器会清除外部选区 -> selectionchange 触发 -> popover 被卸载 ->
  // onClick 无法触发。用一个短暂的抑制窗口，让 click 先落地。
  const suppressDismissRef = useRef(false);

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
    setSelectionPopover({ visible: false, top: 0, left: 0, text: '' });
  }, [id]);

  const dismissSelectionPopover = useCallback(() => {
    setSelectionPopover((state) => (state.visible ? { ...state, visible: false } : state));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateFromSelection = () => {
      if (creatingFromSelection) return;
      const shell = bodyShellRef.current;
      if (!shell) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        dismissSelectionPopover();
        return;
      }
      const range = sel.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const anchorEl = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
      if (!anchorEl || !shell.contains(anchorEl)) {
        dismissSelectionPopover();
        return;
      }
      const text = sel.toString().trim();
      if (text.length < MIN_SELECTION_CHARS || text.length > MAX_SELECTION_CHARS) {
        dismissSelectionPopover();
        return;
      }
      // 用最后一行的 rect 做锚点，让按钮始终贴近用户选段末尾(即鼠标松开处附近)，
      // 而不是整段 bounding box 的中心。
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      const anchorRect = rects[rects.length - 1] ?? range.getBoundingClientRect();
      if (!anchorRect || (anchorRect.width === 0 && anchorRect.height === 0)) {
        dismissSelectionPopover();
        return;
      }

      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      // 默认放到选段末尾的正下方。
      let top = anchorRect.bottom + 6;
      let left = anchorRect.right - POPOVER_ESTIMATED_WIDTH / 2;
      // 水平越界时夹回视口内。
      left = Math.min(
        Math.max(left, POPOVER_EDGE_PADDING),
        viewportW - POPOVER_ESTIMATED_WIDTH - POPOVER_EDGE_PADDING,
      );
      // 底部放不下时，改到选段上方。
      if (top + POPOVER_ESTIMATED_HEIGHT > viewportH - POPOVER_EDGE_PADDING) {
        top = Math.max(POPOVER_EDGE_PADDING, anchorRect.top - POPOVER_ESTIMATED_HEIGHT - 6);
      }

      setSelectionPopover({
        visible: true,
        top,
        left,
        text,
      });
    };

    const handlePointerUp = () => {
      window.setTimeout(updateFromSelection, 10);
    };
    const handleSelectionChange = () => {
      // 用户正点击 popover 时,浏览器可能瞬时把选区折叠;稍后会自动恢复。
      // 加一个抑制窗口,避免 popover 在 click 前被卸载导致"点击没反应"。
      if (suppressDismissRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        dismissSelectionPopover();
      }
    };
    const handleScroll = () => dismissSelectionPopover();

    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchend', handlePointerUp);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      document.removeEventListener('mouseup', handlePointerUp);
      document.removeEventListener('touchend', handlePointerUp);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [creatingFromSelection, dismissSelectionPopover]);

  const handleCreateFromSelection = useCallback(async () => {
    if (creatingFromSelection) return;
    const text = selectionPopover.text.trim();
    if (!text) return;
    setCreatingFromSelection(true);
    setSelectionPopover((state) => ({ ...state, visible: false }));
    showToast('正在为选段建页…', true);
    try {
      const resp = await createWikiFromSelection({
        selection: text,
        sourceConceptId: id,
        contextTitle: concept?.title,
      });
      if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges();
      if (resp.status === 'duplicate') {
        showToast('已有等价概念，已为你打开');
      } else {
        markFresh([resp.conceptId]);
        showToast('已为选段创建概念');
      }
      openConcept(resp.conceptId);
    } catch (err) {
      const message = err instanceof Error ? err.message : '创建失败';
      showToast(message, false, true);
    } finally {
      setCreatingFromSelection(false);
    }
  }, [
    concept?.title,
    creatingFromSelection,
    id,
    markFresh,
    openConcept,
    selectionPopover.text,
    showToast,
  ]);

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
        <div className="concept-body-shell" ref={bodyShellRef}>
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

      {selectionPopover.visible && (
        <div
          className="selection-popover"
          style={{ top: `${selectionPopover.top}px`, left: `${selectionPopover.left}px` }}
          onMouseDown={(event) => {
            // 阻止浏览器默认的「清除外部选区 + 转移 focus」行为,保住选中态,
            // 也保住 popover 的挂载状态以便 click 能正常触发。
            event.preventDefault();
            event.stopPropagation();
            suppressDismissRef.current = true;
            window.setTimeout(() => {
              suppressDismissRef.current = false;
            }, 200);
          }}
          onTouchStart={() => {
            suppressDismissRef.current = true;
            window.setTimeout(() => {
              suppressDismissRef.current = false;
            }, 200);
          }}
        >
          <button
            type="button"
            className="selection-popover-btn"
            disabled={creatingFromSelection}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleCreateFromSelection();
            }}
          >
            <span className="selection-popover-icon" aria-hidden="true">
              +
            </span>
            为这段创建 Wiki
          </button>
        </div>
      )}

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
