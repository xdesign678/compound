'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { ensureSourceHydrated } from '@/lib/cloud-sync';
import { updateSourceContent } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime, renderMarkdown } from '@/lib/format';
import {
  applyMarkdownSelectionEdit,
  type MarkdownEditCommand,
} from '@/lib/markdown-editor/selection';

interface SourceTocItem {
  id: string;
  level: number;
  title: string;
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

/**
 * 如果渲染出来的 HTML 第一个块级元素是 h1，且文本与页头标题一致，
 * 就给它打上 `.source-title-echo` class，由 CSS 隐藏（保留 DOM，
 * 不破坏 rawContent 数据完整性）。
 */
function markLeadingTitleEcho(html: string, title: string): string {
  if (typeof window === 'undefined') return html;
  const trimmed = title.trim();
  if (!trimmed) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return html;
  const firstElement = root.firstElementChild;
  if (firstElement && firstElement.tagName === 'H1') {
    const text = (firstElement.textContent || '').trim();
    if (text === trimmed) {
      firstElement.classList.add('source-title-echo');
    }
  }
  return root.innerHTML;
}

function collectSourceToc(root: HTMLElement): SourceTocItem[] {
  return Array.from(root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4'))
    .filter((heading) => !heading.classList.contains('source-title-echo'))
    .map((heading, index) => {
      const title = normalizeText(heading.textContent || '').trim();
      if (!title) return null;
      const id = heading.id || `source-heading-${index + 1}`;
      heading.id = id;
      return {
        id,
        level: Number(heading.tagName[1]),
        title,
      };
    })
    .filter((item): item is SourceTocItem => item !== null);
}

export function SourceDetail({ id }: { id: string }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const tocCloseTimerRef = useRef<number | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [tocOpen, setTocOpen] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [tocItems, setTocItems] = useState<SourceTocItem[]>([]);

  const source = useLiveQuery(async () => getDb().sources.get(id), [id]);
  const generated = useLiveQuery(
    async () => getDb().concepts.where('sources').equals(id).toArray(),
    [id],
  );
  const hasFullContent = Boolean(source?.rawContent.trim()) || source?.contentStatus === 'full';

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

  const refreshToc = useCallback(() => {
    const preview = previewRef.current;
    setTocItems(preview ? collectSourceToc(preview) : []);
  }, []);

  const openToc = useCallback(() => {
    if (tocCloseTimerRef.current) {
      window.clearTimeout(tocCloseTimerRef.current);
      tocCloseTimerRef.current = null;
    }
    refreshToc();
    setTocOpen(true);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setTocVisible(true));
    });
  }, [refreshToc]);

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
    setDraftContent('');
    setIsDirty(false);
    setSaveStatus('idle');
    closeToc();
    setTocItems([]);
  }, [closeToc, id]);

  useEffect(() => {
    if (!source || !hasFullContent || isDirty) return;
    setDraftContent(source.rawContent);
  }, [hasFullContent, isDirty, source]);

  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = window.setTimeout(() => setSaveStatus('idle'), 2200);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  const updateDraftContent = useCallback(
    (nextMarkdown: string) => {
      setDraftContent(nextMarkdown);
      setIsDirty(nextMarkdown !== (source?.rawContent ?? ''));
      setSaveStatus((current) => (current === 'idle' ? current : 'idle'));
    },
    [source?.rawContent],
  );

  const handleDraftChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextMarkdown = event.target.value;
      updateDraftContent(nextMarkdown);
      window.requestAnimationFrame(refreshToc);
    },
    [refreshToc, updateDraftContent],
  );

  const applyMarkdownCommand = useCallback(
    (command: MarkdownEditCommand) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const result = applyMarkdownSelectionEdit({
        value: draftContent,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
        command,
      });
      updateDraftContent(result.value);
      window.requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
        refreshToc();
      });
    },
    [draftContent, refreshToc, updateDraftContent],
  );

  const previewHtml = useMemo(() => {
    if (!source) return '';
    return markLeadingTitleEcho(renderMarkdown(draftContent), source.title);
  }, [draftContent, source]);

  useEffect(() => {
    refreshToc();
  }, [previewHtml, refreshToc]);

  const handleResetDraft = useCallback(() => {
    const originalContent = source?.rawContent ?? '';
    updateDraftContent(originalContent);
    setIsDirty(false);
    setSaveStatus('idle');
    window.requestAnimationFrame(refreshToc);
  }, [refreshToc, source?.rawContent, updateDraftContent]);

  const canEdit = hasFullContent;
  const canSave = canEdit && isDirty && saveStatus !== 'saving';

  const handleSave = useCallback(async () => {
    if (!canEdit || !isDirty || saveStatus === 'saving') return;
    setSaveStatus('saving');
    try {
      await updateSourceContent({
        id,
        title: source?.title,
        rawContent: draftContent,
      });
      setIsDirty(false);
      setSaveStatus('saved');
    } catch (err) {
      console.warn('[source-detail] save failed:', err);
      setSaveStatus('error');
    }
  }, [canEdit, draftContent, id, isDirty, saveStatus, source?.title]);

  const handleTextareaBlur = useCallback(() => {
    if (!isDirty) return;
    void handleSave();
  }, [handleSave, isDirty]);

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
      const target = Array.from(
        previewRef.current?.querySelectorAll<HTMLElement>('h1, h2, h3, h4') ?? [],
      ).find((heading) => heading.id === headingId);
      closeToc();
      window.setTimeout(() => {
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 280);
    },
    [closeToc],
  );

  if (!source) return <div className="empty-state">未找到资料</div>;

  const generatedCount = generated?.length ?? 0;
  const generatedItems = generated ?? [];
  const displayMarkdown = isDirty ? draftContent : source.rawContent;
  const wordCount = displayMarkdown.length;
  const readingMinutes = wordCount > 0 ? Math.max(1, Math.round(wordCount / 400)) : 0;
  const sourceHost = source.url ? formatSourceHost(source.url) : null;

  const handleFormat = (command: MarkdownEditCommand) => (event: React.MouseEvent) => {
    event.preventDefault();
    applyMarkdownCommand(command);
  };

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
          {!hasFullContent && <span className="detail-status">加载中</span>}
        </div>

        <h1>{source.title}</h1>

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
                >
                  {concept.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <hr className="source-hero-divider" aria-hidden="true" />
      </header>

      <section className="source-layout-main">
        {!hasFullContent ? (
          <div className="empty-state empty-state-compact">原文加载中...</div>
        ) : (
          <div className="source-editor-shell">
            <div className="source-editor-toolbar" role="toolbar" aria-label="Markdown 格式">
              <button
                type="button"
                className="source-editor-toolbar-btn"
                onMouseDown={handleFormat('bold')}
                aria-label="加粗"
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                className="source-editor-toolbar-btn"
                onMouseDown={handleFormat('italic')}
                aria-label="斜体"
              >
                <em>I</em>
              </button>
              <span className="source-editor-toolbar-divider" aria-hidden="true" />
              <button
                type="button"
                className="source-editor-toolbar-btn"
                onMouseDown={handleFormat('heading')}
                aria-label="标题"
              >
                H
              </button>
              <button
                type="button"
                className="source-editor-toolbar-btn"
                onMouseDown={handleFormat('list')}
                aria-label="列表"
              >
                ☰
              </button>
              <button
                type="button"
                className="source-editor-toolbar-btn"
                onMouseDown={handleFormat('quote')}
                aria-label="引用"
              >
                ❞
              </button>
            </div>

            <textarea
              ref={textareaRef}
              className="source-editor-textarea"
              value={draftContent}
              onChange={handleDraftChange}
              onBlur={handleTextareaBlur}
              spellCheck={false}
              aria-label="资料正文 Markdown 编辑器"
              placeholder="直接用 Markdown 整理这份资料..."
            />

            <div
              ref={previewRef}
              className="prose source-editor-content source-editor-preview"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
              aria-label="资料正文预览"
            />
          </div>
        )}
      </section>

      {tocOpen && (
        <div
          className={`modal-overlay source-toc-overlay${tocVisible ? ' visible' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="source-toc-title"
          onClick={closeToc}
        >
          <div className="modal source-toc-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="modal-handle" />
            <div className="settings-hero source-toc-head">
              <div>
                <div className="settings-kicker source-toc-kicker">文章目录</div>
                <h2 id="source-toc-title">跳转到标题</h2>
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
                  >
                    <span className="source-toc-item-marker" aria-hidden="true" />
                    <span>{item.title}</span>
                  </button>
                ))
              ) : (
                <div className="source-toc-empty">暂未识别到标题</div>
              )}
            </div>
          </div>
        </div>
      )}

      {(isDirty || saveStatus !== 'idle') && (
        <div className="source-save-indicator" role="status" aria-live="polite">
          {isDirty && saveStatus === 'idle' && (
            <>
              <button
                className="source-save-indicator-action"
                onClick={handleResetDraft}
                type="button"
              >
                还原
              </button>
              <button
                className="source-save-indicator-action primary"
                onClick={handleSave}
                disabled={!canSave}
                type="button"
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
              <button className="source-save-indicator-action" onClick={handleSave} type="button">
                重试
              </button>
            </span>
          )}
        </div>
      )}
    </article>
  );
}
