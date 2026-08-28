'use client';

import '@/components/modals.css';
import './source-detail.css';
import './detail-chips.css';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { ensureSourceHydrated } from '@/lib/cloud-sync';
import {
  adoptSavedSourceRevision,
  fetchSourceById,
  isRevisionConflictError,
  readExpectedRevision,
  updateSourceContent,
} from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime, renderMarkdown, loadMarked } from '@/lib/format';
import {
  applyMarkdownSelectionEdit,
  type MarkdownEditCommand,
} from '@/lib/markdown-editor/selection';
import {
  type SourceBlock,
  splitMarkdownBlocks,
  joinBlocksToMarkdown,
  extractFrontmatterTags,
  replaceBlockRaw,
} from '@/lib/markdown-editor/block-split';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { SourceBlockEditor } from './SourceBlockEditor';
import { normalizeHttpUrl } from '@/lib/safe-url';

interface SourceTocItem {
  id: string;
  level: number;
  title: string;
}

const SOURCE_DRAFT_KEY_PREFIX = 'compound:source-draft:';

function sourceDraftKey(id: string): string {
  return `${SOURCE_DRAFT_KEY_PREFIX}${id}`;
}

function readSourceDraft(id: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(sourceDraftKey(id));
  } catch {
    return null;
  }
}

function writeSourceDraft(id: string, value: string): void {
  try {
    window.localStorage.setItem(sourceDraftKey(id), value);
  } catch {
    // localStorage can be unavailable in private browsing modes.
  }
}

function clearSourceDraft(id: string): void {
  try {
    window.localStorage.removeItem(sourceDraftKey(id));
  } catch {
    // localStorage can be unavailable in private browsing modes.
  }
}

function normalizeText(text: string) {
  return text.replace(/\u00a0/g, ' ');
}

function formatSourceHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Fetch the authoritative CAS token without replacing local markdown/draft bytes. */
async function ensureSourceExpectedRevision(
  id: string,
  expectedRevisionRef: { current: number | undefined },
): Promise<number> {
  const existing = readExpectedRevision(expectedRevisionRef.current);
  if (existing !== undefined) return existing;
  const remote = await fetchSourceById(id);
  const token = readExpectedRevision(remote.serverRevision);
  if (token === undefined) {
    throw new Error('服务器未返回有效版本号');
  }
  expectedRevisionRef.current = token;
  const local = await getDb().sources.get(id);
  if (local) {
    await getDb().sources.update(id, { serverRevision: token });
  }
  return token;
}

export function SourceDetail({ id }: { id: string }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const sourceTitleId = useId();
  const saveStatusId = useId();
  const tocTitleId = useId();
  const tocDialogRef = useRef<HTMLDivElement>(null);
  const tocCloseTimerRef = useRef<number | null>(null);
  const [blocks, setBlocks] = useState<SourceBlock[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>(
    'idle',
  );
  const [draftCopied, setDraftCopied] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const activeBlockIdRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const queuedSaveRef = useRef<string | null>(null);
  const expectedRevisionRef = useRef<number | undefined>(undefined);
  const saveStatusRef = useRef<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  saveStatusRef.current = saveStatus;

  // null 哨兵区分「加载中」与「不存在」：useLiveQuery 首次 resolve 前返回 undefined，
  // 直接判 !source 会让存在的条目也先闪一帧「未找到资料」
  const source = useLiveQuery(async () => (await getDb().sources.get(id)) ?? null, [id]);
  const generated = useLiveQuery(
    async () => getDb().concepts.where('sources').equals(id).toArray(),
    [id],
  );
  const hasFullContent = Boolean(source?.rawContent.trim()) || source?.contentStatus === 'full';
  useFocusTrap(tocDialogRef, tocOpen);

  const [tocItems, setTocItems] = useState<SourceTocItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadMarked().then((mod) => {
      if (cancelled || !mod) return;
      const items = blocks
        .filter(
          (block) =>
            block.type === 'heading' &&
            block.kind !== 'leading-title' &&
            block.depth &&
            block.depth >= 1 &&
            block.depth <= 4,
        )
        .map((block) => {
          const tokens = mod.marked.lexer(block.raw);
          const first = tokens[0];
          const text = first && 'text' in first && typeof first.text === 'string' ? first.text : '';
          return {
            id: block.id,
            level: block.depth ?? 1,
            title: normalizeText(text).trim(),
          };
        })
        .filter((item): item is SourceTocItem => Boolean(item.title));
      if (!cancelled) setTocItems(items);
    });
    return () => {
      cancelled = true;
    };
  }, [blocks]);

  useEffect(() => {
    return () => {
      if (tocCloseTimerRef.current) {
        window.clearTimeout(tocCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!source || hasFullContent) return;
    void ensureSourceHydrated(id).catch((err) => {
      console.warn('[source-detail] hydrate failed:', err);
    });
  }, [hasFullContent, id, source]);

  useEffect(() => {
    if (!source || source.contentStatus === 'full' || !source.rawContent.trim()) return;
    void getDb().sources.update(id, { contentStatus: 'full' });
  }, [id, source]);

  const openToc = useCallback(() => {
    if (tocCloseTimerRef.current) {
      window.clearTimeout(tocCloseTimerRef.current);
      tocCloseTimerRef.current = null;
    }
    setTocOpen(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setTocVisible(true));
    });
  }, []);

  const closeToc = useCallback(() => {
    setTocVisible(false);
    if (tocCloseTimerRef.current) {
      window.clearTimeout(tocCloseTimerRef.current);
    }
    tocCloseTimerRef.current = window.setTimeout(() => {
      setTocOpen(false);
      tocCloseTimerRef.current = null;
    }, 260);
  }, []);

  useEffect(() => {
    setBlocks([]);
    setIsDirty(false);
    setSaveStatus('idle');
    setDraftCopied(false);
    setReloading(false);
    expectedRevisionRef.current = undefined;
    closeToc();
  }, [closeToc, id]);

  useEffect(() => {
    if (!source || !hasFullContent || isDirty) return;
    const loadedRevision = readExpectedRevision(source.serverRevision);
    if (loadedRevision !== undefined) expectedRevisionRef.current = loadedRevision;
    const storedDraft = readSourceDraft(id);
    if (storedDraft !== null && storedDraft !== source.rawContent) {
      setBlocks(splitMarkdownBlocks(storedDraft, source.title));
      setIsDirty(true);
      return;
    }
    setBlocks(splitMarkdownBlocks(source.rawContent, source.title));
    setIsDirty(false);
  }, [hasFullContent, id, isDirty, source]);

  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = window.setTimeout(() => setSaveStatus('idle'), 2200);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  const handleBlocksChange = useCallback(
    (nextBlocks: SourceBlock[]) => {
      setBlocks(nextBlocks);
      const joined = joinBlocksToMarkdown(nextBlocks);
      const dirty = joined !== (source?.rawContent ?? '');
      setIsDirty(dirty);
      if (dirty) {
        writeSourceDraft(id, joined);
        if (saveInFlightRef.current) queuedSaveRef.current = joined;
      } else {
        clearSourceDraft(id);
      }
      setSaveStatus((current) =>
        current === 'saving' || current === 'conflict' ? current : 'idle',
      );
    },
    [id, source?.rawContent],
  );

  const applyMarkdownCommand = useCallback(
    (command: MarkdownEditCommand) => {
      const activeId = activeBlockIdRef.current;
      if (!activeId) return;
      const textarea = textareaRefs.current.get(activeId);
      if (!textarea) return;
      const block = blocks.find((item) => item.id === activeId);
      if (!block) return;

      const result = applyMarkdownSelectionEdit({
        value: block.raw,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
        command,
      });

      const nextBlocks = replaceBlockRaw(blocks, activeId, result.value);
      handleBlocksChange(nextBlocks);

      window.requestAnimationFrame(() => {
        const updatedTextarea = textareaRefs.current.get(activeId);
        if (updatedTextarea) {
          updatedTextarea.focus();
          updatedTextarea.setSelectionRange(result.selectionStart, result.selectionEnd);
        }
      });
    },
    [blocks, handleBlocksChange],
  );

  const handleResetDraft = useCallback(() => {
    if (!source) return;
    const nextBlocks = splitMarkdownBlocks(source.rawContent, source.title);
    setBlocks(nextBlocks);
    clearSourceDraft(id);
    setIsDirty(false);
    setSaveStatus('idle');
  }, [id, source]);

  const canEdit = hasFullContent;
  const canSave = canEdit && isDirty && saveStatus !== 'saving';

  // Mirror blocks into a ref so the auto-save timer always reads the latest
  // value instead of a stale closure snapshot from a previous render.
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const handleSave = useCallback(
    async (rawContent?: string) => {
      if (saveStatusRef.current === 'conflict') return;
      const requestedContent = rawContent ?? joinBlocksToMarkdown(blocksRef.current);
      if (!canEdit || requestedContent === (source?.rawContent ?? '')) return;
      queuedSaveRef.current = requestedContent;
      if (saveInFlightRef.current) return;

      saveInFlightRef.current = true;
      try {
        while (queuedSaveRef.current !== null) {
          const contentToSave: string = queuedSaveRef.current;
          queuedSaveRef.current = null;
          setSaveStatus('saving');
          try {
            const expectedRevision = await ensureSourceExpectedRevision(id, expectedRevisionRef);
            const saved = await updateSourceContent({
              id,
              title: source?.title,
              rawContent: contentToSave,
              expectedRevision,
            });
            expectedRevisionRef.current = adoptSavedSourceRevision(saved.source);
          } catch (err) {
            queuedSaveRef.current = null;
            console.warn('[source-detail] save failed:', err);
            if (isRevisionConflictError(err)) {
              setSaveStatus('conflict');
              setDraftCopied(false);
              return;
            }
            setSaveStatus('error');
            return;
          }

          const latestContent = joinBlocksToMarkdown(blocksRef.current);
          if (latestContent === contentToSave && queuedSaveRef.current === null) {
            clearSourceDraft(id);
            setIsDirty(false);
            setSaveStatus('saved');
          } else {
            writeSourceDraft(id, latestContent);
            setIsDirty(true);
            queuedSaveRef.current = latestContent;
          }
        }
      } finally {
        saveInFlightRef.current = false;
      }
    },
    [canEdit, id, source?.rawContent, source?.title],
  );

  const handleCopyLocalDraft = useCallback(async () => {
    const markdown = joinBlocksToMarkdown(blocksRef.current);
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(markdown);
      setDraftCopied(true);
    } catch {
      setDraftCopied(false);
    }
  }, []);

  const handleReloadServerVersion = useCallback(async () => {
    if (reloading) return;
    setReloading(true);
    try {
      const remote = await fetchSourceById(id);
      await getDb().sources.put({ ...remote, contentStatus: 'full' });
      expectedRevisionRef.current = readExpectedRevision(remote.serverRevision);
      const nextBlocks = splitMarkdownBlocks(remote.rawContent, remote.title);
      setBlocks(nextBlocks);
      clearSourceDraft(id);
      setIsDirty(false);
      setDraftCopied(false);
      setSaveStatus('idle');
    } catch (err) {
      console.warn('[source-detail] reload failed:', err);
      setSaveStatus('conflict');
    } finally {
      setReloading(false);
    }
  }, [id, reloading]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleCommit = useCallback(
    (blockId: string, raw: string) => {
      if (!source) return;
      const updatedBlocks = replaceBlockRaw(blocksRef.current, blockId, raw);
      const joined = joinBlocksToMarkdown(updatedBlocks);
      const nextBlocks = splitMarkdownBlocks(joined, source.title);
      setBlocks(nextBlocks);
      const stillDirty = joined !== source.rawContent;
      setIsDirty(stillDirty);
      if (stillDirty) {
        writeSourceDraft(id, joined);
        void handleSave(joined);
      } else {
        clearSourceDraft(id);
      }
    },
    [handleSave, id, source],
  );

  useEffect(() => {
    if (
      !canEdit ||
      !isDirty ||
      saveStatus === 'saving' ||
      saveStatus === 'error' ||
      saveStatus === 'conflict'
    )
      return;
    const timer = window.setTimeout(() => {
      void handleSave();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [canEdit, handleSave, isDirty, saveStatus]);

  useEffect(() => {
    if (!canEdit) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        // 未在编辑任何块时不要拦截浏览器默认行为
        if (!activeBlockIdRef.current) return;
        event.preventDefault();
        applyMarkdownCommand('bold');
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
        if (!activeBlockIdRef.current) return;
        event.preventDefault();
        applyMarkdownCommand('italic');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [applyMarkdownCommand, canEdit, handleSave]);

  useEffect(() => {
    if (!tocOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // 全局快捷键钩子的 window 监听注册更早（冒泡阶段先触发），这里必须用
        // capture 阶段抢先 preventDefault，全局钩子看到 defaultPrevented 才会放行，
        // 否则按一次 Esc 会把详情页一起关掉。
        event.preventDefault();
        closeToc();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [closeToc, tocOpen]);

  useEffect(() => {
    const handleOpenToc = () => {
      openToc();
    };
    window.addEventListener('compound:open-source-toc', handleOpenToc);
    return () => window.removeEventListener('compound:open-source-toc', handleOpenToc);
  }, [openToc]);

  const handleTocJump = useCallback(
    (headingId: string) => {
      closeToc();
      window.setTimeout(() => {
        const target = document.getElementById(headingId);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 280);
    },
    [closeToc],
  );

  const registerTextareaRef = useCallback((blockId: string, el: HTMLTextAreaElement | null) => {
    if (el) {
      textareaRefs.current.set(blockId, el);
    } else {
      textareaRefs.current.delete(blockId);
    }
  }, []);

  const handleActiveBlockChange = useCallback((activeId: string | null) => {
    activeBlockIdRef.current = activeId;
  }, []);

  const renderBlockHtml = useCallback(async (block: SourceBlock) => {
    if (block.kind === 'leading-title' || block.kind === 'frontmatter-tags') {
      return '';
    }
    return renderMarkdown(block.raw);
  }, []);

  const tags = useMemo(() => extractFrontmatterTags(blocks), [blocks]);
  const currentMarkdown = useMemo(() => joinBlocksToMarkdown(blocks), [blocks]);

  if (source === undefined) {
    return (
      <div className="empty-state" role="status" aria-live="polite">
        加载中…
      </div>
    );
  }

  if (!source) {
    return (
      <div className="empty-state" role="status" aria-live="polite">
        未找到资料
      </div>
    );
  }

  const generatedCount = generated?.length ?? 0;
  const generatedItems = generated ?? [];
  const wordCount = currentMarkdown.length;
  const readingMinutes = wordCount > 0 ? Math.max(1, Math.round(wordCount / 400)) : 0;
  const safeSourceUrl = normalizeHttpUrl(source.url);
  const sourceHost = safeSourceUrl ? formatSourceHost(safeSourceUrl) : null;

  return (
    <article className="concept-detail source-detail-page">
      <header className="source-hero">
        <div className="source-hero-kicker">
          <span>资料档案</span>
          <span className="source-hero-kicker-dot" aria-hidden="true">
            ·
          </span>
          <span>{formatRelativeTime(source.ingestedAt)}摄入</span>
          {generatedCount > 0 && (
            <>
              <span className="source-hero-kicker-dot" aria-hidden="true">
                ·
              </span>
              <span>已生成 {generatedCount} 个概念</span>
            </>
          )}
          {!hasFullContent && (
            <span className="detail-status" role="status" aria-live="polite">
              加载中
            </span>
          )}
        </div>

        <h1 id={sourceTitleId}>{source.title}</h1>

        <div className="source-hero-meta">
          {source.author && <span>{source.author}</span>}
          {wordCount > 0 && <span>{wordCount.toLocaleString()} 字</span>}
          {readingMinutes > 0 && <span>约 {readingMinutes} 分钟</span>}
          {safeSourceUrl && sourceHost && (
            <a
              href={safeSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="source-hero-meta-link"
              aria-label={`打开原始资料：${sourceHost}`}
            >
              {sourceHost}
              <span aria-hidden="true" className="source-hero-meta-link-arrow">
                ↗
              </span>
            </a>
          )}
        </div>

        {generatedCount > 0 && (
          <div className="source-hero-related">
            <div className="source-hero-related-title">关联概念</div>
            <div className="source-hero-related-chips">
              {generatedItems.map((concept) => (
                <button
                  key={concept.id}
                  className="related-chip source-aside-chip"
                  onClick={() => openConcept(concept.id)}
                  type="button"
                  aria-label={`打开关联概念：${concept.title}`}
                >
                  {concept.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {tags.length > 0 && (
          <div className="source-hero-tags">
            <div className="source-hero-tags-label">标签</div>
            <div className="source-hero-tags-chips">
              {tags.map((tag) => (
                <span key={tag} className="source-hero-tag-chip">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <hr className="source-hero-divider" aria-hidden="true" />
      </header>

      <section className="source-layout-main" aria-labelledby={sourceTitleId}>
        {!hasFullContent ? (
          <div
            className="empty-state empty-state-compact"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            原文加载中...
          </div>
        ) : (
          <SourceBlockEditor
            blocks={blocks}
            onBlocksChange={handleBlocksChange}
            onCommit={handleCommit}
            registerTextareaRef={registerTextareaRef}
            renderBlockHtml={renderBlockHtml}
            editable={canEdit}
            onActiveBlockChange={handleActiveBlockChange}
          />
        )}
      </section>

      {tocOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className={`modal-overlay source-toc-overlay${tocVisible ? ' visible' : ''}`}
            onClick={closeToc}
          >
            <div
              ref={tocDialogRef}
              className="modal source-toc-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={tocTitleId}
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-handle" />
              <div className="settings-hero source-toc-head">
                <div>
                  <div className="settings-kicker source-toc-kicker">文章目录</div>
                  <h2 id={tocTitleId}>跳转到标题</h2>
                </div>
                <button
                  type="button"
                  className="settings-close-btn source-toc-close"
                  onClick={closeToc}
                  aria-label="关闭目录"
                >
                  关闭
                </button>
              </div>

              <div className="source-toc-list">
                {tocItems.length > 0 ? (
                  tocItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="source-toc-item"
                      style={{ paddingLeft: `${12 + Math.max(0, item.level - 1) * 14}px` }}
                      onClick={() => handleTocJump(item.id)}
                      aria-label={`跳转到标题：${item.title}`}
                    >
                      <span className="source-toc-item-marker" aria-hidden="true" />
                      <span>{item.title}</span>
                    </button>
                  ))
                ) : (
                  <div className="source-toc-empty" role="status" aria-live="polite">
                    暂未识别到标题
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {(isDirty || saveStatus !== 'idle') && (
        <div
          id={saveStatusId}
          className={`source-save-indicator${saveStatus === 'conflict' ? ' conflict' : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {isDirty && saveStatus === 'idle' && (
            <>
              <button
                className="source-save-indicator-action"
                onClick={handleResetDraft}
                type="button"
                aria-label="还原资料正文草稿"
              >
                还原
              </button>
              <button
                className="source-save-indicator-action primary"
                onClick={() => void handleSave()}
                disabled={!canSave}
                type="button"
                aria-label="保存资料正文草稿"
              >
                保存
              </button>
            </>
          )}
          {saveStatus === 'saving' && (
            <span className="source-save-indicator-text saving">
              <span className="source-save-indicator-dot" aria-hidden="true" />
              保存中…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="source-save-indicator-text saved">
              <span className="source-save-indicator-dot" aria-hidden="true" />
              已保存
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="source-save-indicator-text error">
              <span className="source-save-indicator-dot" aria-hidden="true" />
              保存失败
              <button
                className="source-save-indicator-action"
                onClick={() => void handleSave()}
                type="button"
                aria-label="重试保存资料正文草稿"
              >
                重试
              </button>
            </span>
          )}
          {saveStatus === 'conflict' && (
            <span className="source-save-indicator-text conflict">
              <span className="source-save-indicator-dot" aria-hidden="true" />
              版本冲突，本地草稿未覆盖
              <button
                className="source-save-indicator-action"
                onClick={() => void handleCopyLocalDraft()}
                type="button"
                aria-label="复制本地草稿"
              >
                {draftCopied ? '已复制' : '复制本地草稿'}
              </button>
              <button
                className="source-save-indicator-action primary"
                onClick={() => void handleReloadServerVersion()}
                disabled={reloading}
                type="button"
                aria-label="重载服务器版本"
              >
                {reloading ? '重载中…' : '重载服务器版本'}
              </button>
            </span>
          )}
        </div>
      )}
    </article>
  );
}
