'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { marked } from 'marked';
import { getDb } from '@/lib/db';
import { ensureSourceHydrated } from '@/lib/cloud-sync';
import { updateSourceContent } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime, renderMarkdown } from '@/lib/format';
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

export function SourceDetail({ id }: { id: string }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const sourceTitleId = useId();
  const saveStatusId = useId();
  const tocTitleId = useId();
  const tocDialogRef = useRef<HTMLDivElement>(null);
  const tocCloseTimerRef = useRef<number | null>(null);
  const [blocks, setBlocks] = useState<SourceBlock[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [tocOpen, setTocOpen] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const activeBlockIdRef = useRef<string | null>(null);

  const source = useLiveQuery(async () => getDb().sources.get(id), [id]);
  const generated = useLiveQuery(
    async () => getDb().concepts.where('sources').equals(id).toArray(),
    [id],
  );
  const hasFullContent = Boolean(source?.rawContent.trim()) || source?.contentStatus === 'full';
  useFocusTrap(tocDialogRef, tocOpen);

  const tocItems = useMemo(() => {
    return blocks
      .filter(
        (block) =>
          block.type === 'heading' &&
          block.kind !== 'leading-title' &&
          block.depth &&
          block.depth >= 1 &&
          block.depth <= 4,
      )
      .map((block) => {
        const tokens = marked.lexer(block.raw);
        const first = tokens[0];
        const text = first && 'text' in first && typeof first.text === 'string' ? first.text : '';
        return {
          id: block.id,
          level: block.depth ?? 1,
          title: normalizeText(text).trim(),
        };
      })
      .filter((item): item is SourceTocItem => Boolean(item.title));
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
    closeToc();
  }, [closeToc, id]);

  useEffect(() => {
    if (!source || !hasFullContent) return;
    const storedDraft = readSourceDraft(id);
    if (storedDraft !== null && storedDraft !== source.rawContent) {
      setBlocks(splitMarkdownBlocks(storedDraft, source.title));
      setIsDirty(true);
      return;
    }
    if (!isDirty) {
      setBlocks(splitMarkdownBlocks(source.rawContent, source.title));
      setIsDirty(false);
    }
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
      } else {
        clearSourceDraft(id);
      }
      setSaveStatus((current) => (current === 'idle' ? current : 'idle'));
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

  const handleSave = useCallback(async () => {
    const joined = joinBlocksToMarkdown(blocks);
    if (!canEdit || joined === (source?.rawContent ?? '') || saveStatus === 'saving') return;
    setSaveStatus('saving');
    try {
      await updateSourceContent({
        id,
        title: source?.title,
        rawContent: joined,
      });
      clearSourceDraft(id);
      setIsDirty(false);
      setSaveStatus('saved');
    } catch (err) {
      console.warn('[source-detail] save failed:', err);
      setSaveStatus('error');
    }
  }, [blocks, canEdit, id, saveStatus, source?.rawContent, source?.title]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleCommit = useCallback(() => {
    if (!source) return;
    const joined = joinBlocksToMarkdown(blocks);
    const nextBlocks = splitMarkdownBlocks(joined, source.title);
    setBlocks(nextBlocks);
    const stillDirty = joined !== source.rawContent;
    setIsDirty(stillDirty);
    if (stillDirty) {
      writeSourceDraft(id, joined);
      void handleSave();
    } else {
      clearSourceDraft(id);
    }
  }, [blocks, handleSave, id, source]);

  useEffect(() => {
    if (!canEdit || !isDirty || saveStatus === 'saving') return;
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
        event.preventDefault();
        applyMarkdownCommand('bold');
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
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
        closeToc();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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

  const renderBlockHtml = useCallback((block: SourceBlock) => {
    if (block.kind === 'leading-title' || block.kind === 'frontmatter-tags') {
      return '';
    }
    return renderMarkdown(block.raw);
  }, []);

  const tags = useMemo(() => extractFrontmatterTags(blocks), [blocks]);
  const currentMarkdown = useMemo(() => joinBlocksToMarkdown(blocks), [blocks]);

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
  const sourceHost = source.url ? formatSourceHost(source.url) : null;

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
          {source.url && sourceHost && (
            <a
              href={source.url}
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
          className="source-save-indicator"
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
                onClick={handleSave}
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
                onClick={handleSave}
                type="button"
                aria-label="重试保存资料正文草稿"
              >
                重试
              </button>
            </span>
          )}
        </div>
      )}
    </article>
  );
}
