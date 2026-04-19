'use client';

import { useState, useEffect, useRef } from 'react';
import { renderMarkdown } from '@/lib/format';
import DOMPurify from 'dompurify';

interface NoteEditorProps {
  onDone: (title: string, content: string) => void;
  onCancel: () => void;
}

export function NoteEditor({ onDone, onCancel }: NoteEditorProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleDone() {
    const trimmed = text.trim();
    if (!trimmed) return;
    // First non-empty line → title (strip leading # if any)
    const lines = trimmed.split('\n');
    const firstIdx = lines.findIndex(l => l.trim());
    const rawTitle = lines[firstIdx] ?? '';
    const title = rawTitle.replace(/^#+\s*/, '').trim() || '无标题';
    const body = lines.slice(firstIdx + 1).join('\n').trim();
    onDone(title, body ? trimmed : trimmed);
  }

  const rendered = DOMPurify.sanitize(renderMarkdown(text || ''));
  const hasContent = text.trim().length > 0;

  return (
    <div className="note-editor-overlay">
      <div className="note-editor-header">
        <button className="note-editor-cancel" onClick={onCancel}>取消</button>

        <div className="note-mode-tabs">
          <button
            className={`note-mode-tab ${mode === 'edit' ? 'active' : ''}`}
            onClick={() => { setMode('edit'); setTimeout(() => textareaRef.current?.focus(), 0); }}
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
            dangerouslySetInnerHTML={{ __html: rendered || '<p style="color:var(--text-tertiary);font-style:italic">还没有内容</p>' }}
          />
        )}
      </div>
    </div>
  );
}
