'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { renderMarkdown } from '@/lib/format';
import DOMPurify from 'dompurify';

const DRAFT_KEY = 'compound_note_draft';
const DRAFT_SAVE_DEBOUNCE_MS = 1000;

interface NoteEditorProps {
  onDone: (title: string, content: string) => void;
  onCancel: () => void;
}

export function NoteEditor({ onDone, onCancel }: NoteEditorProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [draftRestored, setDraftRestored] = useState(false);
  const [showDraftHint, setShowDraftHint] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) {
        setText(saved);
        setDraftRestored(true);
      }
    } catch {
      // ignore localStorage errors
    }
    textareaRef.current?.focus();
  }, []);

  // Debounced auto-save to localStorage
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        if (text.trim()) {
          localStorage.setItem(DRAFT_KEY, text);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch {
        // ignore localStorage errors
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text]);

  function handleDone() {
    const trimmed = text.trim();
    if (!trimmed) return;
    // First non-empty line → title (strip leading # if any)
    const lines = trimmed.split('\n');
    const firstIdx = lines.findIndex((l) => l.trim());
    const rawTitle = lines[firstIdx] ?? '';
    const title = rawTitle.replace(/^#+\s*/, '').trim() || '无标题';
    const body = lines
      .slice(firstIdx + 1)
      .join('\n')
      .trim();
    // Clear draft on successful submit
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    onDone(title, body ? trimmed : trimmed);
  }

  function handleCancel() {
    // If draft exists in localStorage, show hint
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved && saved.trim()) {
        setShowDraftHint(true);
        setTimeout(() => {
          onCancel();
        }, 1800);
        return;
      }
    } catch {
      /* ignore */
    }
    onCancel();
  }

  const rendered = useMemo(
    () => (mode === 'preview' ? DOMPurify.sanitize(renderMarkdown(text || '')) : ''),
    [text, mode],
  );
  const hasContent = text.trim().length > 0;

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
          disabled={!hasContent}
          onClick={handleDone}
        >
          完成
        </button>
      </div>

      {draftRestored && !showDraftHint && (
        <div className="note-editor-draft-banner">已恢复上次草稿</div>
      )}

      {showDraftHint && (
        <div className="note-editor-draft-banner">草稿已保存，下次打开会自动恢复</div>
      )}

      <div className="note-editor-scroll">
        {mode === 'edit' ? (
          <>
            <div className="note-editor-hints">
              <span># 标题</span>
              <span>- 列表</span>
              <span>&gt; 引用</span>
              <span>**粗体**</span>
              <span>*斜体*</span>
            </div>
            <textarea
              ref={textareaRef}
              className="note-editor-textarea"
              placeholder={'# 标题\n\n开始记录...'}
              value={text}
              onChange={(e) => setText(e.target.value)}
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
