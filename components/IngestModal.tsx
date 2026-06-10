'use client';

import '@/components/modals.css';
import '@/app/modals.css';
import { useState, useEffect, useRef, type DragEvent } from 'react';
import { useAppStore, type TaskItem } from '@/lib/store';
import { ingestSource, isOfflineError } from '@/lib/api-client';
import { canQueueOfflineWrite, getOfflineWritePayloadBytes } from '@/lib/cloud-sync';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { Icon } from './Icons';
import { ImportProgress, rememberRecentImport } from './ImportProgress';
import { NoteEditor } from './NoteEditor';
import type { SourceType } from '@/lib/types';

type Step = 'choose' | 'link' | 'processing';

export function IngestModal() {
  const isOpen = useAppStore((s) => s.modalOpen);
  const close = useAppStore((s) => s.closeModal);
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

  const hasDraft = Boolean(title.trim() || author.trim() || url.trim() || content.trim());

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  useFocusTrap(modalRef, isOpen);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, step, hasDraft, submitting]);

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
    const payload = {
      title: noteTitle,
      type: 'text' as const,
      rawContent: noteContent,
    };
    const task: TaskItem = {
      id: taskId,
      kind: 'ingest',
      label: noteTitle || '笔记',
      status: 'running',
      startedAt: Date.now(),
      queuedPayloadBytes: getOfflineWritePayloadBytes(payload),
      retry: async () => {
        const result = await ingestSource(payload);
        markFresh(result.newConceptIds);
        updateTask(taskId, {
          result: `新建 ${result.newConceptIds.length} 个概念，更新 ${result.updatedConceptIds.length} 个`,
        });
      },
    };
    addTask(task);
    close();
    reset();
    try {
      const result = await ingestSource(payload);
      markFresh(result.newConceptIds);
      updateTask(taskId, {
        status: 'success',
        finishedAt: Date.now(),
        result: `新建 ${result.newConceptIds.length} 个概念，更新 ${result.updatedConceptIds.length} 个`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const shouldQueue = isOfflineError(err) && canQueueOfflineWrite(payload);
      updateTask(taskId, {
        status: shouldQueue ? 'paused-offline' : 'error',
        finishedAt: shouldQueue ? undefined : Date.now(),
        error: shouldQueue
          ? '离线暂停，联网后会自动重试。'
          : isOfflineError(err)
            ? '离线队列单条内容超过 256KB，请联网后重新提交。'
            : msg.slice(0, 160),
      });
    }
  }

  function handleClose() {
    if (submitting) return;
    // If on link step with any content filled, require confirmation
    if (step === 'link' && hasDraft) {
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
    const payload = {
      title: capturedTitle,
      type,
      author: capturedAuthor || undefined,
      url: capturedUrl || undefined,
      rawContent: capturedContent,
    };
    const task: TaskItem = {
      id: taskId,
      kind: 'ingest',
      label: capturedTitle,
      status: 'running',
      startedAt: Date.now(),
      queuedPayloadBytes: getOfflineWritePayloadBytes(payload),
      retry: async () => {
        const result = await ingestSource(payload);
        markFresh(result.newConceptIds);
        updateTask(taskId, {
          result: `新建 ${result.newConceptIds.length} 个概念，更新 ${result.updatedConceptIds.length} 个`,
        });
      },
    };
    addTask(task);
    rememberRecentImport({
      kind: 'ingest',
      label: capturedTitle,
      detail: capturedUrl || '手动粘贴正文',
    });
    try {
      const result = await ingestSource(payload);
      markFresh(result.newConceptIds);
      updateTask(taskId, {
        status: 'success',
        finishedAt: Date.now(),
        result: `新建 ${result.newConceptIds.length} 个概念，更新 ${result.updatedConceptIds.length} 个`,
      });
      reset();
      close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const shouldQueue = isOfflineError(err) && canQueueOfflineWrite(payload);
      const nextError = shouldQueue
        ? '离线暂停，联网后会自动重试。'
        : isOfflineError(err)
          ? '离线队列单条内容超过 256KB，请联网后重新提交。'
          : msg.slice(0, 160);
      setError(nextError);
      setSubmitting(false);
      updateTask(taskId, {
        status: shouldQueue ? 'paused-offline' : 'error',
        finishedAt: shouldQueue ? undefined : Date.now(),
        error: nextError,
      });
    }
  }

  function handleContentDrop(e: DragEvent<HTMLTextAreaElement>) {
    const droppedText = e.dataTransfer.getData('text/plain').trim();
    if (!droppedText) return;
    e.preventDefault();
    setError(null);
    setContent((current) => (current.trim() ? `${current.trim()}\n\n${droppedText}` : droppedText));
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
        aria-describedby={
          step === 'choose' ? 'ingest-modal-desc' : confirmClose ? undefined : 'ingest-link-desc'
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-handle" />
        {step === 'choose' && (
          <>
            <h3 id="ingest-modal-title">添加新资料</h3>
            <p className="modal-desc" id="ingest-modal-desc">
              原文只读 · AI 会把它编译进你的 Wiki，不会改动原文。
            </p>
            <div className="ingest-options">
              <button className="ingest-option" type="button" onClick={() => setStep('link')}>
                <div className="opt-icon" aria-hidden="true">
                  <Icon.Link />
                </div>
                <div>
                  <div className="opt-title">粘贴链接</div>
                  <div className="opt-sub">带上文章/帖子的正文</div>
                </div>
              </button>
              <button
                className="ingest-option"
                type="button"
                onClick={() => setNoteEditorOpen(true)}
              >
                <div className="opt-icon" aria-hidden="true">
                  <Icon.Text />
                </div>
                <div>
                  <div className="opt-title">新建笔记</div>
                  <div className="opt-sub">支持 Markdown，实时预览</div>
                </div>
              </button>
              <button
                className="ingest-option ingest-option-disabled"
                type="button"
                disabled
                aria-disabled="true"
              >
                <div className="opt-icon" aria-hidden="true">
                  <Icon.File />
                </div>
                <div>
                  <div className="opt-title">上传文件</div>
                  <div className="opt-sub">PDF / Markdown (即将推出)</div>
                </div>
              </button>
            </div>
            <button className="modal-btn" type="button" onClick={handleClose}>
              取消
            </button>
          </>
        )}

        {step === 'link' && (
          <>
            <h3 id="ingest-modal-title">添加链接资料</h3>
            {confirmClose ? (
              <div className="ingest-confirm-close" role="alert" aria-live="assertive">
                <p className="modal-desc">已填写的内容将丢失，确认关闭？</p>
                <button className="modal-btn primary" type="button" onClick={handleConfirmClose}>
                  确认
                </button>
                <button className="modal-btn" type="button" onClick={() => setConfirmClose(false)}>
                  继续编辑
                </button>
              </div>
            ) : (
              <>
                <p className="modal-desc" id="ingest-link-desc">
                  当前版本需要你把目标页面的正文一起贴进来（浏览器无法跨域抓取）。AI
                  会基于正文编译，长任务会同步出现在任务中心。
                </p>
                {(submitting || error) && (
                  <ImportProgress
                    title="资料导入"
                    stage={submitting ? '正在送入 AI 编译' : '导入失败'}
                    detail={submitting ? `${title || '等待提交'} · 可在任务中心继续查看` : title}
                    progress={submitting ? 35 : 0}
                    running={submitting}
                    error={error}
                    onRetry={() => handleSubmit('link')}
                    onClose={() => setError(null)}
                  />
                )}
                <div className="form-field">
                  <label htmlFor="link-title">标题</label>
                  <input
                    id="link-title"
                    className="form-input"
                    type="text"
                    placeholder="例如: LLM Wiki by Karpathy"
                    value={title}
                    autoComplete="off"
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="link-author">作者(可选)</label>
                  <input
                    id="link-author"
                    className="form-input"
                    type="text"
                    value={author}
                    autoComplete="off"
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="link-url">链接 URL</label>
                  <input
                    id="link-url"
                    className="form-input"
                    type="url"
                    inputMode="url"
                    placeholder="https://…"
                    value={url}
                    autoComplete="url"
                    spellCheck={false}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="link-content">正文(粘贴原文)</label>
                  <textarea
                    id="link-content"
                    className="form-textarea"
                    rows={8}
                    placeholder="把页面正文粘贴到这里…"
                    value={content}
                    aria-describedby="ingest-link-desc"
                    onDrop={handleContentDrop}
                    onPaste={() => setError(null)}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </div>
                {error && (
                  <div className="ingest-error-banner" role="alert" aria-live="assertive">
                    {error}
                  </div>
                )}
                <button
                  className="modal-btn primary"
                  type="button"
                  disabled={!title.trim() || !content.trim() || submitting || !isOnline}
                  onClick={() => handleSubmit('link')}
                >
                  {!isOnline ? '离线中，无法提交' : submitting ? '编译中...' : '送入 AI 编译'}
                </button>
                <button
                  className="modal-btn"
                  type="button"
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
