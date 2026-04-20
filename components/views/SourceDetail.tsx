'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { SourceTypeIcon } from '../Icons';
import { Prose } from '../Prose';

export function SourceDetail({ id }: { id: string }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const [showRaw, setShowRaw] = useState(false);

  const source = useLiveQuery(async () => getDb().sources.get(id), [id]);
  const generated = useLiveQuery(
    async () => getDb().concepts.where('sources').equals(id).toArray(),
    [id]
  );

  if (!source) return <div className="empty-state">未找到资料</div>;

  return (
    <article className="concept-detail">
      <div className="detail-kicker-row">
        <div className="detail-kicker">资料档案</div>
        <div className="detail-status subtle">{source.type}</div>
      </div>
      <h1>{source.title}</h1>
      <p className="detail-intro">
        这份资料作为原文档案保存，只读不改。知识库中的概念页会引用它，但不会覆盖它。
      </p>
      <div className="detail-meta">
        {source.author && <><span>{source.author}</span><span>·</span></>}
        <span>{formatRelativeTime(source.ingestedAt)}</span>
        <span>·</span>
        <span><SourceTypeIcon type={source.type} /> {source.type}</span>
      </div>

      {source.url && (
        <p className="detail-url">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="source-url-link"
          >
            {source.url}
          </a>
        </p>
      )}

      <p className="detail-note">
        这份资料已被 AI 编译进你的 Wiki。原文保持不变(<strong>不可变层</strong>),AI 从中生成或更新了{' '}
        <strong>{generated?.length ?? 0} 个概念页</strong>。
      </p>

      {generated && generated.length > 0 && (
        <div className="detail-section">
          <h3>由此生成/更新的概念</h3>
          <div className="related-grid">
            {generated.map((c) => (
              <button key={c.id} className="related-chip" onClick={() => openConcept(c.id)}>
                {c.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="detail-section">
        <h3>原文</h3>
        {showRaw ? (
          <div className="raw-content-panel">
            <Prose markdown={source.rawContent} className="prose-raw" />
          </div>
        ) : (
          <button className="modal-btn" onClick={() => setShowRaw(true)}>
            查看原文 ({source.rawContent.length.toLocaleString()} 字符)
          </button>
        )}
      </div>

      <div className="detail-section">
        <h3>摄入记录</h3>
        <div className="edit-log-item">
          <span className="time">{formatRelativeTime(source.ingestedAt)}</span>
          <span>资料摄入完成,生成 {generated?.length ?? 0} 个相关概念</span>
        </div>
      </div>
    </article>
  );
}
