'use client';

import '@/components/modals.css';
import '@/app/modals.css';
import { useState, useEffect, useRef, type DragEvent } from 'react';
import { useAppStore } from '@/lib/store';
import { replayDurableIngestOutboxIfAuthorized } from '@/lib/api-client';
import { canQueueOfflineWrite } from '@/lib/cloud-sync';
import { getLlmConfigForPurpose } from '@/lib/llm-config';
import { buildCredentialContext, createOutboxItem, persistOutboxItem } from '@/lib/offline-outbox';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { Icon } from './Icons';
import { ImportProgress, rememberRecentImport } from './ImportProgress';
import { NoteEditor } from './NoteEditor';
import type { SourceType } from '@/lib/types';

type Step = 'choose' | 'link' | 'processing';

export function IngestModal() {
  const isOpen = useAppStore((s) => s.modalOpen);
  const close = useAppStore((s) => s.closeModal);
  const isOnline = useAppStore((s) => s.isOnline);

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

  async function queueIngestWrite(
    payload: {
      title: string;
      type: SourceType;
      author?: string;
      url?: string;
      rawContent: string;
    },
    _label: string,
  ): Promise<void> {
    if (!canQueueOfflineWrite(payload)) {
      throw new Error('单条内容超过 256KB，未写入离线队列。请缩小后再提交。');
    }
    const outbox = createOutboxItem({
      kind: 'ingest',
      payload,
      credentialContext: await buildCredentialContext(getLlmConfigForPurpose('wiki')),
    });
    await persistOutboxItem(outbox);
    const online = typeof navigator === 'undefined' ? isOnline : navigator.onLine;
    if (online) {
      void replayDurableIngestOutboxIfAuthorized();
    }
  }

  async function handleNoteEditorDone(noteTitle: string, noteContent: string) {
    setSubmitting(true);
    const payload = {
      title: noteTitle,
      type: 'text' as const,
      rawContent: noteContent,
    };
    try {
      await queueIngestWrite(payload, noteTitle || '笔记');
      setNoteEditorOpen(false);
      close();
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.slice(0, 160));
      setSubmitting(false);
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
    const capturedTitle = title.trim();
    const capturedUrl = url.trim();
    const payload = {
      title: capturedTitle,
      type,
      author: author.trim() || undefined,
      url: capturedUrl || undefined,
      rawContent: content.trim(),
    };
    rememberRecentImport({
      kind: 'ingest',
      label: capturedTitle,
      detail: capturedUrl || '手动粘贴正文',
    });
    try {
      await queueIngestWrite(payload, capturedTitle);
      reset();
      close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.slice(0, 160));
      setSubmitting(false);
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
      />
    );
  }

  return (
    <div className={`modal-overlay${visible ? ' visible' : ''}`} onClick={handleClose}>
      <div
        className="modal ingest-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ingest-modal-title"
        aria-describedby={
          step === 'choose' ? 'ingest-modal-desc' : confirmClose ? undefined : 'ingest-link-desc'
        }
        tabIndex={-1}
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
                <button
                  className="modal-btn primary"
                  type="button"
                  onClick={() => setConfirmClose(false)}
                >
                  继续编辑
                </button>
                <button className="modal-btn danger" type="button" onClick={handleConfirmClose}>
                  确认
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
                <div className="ingest-form-actions">
                  <button
                    className="modal-btn primary"
                    type="button"
                    disabled={!title.trim() || !content.trim() || submitting}
                    onClick={() => handleSubmit('link')}
                  >
                    {submitting ? '提交中…' : !isOnline ? '离线排队' : '送入 AI 编译'}
                  </button>
                  <button
                    className="modal-btn"
                    type="button"
                    disabled={submitting}
                    onClick={() => setStep('choose')}
                  >
                    返回
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
