'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { renderMarkdown } from '@/lib/format';
import { useAppStore } from '@/lib/store';
import {
  applyMarkdownSelectionEdit,
  type MarkdownEditCommand,
} from '@/lib/markdown-editor/selection';
import DOMPurify from 'dompurify';

const DRAFT_KEY_PREFIX = 'compound_note_draft_';
const DEFAULT_DRAFT_ID = 'default';
const DRAFT_SAVE_DEBOUNCE_MS = 1000;

interface DraftData {
  title: string;
  body: string;
}

interface NoteEditorProps {
  onDone: (title: string, content: string) => void;
  onCancel: () => void;
  disabled?: boolean;
  draftId?: string;
}

function loadDraft(id: string): DraftData | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch {
    return null;
  }
}

function saveDraft(id: string, data: DraftData) {
  try {
    if (data.title.trim() || data.body.trim()) {
      localStorage.setItem(DRAFT_KEY_PREFIX + id, JSON.stringify(data));
    } else {
      localStorage.removeItem(DRAFT_KEY_PREFIX + id);
    }
  } catch {
    // ignore quota errors
  }
}

function removeDraft(id: string) {
  try {
    localStorage.removeItem(DRAFT_KEY_PREFIX + id);
  } catch {
    // ignore
  }
}

export function NoteEditor({ onDone, onCancel, disabled = false, draftId }: NoteEditorProps) {
  const resolvedDraftId = draftId ?? DEFAULT_DRAFT_ID;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [draftRestored, setDraftRestored] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore draft on mount
  useEffect(() => {
    const draft = loadDraft(resolvedDraftId);
    if (draft) {
      setTitle(draft.title);
      setBody(draft.body);
      setDraftRestored(true);
    }
    titleRef.current?.focus();
  }, [resolvedDraftId]);

  // Debounced auto-save
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      saveDraft(resolvedDraftId, { title, body });
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [title, body, resolvedDraftId]);

  function handleDone() {
    const trimmedTitle = title.trim() || '无标题';
    const trimmedBody = body.trim();
    if (!trimmedBody && !trimmedTitle) return;
    removeDraft(resolvedDraftId);
    onDone(trimmedTitle, trimmedBody);
  }

  function handleCancel() {
    const draft = loadDraft(resolvedDraftId);
    if (draft && (draft.title.trim() || draft.body.trim())) {
      useAppStore.getState().showToast('草稿已保存，下次打开会自动恢复');
    }
    onCancel();
  }

  function applyMarkdownCommand(command: MarkdownEditCommand) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const result = applyMarkdownSelectionEdit({
      value: body,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
      command,
    });
    setBody(result.value);
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  const handleFormat = (command: MarkdownEditCommand) => (event: React.MouseEvent) => {
    event.preventDefault();
    applyMarkdownCommand(command);
  };

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      applyMarkdownCommand('bold');
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      applyMarkdownCommand('italic');
    }
  }

  const fullMarkdown = title.trim() ? `# ${title.trim()}\n\n${body}` : body;
  const rendered = useMemo(
    () => (mode === 'preview' ? DOMPurify.sanitize(renderMarkdown(fullMarkdown || '')) : ''),
    [fullMarkdown, mode],
  );
  const hasContent = title.trim().length > 0 || body.trim().length > 0;

  return (
    <div className="note-editor-overlay">
      <div className="note-editor-header">
        <button className="note-editor-cancel" onClick={handleCancel}>
          取消
        </button>

        <div className="note-mode-tabs">
          <button
            className={`note-mode-tab ${mode === 'edit' ? 'active' : ''}`}
            onClick={() => {
              setMode('edit');
              setTimeout(() => textareaRef.current?.focus(), 0);
            }}
          >
            编辑
          </button>
          <button
            className={`note-mode-tab ${mode === 'preview' ? 'active' : ''}`}
            onClick={() => setMode('preview')}
          >
            预览
          </button>
        </div>

        <button
          className={`note-editor-done ${hasContent ? 'enabled' : ''}`}
          disabled={!hasContent || disabled}
          onClick={handleDone}
        >
          {disabled ? '离线中' : '完成'}
        </button>
      </div>

      {draftRestored && <div className="note-editor-draft-banner">已恢复上次草稿</div>}

      <div className="note-editor-scroll">
        {mode === 'edit' ? (
          <>
            <input
              ref={titleRef}
              className="note-editor-title"
              placeholder="标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              spellCheck={false}
            />
            <div className="note-editor-hints">
              <span>- 列表</span>
              <span>&gt; 引用</span>
              <span>**粗体**</span>
              <span>*斜体*</span>
              <span>`代码`</span>
            </div>
            <div className="note-editor-toolbar" role="toolbar" aria-label="Markdown 格式">
              <button type="button" onMouseDown={handleFormat('bold')} aria-label="加粗">
                <strong>B</strong>
              </button>
              <button type="button" onMouseDown={handleFormat('italic')} aria-label="斜体">
                <em>I</em>
              </button>
              <button type="button" onMouseDown={handleFormat('heading')} aria-label="标题">
                H
              </button>
              <button type="button" onMouseDown={handleFormat('list')} aria-label="列表">
                ☰
              </button>
              <button type="button" onMouseDown={handleFormat('quote')} aria-label="引用">
                ❞
              </button>
            </div>
            <textarea
              ref={textareaRef}
              className="note-editor-textarea"
              placeholder="开始记录…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
            />
          </>
        ) : (
          <div
            className="prose note-preview"
            dangerouslySetInnerHTML={{
              __html:
                rendered ||
                '<p style="color:var(--text-tertiary);font-style:italic">还没有内容</p>',
            }}
          />
        )}
      </div>
    </div>
  );
}
