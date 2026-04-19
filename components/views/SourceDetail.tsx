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
  const generated = useLiveQuery(async () => {
    const all = await getDb().concepts.toArray();
    return all.filter((c) => c.sources.includes(id));
  }, [id]);

  if (!source) return <div className="empty-state">未找到资料</div>;

  return (
    <div className="concept-detail">
      <h1>{source.title}</h1>
      <div className="detail-meta">
        {source.author && <><span>{source.author}</span><span>·</span></>}
        <span>{formatRelativeTime(source.ingestedAt)}</span>
        <span>·</span>
        <span><SourceTypeIcon type={source.type} /> {source.type}</span>
      </div>

      {source.url && (
        <p style={{ marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="source-url-link"
            style={{ color: 'var(--brand-clay)', textDecoration: 'none', wordBreak: 'break-all', fontSize: '13px' }}
          >
            {source.url}
          </a>
        </p>
      )}

      <p style={{ fontFamily: 'var(--font-reading)', fontSize: 15, lineHeight: 1.65, color: 'var(--text-body)' }}>
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
          <div
            style={{
              background: 'var(--bg-muted)',
              padding: 14,
              borderRadius: 10,
              maxHeight: 500,
              overflowY: 'auto',
            }}
          >
            <Prose markdown={source.rawContent} />
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
    </div>
  );
}
