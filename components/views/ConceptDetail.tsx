'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { SourceTypeIcon } from '../Icons';
import { Prose } from '../Prose';

export function ConceptDetail({ id }: { id: string }) {
  const openConcept = useAppStore((s) => s.openConcept);
  const openSource = useAppStore((s) => s.openSource);
  const freshIds = useAppStore((s) => s.freshConceptIds);

  const concept = useLiveQuery(async () => getDb().concepts.get(id), [id]);
  const sources = useLiveQuery(async () => {
    if (!concept) return [];
    const items = await Promise.all(concept.sources.map((sid) => getDb().sources.get(sid)));
    return items.filter(Boolean);
  }, [concept?.sources.join(',')]);
  const related = useLiveQuery(async () => {
    if (!concept) return [];
    const items = await Promise.all(concept.related.map((cid) => getDb().concepts.get(cid)));
    return items.filter(Boolean);
  }, [concept?.related.join(',')]);

  if (!concept) return <div className="empty-state">未找到概念</div>;

  const isFresh = freshIds[concept.id];

  return (
    <div className="concept-detail">
      <h1>{concept.title}</h1>
      <div className="detail-meta">
        <span>{isFresh ? '刚更新 · ' : '更新于 '}{formatRelativeTime(concept.updatedAt)}</span>
        <span>·</span>
        <span>{concept.sources.length} 份资料</span>
        <span>·</span>
        <span>{concept.related.length} 个链接</span>
        <span>·</span>
        <span>v{concept.version}</span>
      </div>

      <Prose markdown={concept.body} />

      {sources && sources.length > 0 && (
        <div className="detail-section">
          <h3>基于资料</h3>
          {sources.map((s) => (
            <button key={s!.id} className="source-ref" onClick={() => openSource(s!.id)}>
              <div className="src-icon">
                <SourceTypeIcon type={s!.type} />
              </div>
              <div className="src-info">
                <div className="src-title">{s!.title}</div>
                <div className="src-meta">
                  {s!.author ?? '未知来源'} · {formatRelativeTime(s!.ingestedAt)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {related && related.length > 0 && (
        <div className="detail-section">
          <h3>相关概念</h3>
          <div className="related-grid">
            {related.map((r) => (
              <button key={r!.id} className="related-chip" onClick={() => openConcept(r!.id)}>
                {r!.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="detail-section">
        <h3>AI 编辑记录</h3>
        <div className="edit-log-item">
          <span className="time">{formatRelativeTime(concept.updatedAt)}</span>
          <span>当前版本 v{concept.version}</span>
        </div>
        {concept.createdAt !== concept.updatedAt && (
          <div className="edit-log-item">
            <span className="time">{formatRelativeTime(concept.createdAt)}</span>
            <span>首次创建</span>
          </div>
        )}
      </div>
    </div>
  );
}
