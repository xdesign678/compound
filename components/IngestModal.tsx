'use client';

import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { ingestSource } from '@/lib/api-client';
import { Icon } from './Icons';
import { NoteEditor } from './NoteEditor';
import type { SourceType } from '@/lib/types';

type Step = 'choose' | 'text' | 'link' | 'processing';

export function IngestModal() {
  const isOpen = useAppStore((s) => s.modalOpen);
  const close = useAppStore((s) => s.closeModal);
  const showToast = useAppStore((s) => s.showToast);
  const hideToast = useAppStore((s) => s.hideToast);
  const markFresh = useAppStore((s) => s.markFresh);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = modalRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [step, setStep] = useState<Step>('choose');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);

  function reset() {
    setStep('choose');
    setTitle('');
    setAuthor('');
    setUrl('');
    setContent('');
    setSubmitting(false);
    setNoteEditorOpen(false);
  }

  async function handleNoteEditorDone(noteTitle: string, noteContent: string) {
    setNoteEditorOpen(false);
    setSubmitting(true);
    showToast('AI 正在分析并编译到 Wiki...', true);
    close();
    try {
      const result = await ingestSource({
        title: noteTitle,
        type: 'text',
        rawContent: noteContent,
      });
      markFresh(result.newConceptIds);
      showToast(
        `完成 · 新建 ${result.newConceptIds.length} 个概念，更新 ${result.updatedConceptIds.length} 个`,
        false
      );
      setTimeout(() => hideToast(), 3500);
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`摄入失败: ${msg.slice(0, 80)}`, false);
      setTimeout(() => hideToast(), 4500);
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (submitting) return;
    reset();
    close();
  }

  async function handleSubmit(type: SourceType) {
    if (!content.trim() || !title.trim()) return;
    setSubmitting(true);
    showToast('AI 正在分析并编译到 Wiki...', true);
    close();
    try {
      const result = await ingestSource({
        title: title.trim(),
        type,
        author: author.trim() || undefined,
        url: url.trim() || undefined,
        rawContent: content.trim(),
      });
      markFresh(result.newConceptIds);
      showToast(
        `完成 · 新建 ${result.newConceptIds.length} 个概念,更新 ${result.updatedConceptIds.length} 个`,
        false
      );
      setTimeout(() => hideToast(), 3500);
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`摄入失败: ${msg.slice(0, 80)}`, false);
      setTimeout(() => hideToast(), 4500);
      setSubmitting(false);
    }
  }

  if (noteEditorOpen) {
    return (
      <NoteEditor
        onDone={handleNoteEditorDone}
        onCancel={() => { setNoteEditorOpen(false); }}
      />
    );
  }

  return (
    <div className={`modal-overlay ${isOpen ? 'visible' : ''}`} onClick={handleClose}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="ingest-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        {step === 'choose' && (
          <>
            <h3 id="ingest-modal-title">添加新资料</h3>
            <p className="modal-desc">原文只读 · AI 会把它编译进你的 Wiki,不会改动原文。</p>
            <div className="ingest-options">
              <button className="ingest-option" onClick={() => setStep('link')}>
                <div className="opt-icon"><Icon.Link /></div>
                <div>
                  <div className="opt-title">粘贴链接</div>
                  <div className="opt-sub">带上文章/帖子的正文</div>
                </div>
              </button>
              <button className="ingest-option" onClick={() => { close(); setNoteEditorOpen(true); }}>
                <div className="opt-icon"><Icon.Text /></div>
                <div>
                  <div className="opt-title">新建笔记</div>
                  <div className="opt-sub">支持 Markdown，实时预览</div>
                </div>
              </button>
              <button className="ingest-option" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                <div className="opt-icon"><Icon.File /></div>
                <div>
                  <div className="opt-title">上传文件</div>
                  <div className="opt-sub">PDF / Markdown (即将推出)</div>
                </div>
              </button>
            </div>
            <button className="modal-btn" onClick={handleClose}>取消</button>
          </>
        )}

        {step === 'text' && (
          <>
            <h3>粘贴文本</h3>
            <p className="modal-desc">贴一段笔记、文章节选或随手写的想法。AI 会提炼概念并链入你的 Wiki。</p>
            <div className="form-field">
              <label htmlFor="text-title">标题</label>
              <input
                id="text-title"
                className="form-input"
                placeholder="例如: 对 Karpathy Wiki 的思考"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="text-author">作者(可选)</label>
              <input
                id="text-author"
                className="form-input"
                placeholder="例如: 自己"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="text-content">正文</label>
              <textarea
                id="text-content"
                className="form-textarea"
                placeholder="粘贴或输入文本..."
                rows={8}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <button
              className="modal-btn primary"
              disabled={!title.trim() || !content.trim() || submitting}
              onClick={() => handleSubmit('text')}
            >
              {submitting ? '编译中...' : '送入 AI 编译'}
            </button>
            <button className="modal-btn" onClick={() => setStep('choose')}>返回</button>
          </>
        )}

        {step === 'link' && (
          <>
            <h3>添加链接资料</h3>
            <p className="modal-desc">
              当前版本需要你把目标页面的正文一起贴进来(浏览器无法跨域抓取)。AI 会基于正文编译。
            </p>
            <div className="form-field">
              <label htmlFor="link-title">标题</label>
              <input id="link-title" className="form-input" placeholder="例如: LLM Wiki by Karpathy" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="link-author">作者(可选)</label>
              <input id="link-author" className="form-input" value={author} onChange={(e) => setAuthor(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="link-url">链接 URL</label>
              <input id="link-url" className="form-input" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="link-content">正文(粘贴原文)</label>
              <textarea
                id="link-content"
                className="form-textarea"
                rows={8}
                placeholder="把页面正文粘贴到这里..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <button
              className="modal-btn primary"
              disabled={!title.trim() || !content.trim() || submitting}
              onClick={() => handleSubmit('link')}
            >
              {submitting ? '编译中...' : '送入 AI 编译'}
            </button>
            <button className="modal-btn" onClick={() => setStep('choose')}>返回</button>
          </>
        )}
      </div>
    </div>
  );
}
