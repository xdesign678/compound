'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { ensureSourceHydrated } from '@/lib/cloud-sync';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime, renderMarkdown } from '@/lib/format';

function normalizeText(text: string) {
  return text.replace(/\u00a0/g, ' ');
}

function serializeInlineChildren(node: ParentNode): string {
  return Array.from(node.childNodes).map(serializeInlineNode).join('');
}

function serializeList(list: HTMLElement, depth = 0): string {
  const ordered = list.tagName === 'OL';
  return Array.from(list.children)
    .filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
    .map((item, index) => {
      const marker = ordered ? `${index + 1}.` : '-';
      const inlineParts: string[] = [];
      const nestedParts: string[] = [];

      Array.from(item.childNodes).forEach((child) => {
        if (
          child.nodeType === Node.ELEMENT_NODE &&
          ['UL', 'OL'].includes((child as HTMLElement).tagName)
        ) {
          nestedParts.push(serializeList(child as HTMLElement, depth + 1).trimEnd());
          return;
        }
        inlineParts.push(serializeInlineNode(child));
      });

      const body = inlineParts.join('').trim();
      const line = `${'  '.repeat(depth)}${marker} ${body}`.trimEnd();
      return nestedParts.length > 0 ? [line, ...nestedParts].join('\n') : line;
    })
    .join('\n');
}

function serializeBlockNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeText(node.textContent || '').trim();
    return text ? `${text}\n\n` : '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as HTMLElement;
  const tag = element.tagName;

  if (tag === 'BR') return '\n';
  if (tag === 'HR') return '---\n\n';
  if (tag === 'UL' || tag === 'OL') return `${serializeList(element)}\n\n`;
  if (tag === 'PRE') {
    const code = (element.textContent || '').replace(/\n+$/, '');
    return code ? `\`\`\`\n${code}\n\`\`\`\n\n` : '';
  }
  if (/^H[1-4]$/.test(tag)) {
    const level = Number(tag[1]);
    const text = serializeInlineChildren(element).trim();
    return text ? `${'#'.repeat(level)} ${text}\n\n` : '';
  }
  if (tag === 'BLOCKQUOTE') {
    const inner = Array.from(element.childNodes)
      .map(serializeBlockNode)
      .join('')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!inner) return '';
    return `${inner
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n')}\n\n`;
  }
  if (tag === 'DIV') {
    if (element.childElementCount === 0) {
      const text = serializeInlineChildren(element).trim();
      return text ? `${text}\n\n` : '';
    }
    return Array.from(element.childNodes).map(serializeBlockNode).join('');
  }

  const text = serializeInlineChildren(element).trim();
  return text ? `${text}\n\n` : '';
}

function serializeInlineNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeText(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as HTMLElement;
  const tag = element.tagName;

  if (tag === 'BR') return '\n';
  if (tag === 'STRONG' || tag === 'B') return `**${serializeInlineChildren(element)}**`;
  if (tag === 'EM' || tag === 'I') return `*${serializeInlineChildren(element)}*`;
  if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE')
    return `~~${serializeInlineChildren(element)}~~`;
  if (tag === 'CODE') return `\`${normalizeText(element.textContent || '')}\``;

  if (tag === 'A') {
    const href = element.getAttribute('href') || '';
    const text = serializeInlineChildren(element).trim() || href;
    return href ? `[${text}](${href})` : text;
  }

  if (tag === 'SPAN') {
    const conceptId = element.dataset.conceptId;
    if (conceptId) {
      return `[${normalizeText(element.textContent || '').trim()}](concept:${conceptId})`;
    }
    const citationIndex = element.dataset.citationIndex;
    if (citationIndex) {
      return `[C${citationIndex}]`;
    }
  }

  if (['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE'].includes(tag)) {
    return serializeInlineChildren(element);
  }

  return serializeInlineChildren(element);
}

function htmlToMarkdown(html: string): string {
  if (typeof window === 'undefined') return html.trim();

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';

  return Array.from(root.childNodes)
    .map(serializeBlockNode)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  const editorRef = useRef<HTMLDivElement>(null);
  const renderedContentRef = useRef<string | null>(null);
  const [draftContent, setDraftContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isEditorFocused, setIsEditorFocused] = useState(false);

  const source = useLiveQuery(async () => getDb().sources.get(id), [id]);
  const generated = useLiveQuery(
    async () => getDb().concepts.where('sources').equals(id).toArray(),
    [id],
  );
  const hasFullContent = Boolean(source?.rawContent.trim()) || source?.contentStatus === 'full';

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

  useEffect(() => {
    setDraftContent('');
    setIsDirty(false);
    setSaveStatus('idle');
    renderedContentRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!source || !hasFullContent || isDirty) return;
    setDraftContent(source.rawContent);
  }, [hasFullContent, isDirty, source]);

  useEffect(() => {
    if (!editorRef.current || !source || !hasFullContent || isDirty) return;
    const nextMarkdown = source.rawContent;
    if (renderedContentRef.current === nextMarkdown) return;
    editorRef.current.innerHTML = renderMarkdown(nextMarkdown);
    renderedContentRef.current = nextMarkdown;
  }, [hasFullContent, isDirty, source]);

  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = window.setTimeout(() => setSaveStatus('idle'), 2200);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  const syncDraftFromEditor = useCallback(() => {
    const html = editorRef.current?.innerHTML ?? '';
    const nextMarkdown = htmlToMarkdown(html);
    setDraftContent(nextMarkdown);
    setIsDirty(nextMarkdown !== (source?.rawContent ?? ''));
    renderedContentRef.current = nextMarkdown;
    setSaveStatus((current) => (current === 'idle' ? current : 'idle'));
  }, [source?.rawContent]);

  const applyRichCommand = useCallback(
    (command: string, value?: string) => {
      if (!editorRef.current) return;
      editorRef.current.focus();
      document.execCommand(command, false, value);
      syncDraftFromEditor();
    },
    [syncDraftFromEditor],
  );

  const handleResetDraft = useCallback(() => {
    const originalContent = source?.rawContent ?? '';
    if (editorRef.current) {
      editorRef.current.innerHTML = renderMarkdown(originalContent);
    }
    renderedContentRef.current = originalContent;
    setDraftContent(originalContent);
    setIsDirty(false);
    setSaveStatus('idle');
  }, [source?.rawContent]);

  const canEdit = hasFullContent;
  const canSave = canEdit && isDirty && saveStatus !== 'saving';

  const handleSave = useCallback(async () => {
    if (!canEdit || !isDirty || saveStatus === 'saving') return;
    setSaveStatus('saving');
    try {
      await getDb().sources.update(id, { rawContent: draftContent });
      renderedContentRef.current = draftContent;
      setIsDirty(false);
      setSaveStatus('saved');
    } catch (err) {
      console.warn('[source-detail] save failed:', err);
      setSaveStatus('error');
    }
  }, [canEdit, draftContent, id, isDirty, saveStatus]);

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
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canEdit, handleSave]);

  if (!source) return <div className="empty-state">未找到资料</div>;

  const generatedCount = generated?.length ?? 0;
  const generatedItems = generated ?? [];
  const displayMarkdown = isDirty ? draftContent : source.rawContent;
  const wordCount = displayMarkdown.length;
  const readingMinutes = wordCount > 0 ? Math.max(1, Math.round(wordCount / 400)) : 0;
  const sourceHost = source.url ? formatSourceHost(source.url) : null;
  const showToolbarActions = isDirty || saveStatus !== 'idle';
  const barVisible = hasFullContent && (isEditorFocused || showToolbarActions);

  const handleFormat = (command: string, value?: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    applyRichCommand(command, value);
  };

  return (
    <article className="concept-detail source-detail-page">
      <header className="source-hero">
        <div className="source-hero-kicker-row">
          <span className="detail-kicker">资料档案</span>
          {!hasFullContent && <span className="detail-status">加载中</span>}
        </div>
        <h1>{source.title}</h1>
        <div className="source-hero-meta">
          {source.author && <span>{source.author}</span>}
          <span>{formatRelativeTime(source.ingestedAt)}</span>
          {wordCount > 0 && <span>{wordCount.toLocaleString()} 字</span>}
          {readingMinutes > 0 && <span>约 {readingMinutes} 分钟</span>}
        </div>
        {source.url && (
          <div className="source-hero-actions">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-hero-link"
            >
              访问原文
              <span aria-hidden="true" className="source-hero-link-arrow">
                ↗
              </span>
            </a>
          </div>
        )}
      </header>

      <div className="source-layout">
        <section className="source-layout-main">
          <div
            className="source-editor-bar"
            data-visible={barVisible ? 'true' : 'false'}
            aria-label="正文格式工具"
          >
            <div className="source-editor-bar-format">
              <button
                type="button"
                className="source-editor-bar-btn"
                onMouseDown={handleFormat('formatBlock', '<p>')}
              >
                正文
              </button>
              <button
                type="button"
                className="source-editor-bar-btn"
                onMouseDown={handleFormat('formatBlock', '<h2>')}
              >
                标题
              </button>
              <button
                type="button"
                className="source-editor-bar-btn source-editor-bar-btn-bold"
                onMouseDown={handleFormat('bold')}
              >
                B
              </button>
              <button
                type="button"
                className="source-editor-bar-btn source-editor-bar-btn-italic"
                onMouseDown={handleFormat('italic')}
              >
                I
              </button>
              <button
                type="button"
                className="source-editor-bar-btn"
                onMouseDown={handleFormat('insertUnorderedList')}
              >
                列表
              </button>
              <button
                type="button"
                className="source-editor-bar-btn"
                onMouseDown={handleFormat('formatBlock', '<blockquote>')}
              >
                引用
              </button>
            </div>
            <div className="source-editor-bar-status">
              {isDirty && (
                <>
                  <button
                    className="source-editor-bar-action"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleResetDraft}
                    type="button"
                  >
                    还原
                  </button>
                  <button
                    className="source-editor-bar-action primary"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={handleSave}
                    disabled={!canSave}
                    type="button"
                  >
                    保存
                  </button>
                </>
              )}
              {saveStatus !== 'idle' && (
                <span className={`source-editor-bar-indicator ${saveStatus}`}>
                  <span className="source-editor-bar-dot" aria-hidden="true" />
                  {saveStatus === 'saving' && '保存中'}
                  {saveStatus === 'saved' && '已保存'}
                  {saveStatus === 'error' && '保存失败'}
                </span>
              )}
            </div>
          </div>

          {!hasFullContent ? (
            <div className="empty-state empty-state-compact">原文加载中...</div>
          ) : (
            <div className="source-editor-shell">
              <div
                ref={editorRef}
                className="prose source-editor-content note-editor-content"
                contentEditable={canEdit}
                suppressContentEditableWarning
                data-placeholder="直接在这里整理这份资料…"
                onInput={syncDraftFromEditor}
                onFocus={() => setIsEditorFocused(true)}
                onBlur={() => {
                  setIsEditorFocused(false);
                  if (!isDirty) return;
                  void handleSave();
                }}
                aria-label="资料正文所见即所得编辑器"
              />
            </div>
          )}
        </section>

        <aside className="source-layout-aside">
          {generatedCount > 0 && (
            <section className="source-aside-section">
              <div className="source-aside-title">
                关联概念
                <span className="source-aside-count">{generatedCount}</span>
              </div>
              <div className="source-aside-chips">
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
            </section>
          )}

          <section className="source-aside-section">
            <div className="source-aside-title">摄入记录</div>
            <ul className="source-aside-log">
              <li>
                <span className="source-aside-log-time">
                  {formatRelativeTime(source.ingestedAt)}
                </span>
                <span className="source-aside-log-text">
                  资料摄入完成，生成 {generatedCount} 个相关概念
                </span>
              </li>
            </ul>
          </section>

          {source.url && sourceHost && (
            <section className="source-aside-section">
              <div className="source-aside-title">资料来源</div>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="source-aside-link"
              >
                <span className="source-aside-link-host">{sourceHost}</span>
                <span aria-hidden="true" className="source-aside-link-arrow">
                  ↗
                </span>
              </a>
            </section>
          )}
        </aside>
      </div>
    </article>
  );
}
