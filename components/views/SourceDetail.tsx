'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { ensureSourceHydrated } from '@/lib/cloud-sync';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { Prose } from '../Prose';

export function SourceDetail({ id }: { id: string }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [draftContent, setDraftContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const source = useLiveQuery(async () => getDb().sources.get(id), [id]);
  const generated = useLiveQuery(
    async () => getDb().concepts.where('sources').equals(id).toArray(),
    [id]
  );

  useEffect(() => {
    if (!source || source.contentStatus === 'full') return;
    void ensureSourceHydrated(id).catch((err) => {
      console.warn('[source-detail] hydrate failed:', err);
    });
  }, [id, source]);

  useEffect(() => {
    setMode('preview');
    setDraftContent('');
    setIsDirty(false);
    setSaveStatus('idle');
  }, [id]);

  useEffect(() => {
    if (!source || source.contentStatus !== 'full' || isDirty) return;
    setDraftContent(source.rawContent);
  }, [source, isDirty]);

  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = window.setTimeout(() => setSaveStatus('idle'), 2200);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  if (!source) return <div className="empty-state">未找到资料</div>;

  const generatedCount = generated?.length ?? 0;
  const generatedItems = generated ?? [];
  const canEdit = source.contentStatus === 'full';
  const canSave = canEdit && isDirty && draftContent.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaveStatus('saving');
    try {
      await getDb().sources.update(id, { rawContent: draftContent });
      setIsDirty(false);
      setSaveStatus('saved');
    } catch (err) {
      console.warn('[source-detail] save failed:', err);
      setSaveStatus('error');
    }
  }

  return (
    <article className="concept-detail source-detail-page">
      <div className="detail-kicker-row">
        <div className="detail-kicker">资料档案</div>
        <div className="detail-status subtle">{source.type}</div>
        {source.contentStatus !== 'full' && <div className="detail-status">加载中</div>}
      </div>
      <h1>{source.title}</h1>
      <div className="detail-meta">
        {source.author && <><span>{source.author}</span><span>·</span></>}
        <span>{formatRelativeTime(source.ingestedAt)}</span>
        <span>·</span>
        <span>{generatedCount} 个相关概念</span>
      </div>

      <div className="source-detail-summary">
        <p className="detail-note">
          这里把资料正文放在中心位置，头部只保留来源信息和相关概念，先方便你读和改，再决定要不要继续编译。
        </p>

        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="source-detail-link"
          >
            查看原链接
          </a>
        )}
      </div>

      {generatedCount > 0 && (
        <div className="source-detail-head-section">
          <h3>相关概念</h3>
          <div className="related-grid source-detail-related-grid">
            {generatedItems.map((c) => (
              <button key={c.id} className="related-chip" onClick={() => openConcept(c.id)}>
                {c.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="source-detail-main">
        <div className="source-detail-toolbar">
          <div className="source-detail-mode-tabs" role="tablist" aria-label="资料视图模式">
            <button
              className={`source-detail-mode-tab${mode === 'preview' ? ' active' : ''}`}
              onClick={() => setMode('preview')}
              type="button"
            >
              预览
            </button>
            <button
              className={`source-detail-mode-tab${mode === 'edit' ? ' active' : ''}`}
              onClick={() => canEdit && setMode('edit')}
              type="button"
              disabled={!canEdit}
            >
              编辑
            </button>
          </div>

          <div className="source-detail-toolbar-meta">
            <span>{draftContent.length.toLocaleString()} 字符</span>
            {saveStatus !== 'idle' && (
              <span className={`source-detail-save-status ${saveStatus}`}>
                {saveStatus === 'saving' && '保存中...'}
                {saveStatus === 'saved' && '已保存'}
                {saveStatus === 'error' && '保存失败'}
              </span>
            )}
            {mode === 'edit' && (
              <button
                className="modal-btn primary source-detail-save-btn"
                onClick={handleSave}
                disabled={!canSave}
                type="button"
              >
                保存笔记
              </button>
            )}
          </div>
        </div>

        <p className="source-detail-editor-tip">
          编辑只更新这份资料的正文，不会自动改写上方概念。
        </p>

        {source.contentStatus !== 'full' ? (
          <div className="empty-state empty-state-compact">原文加载中...</div>
        ) : mode === 'edit' ? (
          <textarea
            className="source-detail-textarea"
            value={draftContent}
            onChange={(e) => {
              const nextValue = e.target.value;
              setDraftContent(nextValue);
              setIsDirty(nextValue !== source.rawContent);
              if (saveStatus !== 'idle') setSaveStatus('idle');
            }}
            spellCheck={false}
            aria-label="编辑资料正文"
          />
        ) : (
          <div className="source-detail-prose-shell">
            <Prose markdown={draftContent} className="prose-raw source-detail-prose" />
          </div>
        )}
      </div>

      <div className="detail-section">
        <h3>摄入记录</h3>
        <div className="edit-log-item">
          <span className="time">{formatRelativeTime(source.ingestedAt)}</span>
          <span>资料摄入完成，生成 {generatedCount} 个相关概念</span>
        </div>
      </div>
    </article>
  );
}
