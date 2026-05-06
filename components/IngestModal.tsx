'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore, type TaskItem } from '@/lib/store';
import { ingestSource } from '@/lib/api-client';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { Icon } from './Icons';
import { NoteEditor } from './NoteEditor';
import type { SourceType } from '@/lib/types';

type Step = 'choose' | 'link' | 'processing';

export function IngestModal() {
  const isOpen = useAppStore((s) => s.modalOpen);
  const close = useAppStore((s) => s.closeModal);
  const showToast = useAppStore((s) => s.showToast);
  const showErrorToast = useAppStore((s) => s.showErrorToast);
  const hideToast = useAppStore((s) => s.hideToast);
  const markFresh = useAppStore((s) => s.markFresh);
  const isOnline = useAppStore((s) => s.isOnline);
  const addTask = useAppStore((s) => s.addTask);
  const updateTask = useAppStore((s) => s.updateTask);

  const modalRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [step, setStep] = useState<Step>('choose');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  useFocusTrap(modalRef, isOpen);

  useEffect(() => {
    const el = modalRef.current;
    if (!el || !isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, step]);

  function reset() {
    setStep('choose');
    setTitle('');
    setAuthor('');
    setUrl('');
    setContent('');
    setSubmitting(false);
    setNoteEditorOpen(false);
    setError(null);
    setConfirmClose(false);
  }

  async function handleNoteEditorDone(noteTitle: string, noteContent: string) {
    setNoteEditorOpen(false);
    setSubmitting(true);
    const taskId = `ingest-${Date.now()}`;
    const task: TaskItem = {
      id: taskId,
      kind: 'ingest',
      label: noteTitle || '笔记',
      status: 'running',
      startedAt: Date.now(),
      retry: () => handleNoteEditorDone(noteTitle, noteContent),
    };
    addTask(task);
    close();
    reset();
    try {
      const result = await ingestSource({
        title: noteTitle,
        type: 'text',
        rawContent: noteContent,
      });
      markFresh(result.newConceptIds);
      updateTask(taskId, {
        status: 'success',
        finishedAt: Date.now(),
        result: `新建 ${result.newConceptIds.length} 个概念，更新 ${result.updatedConceptIds.length} 个`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateTask(taskId, {
        status: 'error',
        finishedAt: Date.now(),
        error: msg.slice(0, 160),
      });
    }
  }

  function handleClose() {
    if (submitting) return;
    // If on link step with any content filled, require confirmation
    if (step === 'link' && (title.trim() || author.trim() || url.trim() || content.trim())) {
      setConfirmClose(true);
      return;
    }
    reset();
    close();
  }

  function handleConfirmClose() {
    reset();
    close();
  }

  async function handleSubmit(type: SourceType) {
    if (!content.trim() || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    const taskId = `ingest-${Date.now()}`;
    const capturedTitle = title.trim();
    const capturedContent = content.trim();
    const capturedAuthor = author.trim();
    const capturedUrl = url.trim();
    const task: TaskItem = {
      id: taskId,
      kind: 'ingest',
      label: capturedTitle,
      status: 'running',
      startedAt: Date.now(),
      retry: async () => {
        await ingestSource({
          title: capturedTitle,
          type,
          author: capturedAuthor || undefined,
          url: capturedUrl || undefined,
          rawContent: capturedContent,
        });
      },
    };
    addTask(task);
    reset();
    close();
    try {
      const result = await ingestSource({
        title: capturedTitle,
        type,
        author: capturedAuthor || undefined,
        url: capturedUrl || undefined,
        rawContent: capturedContent,
      });
      markFresh(result.newConceptIds);
      updateTask(taskId, {
        status: 'success',
        finishedAt: Date.now(),
        result: `新建 ${result.newConceptIds.length} 个概念，更新 ${result.updatedConceptIds.length} 个`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateTask(taskId, {
        status: 'error',
        finishedAt: Date.now(),
        error: msg.slice(0, 160),
      });
    }
  }

  if (noteEditorOpen) {
    return (
      <NoteEditor
        onDone={handleNoteEditorDone}
        onCancel={() => {
          setNoteEditorOpen(false);
        }}
        disabled={!isOnline}
      />
    );
  }

  return (
    <div className={`modal-overlay${visible ? ' visible' : ''}`} onClick={handleClose}>
      <div
        className="modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ingest-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-handle" />
        {step === 'choose' && (
          <>
            <h3 id="ingest-modal-title">添加新资料</h3>
            <p className="modal-desc">原文只读 · AI 会把它编译进你的 Wiki,不会改动原文。</p>
            <div className="ingest-options">
              <button className="ingest-option" onClick={() => setStep('link')}>
                <div className="opt-icon">
                  <Icon.Link />
                </div>
                <div>
                  <div className="opt-title">粘贴链接</div>
                  <div className="opt-sub">带上文章/帖子的正文</div>
                </div>
              </button>
              <button className="ingest-option" onClick={() => setNoteEditorOpen(true)}>
                <div className="opt-icon">
                  <Icon.Text />
                </div>
                <div>
                  <div className="opt-title">新建笔记</div>
                  <div className="opt-sub">支持 Markdown，实时预览</div>
                </div>
              </button>
              <button
                className="ingest-option"
                disabled
                style={{ opacity: 0.5, cursor: 'not-allowed' }}
              >
                <div className="opt-icon">
                  <Icon.File />
                </div>
                <div>
                  <div className="opt-title">上传文件</div>
                  <div className="opt-sub">PDF / Markdown (即将推出)</div>
                </div>
              </button>
            </div>
            <button className="modal-btn" onClick={handleClose}>
              取消
            </button>
          </>
        )}

        {step === 'link' && (
          <>
            <h3>添加链接资料</h3>
            {confirmClose ? (
              <div className="ingest-confirm-close">
                <p className="modal-desc">已填写的内容将丢失，确认关闭？</p>
                <button className="modal-btn primary" onClick={handleConfirmClose}>
                  确认
                </button>
                <button className="modal-btn" onClick={() => setConfirmClose(false)}>
                  继续编辑
                </button>
              </div>
            ) : (
              <>
                <p className="modal-desc">
                  当前版本需要你把目标页面的正文一起贴进来(浏览器无法跨域抓取)。AI 会基于正文编译。
                </p>
                <div className="form-field">
                  <label htmlFor="link-title">标题</label>
                  <input
                    id="link-title"
                    className="form-input"
                    placeholder="例如: LLM Wiki by Karpathy"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="link-author">作者(可选)</label>
                  <input
                    id="link-author"
                    className="form-input"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="link-url">链接 URL</label>
                  <input
                    id="link-url"
                    className="form-input"
                    placeholder="https://..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
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
                {error && <div className="ingest-error-banner">{error}</div>}
                <button
                  className="modal-btn primary"
                  disabled={!title.trim() || !content.trim() || submitting || !isOnline}
                  onClick={() => handleSubmit('link')}
                >
                  {!isOnline ? '离线中，无法提交' : submitting ? '编译中...' : '送入 AI 编译'}
                </button>
                <button
                  className="modal-btn"
                  disabled={submitting}
                  onClick={() => setStep('choose')}
                >
                  返回
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
