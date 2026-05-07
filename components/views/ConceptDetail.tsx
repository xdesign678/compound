'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { ensureConceptHydrated } from '@/lib/cloud-sync';
import { hasConceptBodyContent } from '@/lib/content-status';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { formatConceptBodyForDisplay } from '@/lib/concept-body-format';
import { getAdminAuthHeaders } from '@/lib/admin-auth-client';
import { startWikiFromSelection } from '@/lib/api-client';
import { rememberSelectionWikiRun } from '@/lib/selection-wiki-runs';
import {
  computeSelectionPopoverPosition,
  getSelectionChangeAction,
  type RectLike,
} from '@/lib/selection-popover-position';
import { getVisibleViewportBottom } from '@/lib/hooks/useSelectionPopover';
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
const POPOVER_ESTIMATED_WIDTH = 180;
const POPOVER_ESTIMATED_HEIGHT = 44;

function isUsefulRect(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

function isSelectionBackward(selection: Selection): boolean {
  if (!selection.anchorNode || !selection.focusNode) return false;
  if (selection.anchorNode === selection.focusNode) {
    return selection.anchorOffset > selection.focusOffset;
  }
  return Boolean(
    selection.anchorNode.compareDocumentPosition(selection.focusNode) &
    Node.DOCUMENT_POSITION_PRECEDING,
  );
}

function boundaryFromRect(rect: DOMRect, backward: boolean): RectLike {
  const x = backward ? rect.left : rect.right;
  return {
    left: x,
    right: x,
    top: rect.top,
    bottom: rect.bottom,
    width: 0,
    height: rect.height,
  };
}

function getFocusBoundaryRect(selection: Selection, shell: HTMLElement): RectLike | null {
  const focusNode = selection.focusNode;
  if (!focusNode || !shell.contains(focusNode) || focusNode.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const text = focusNode.textContent ?? '';
  const ownerDocument = focusNode.ownerDocument;
  if (!ownerDocument) return null;
  const offset = Math.min(selection.focusOffset, text.length);
  const backward = isSelectionBackward(selection);
  const start = backward ? offset : Math.max(0, offset - 1);
  const end = backward ? Math.min(text.length, offset + 1) : offset;
  if (start === end) return null;

  const probe = ownerDocument.createRange();
  probe.setStart(focusNode, start);
  probe.setEnd(focusNode, end);
  const rects = Array.from(probe.getClientRects()).filter(isUsefulRect);
  const rect = backward ? rects[0] : rects[rects.length - 1];
  return rect ? boundaryFromRect(rect, backward) : null;
}

function getRangeEndBoundaryRect(range: Range, shell: HTMLElement): RectLike | null {
  const node = range.endContainer;
  if (!node || !shell.contains(node) || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? '';
  const ownerDocument = node.ownerDocument;
  if (!ownerDocument) return null;

  const offset = Math.min(range.endOffset, text.length);
  const start = Math.max(0, offset - 1);
  if (start === offset) return null;

  const probe = ownerDocument.createRange();
  probe.setStart(node, start);
  probe.setEnd(node, offset);
  const rects = Array.from(probe.getClientRects()).filter(isUsefulRect);
  const rect = rects[rects.length - 1];
  return rect ? boundaryFromRect(rect, false) : null;
}

function getSelectionAnchorRect(
  selection: Selection,
  range: Range,
  shell: HTMLElement,
): RectLike | null {
  const backward = isSelectionBackward(selection);
  const selectionLineRect = Array.from(range.getClientRects())
    .filter(isUsefulRect)
    .at(backward ? 0 : -1);
  const expandBoundaryToSelectionLine = (boundary: RectLike): RectLike => {
    if (!selectionLineRect) return boundary;
    const left = backward ? boundary.left : Math.min(selectionLineRect.left, boundary.left);
    const right = backward ? Math.max(selectionLineRect.right, boundary.right) : boundary.right;
    return {
      ...boundary,
      left,
      right,
      width: Math.max(0, right - left),
    };
  };

  const rangeEndRect = getRangeEndBoundaryRect(range, shell);
  if (rangeEndRect) return expandBoundaryToSelectionLine(rangeEndRect);

  const focusRect = getFocusBoundaryRect(selection, shell);
  if (focusRect) return expandBoundaryToSelectionLine(focusRect);

  const rect = selectionLineRect;
  if (rect) return boundaryFromRect(rect, backward);

  const fallback = range.getBoundingClientRect();
  return isUsefulRect(fallback) ? boundaryFromRect(fallback, backward) : null;
}

export function ConceptDetail({ id }: { id: string }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const openSource = useAppStore((s) => s.openSource);
  const showToast = useAppStore((s) => s.showToast);
  const showErrorToast = useAppStore((s) => s.showErrorToast);
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
  const popoverRef = useRef<HTMLDivElement>(null);
  // 点击 popover 时浏览器会清除外部选区 -> selectionchange 触发 -> popover 被卸载 ->
  // onClick 无法触发。用一个短暂的抑制窗口，让 click 先落地。
  const suppressDismissRef = useRef(false);
  const selectionInProgressRef = useRef(false);

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
      const anchorRect = getSelectionAnchorRect(sel, range, shell);
      if (!anchorRect) {
        dismissSelectionPopover();
        return;
      }

      const { top, left } = computeSelectionPopoverPosition({
        anchorRect,
        viewport: {
          width: window.visualViewport?.width ?? window.innerWidth,
          height: getVisibleViewportBottom(window),
        },
        popover: { width: POPOVER_ESTIMATED_WIDTH, height: POPOVER_ESTIMATED_HEIGHT },
      });

      setSelectionPopover({
        visible: true,
        top,
        left,
        text,
      });
    };

    let selectionUpdateTimer: number | undefined;
    const scheduleUpdateFromSelection = (delay = 16) => {
      if (selectionUpdateTimer) clearTimeout(selectionUpdateTimer);
      selectionUpdateTimer = window.setTimeout(updateFromSelection, delay);
    };

    const markSelectionInProgress = (target: Node | null) => {
      if (target && popoverRef.current && popoverRef.current.contains(target)) return;
      const shell = bodyShellRef.current;
      if (!target || !shell || !shell.contains(target)) return;

      selectionInProgressRef.current = true;
      if (selectionUpdateTimer) clearTimeout(selectionUpdateTimer);
      dismissSelectionPopover();
    };
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      markSelectionInProgress(event.target as Node | null);
    };
    const handleSelectStart = (event: Event) => {
      markSelectionInProgress(event.target as Node | null);
    };
    const handlePointerUp = (event: MouseEvent | TouchEvent) => {
      // 如果鼠标是在 popover 上抬起的（即用户正在点击按钮），不要重新计算位置 /
      // 重新渲染 popover —— 否则 click 事件可能在 re-render 期间丢失。
      const target = event.target as Node | null;
      if (target && popoverRef.current && popoverRef.current.contains(target)) {
        return;
      }
      selectionInProgressRef.current = false;
      scheduleUpdateFromSelection(30);
    };
    const handlePointerCancel = () => {
      selectionInProgressRef.current = false;
    };
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      const action = getSelectionChangeAction({
        creatingFromSelection,
        hasSelection: Boolean(sel),
        isCollapsed: Boolean(sel?.isCollapsed),
        selectionInProgress: selectionInProgressRef.current,
        suppressDismiss: suppressDismissRef.current,
      });

      if (action === 'dismiss') {
        dismissSelectionPopover();
        return;
      }
      if (action === 'refresh') scheduleUpdateFromSelection();
    };
    const handleScroll = () => {
      if (suppressDismissRef.current) return;
      if (creatingFromSelection) return;
      dismissSelectionPopover();
    };
    const handleViewportChange = () => {
      scheduleUpdateFromSelection(10);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('touchend', handlePointerUp);
    document.addEventListener('selectstart', handleSelectStart);
    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    return () => {
      if (selectionUpdateTimer) clearTimeout(selectionUpdateTimer);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('mouseup', handlePointerUp);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('touchend', handlePointerUp);
      document.removeEventListener('selectstart', handleSelectStart);
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
    };
  }, [creatingFromSelection, dismissSelectionPopover]);

  const handleCreateFromSelection = useCallback(async () => {
    if (creatingFromSelection) return;
    const text = selectionPopover.text.trim();
    if (!text) return;
    setCreatingFromSelection(true);
    try {
      const run = await startWikiFromSelection({
        selection: text,
        sourceConceptId: id,
        contextTitle: concept?.title,
      });
      rememberSelectionWikiRun(run);
      if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges();
      setSelectionPopover((state) => ({ ...state, visible: false }));
      showToast('已开始后台创建 Wiki');
    } catch (err) {
      setSelectionPopover((state) => ({ ...state, visible: false }));
      const message = err instanceof Error ? err.message : '创建失败';
      showErrorToast(message.slice(0, 120), () => handleCreateFromSelection());
    } finally {
      setCreatingFromSelection(false);
    }
  }, [concept?.title, creatingFromSelection, id, selectionPopover.text, showToast, showErrorToast]);

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

      {(selectionPopover.visible || creatingFromSelection) &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            className="selection-popover"
            style={{ top: `${selectionPopover.top}px`, left: `${selectionPopover.left}px` }}
            role="toolbar"
            aria-label="选区操作"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              suppressDismissRef.current = true;
              window.setTimeout(() => {
                suppressDismissRef.current = false;
              }, 400);
            }}
            onTouchStart={() => {
              suppressDismissRef.current = true;
              window.setTimeout(() => {
                suppressDismissRef.current = false;
              }, 400);
            }}
          >
            {creatingFromSelection ? (
              <div className="selection-popover-loading" role="status" aria-live="polite">
                <span className="selection-popover-spinner" aria-hidden="true" />
                <span className="selection-popover-loading-text">正在启动后台任务...</span>
              </div>
            ) : (
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
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void handleCreateFromSelection();
                  }
                }}
              >
                <span className="selection-popover-icon" aria-hidden="true">
                  +
                </span>
                为这段创建 Wiki
              </button>
            )}
          </div>,
          document.body,
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
