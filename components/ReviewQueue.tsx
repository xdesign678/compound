'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAdminAuthHeaders } from '@/lib/admin-auth-client';

type ReviewItem = {
  id: string;
  kind: string;
  status: string;
  title: string;
  target_type: string | null;
  target_id: string | null;
  source_id: string | null;
  confidence: number | null;
  payload_json: string | null;
  created_at: number;
};

function fmtDate(value: number) {
  return new Date(value).toLocaleString();
}

function prettyPayload(value: string | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { ...getAdminAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export default function ReviewQueue() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(
    async (nextStatus = status) => {
      try {
        const res = await fetch(`/api/review/queue?status=${nextStatus}`, {
          headers: getAdminAuthHeaders(),
          cache: 'no-store',
        });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setItems(json.items || []);
        setMetrics(json.metrics || {});
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [status],
  );

  const resolve = useCallback(
    async (id: string, next: 'approved' | 'rejected' | 'resolved') => {
      setBusyId(id);
      try {
        await postJson(`/api/review/queue/${id}`, { status: next });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId('');
      }
    },
    [load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="ops-page review-page">
      <header className="ops-topbar">
        <div>
          <div className="ops-kicker">Compound Ops</div>
          <h1>审核队列</h1>
          <p>低置信度摘要、大批量变更和冲突候选会停在这里。</p>
        </div>
        <div className="ops-actions">
          <button
            className={`ops-btn ${status === 'open' ? 'primary' : ''}`}
            onClick={() => {
              setStatus('open');
              void load('open');
            }}
          >
            待处理 {metrics.reviewOpen || 0}
          </button>
          <button
            className={`ops-btn ${status === 'all' ? 'primary' : ''}`}
            onClick={() => {
              setStatus('all');
              void load('all');
            }}
          >
            全部
          </button>
          <Link className="ops-btn" href="/sync">
            同步控制台
          </Link>
          <Link className="ops-btn subtle" href="/">
            返回知识库
          </Link>
        </div>
      </header>

      {error ? <div className="ops-alert">{error}</div> : null}

      <section className="review-list">
        {items.map((item) => {
          const payload = prettyPayload(item.payload_json);
          const busy = busyId === item.id;
          return (
            <article className="review-item" key={item.id}>
              <div className="review-main">
                <div className="review-meta">
                  <span className="ops-badge tone-neutral">{item.kind}</span>
                  <span className="ops-badge tone-warn">{item.status}</span>
                  {typeof item.confidence === 'number' ? (
                    <span>置信度 {item.confidence.toFixed(2)}</span>
                  ) : null}
                </div>
                <h2>{item.title}</h2>
                <p>
                  target={item.target_type || '-'}:{item.target_id || '-'} · source=
                  {item.source_id || '-'} · {fmtDate(item.created_at)}
                </p>
              </div>

              {item.status === 'open' ? (
                <div className="review-actions">
                  <button
                    className="ops-btn good"
                    disabled={busy}
                    onClick={() => void resolve(item.id, 'approved')}
                  >
                    批准
                  </button>
                  <button
                    className="ops-btn danger"
                    disabled={busy}
                    onClick={() => void resolve(item.id, 'rejected')}
                  >
                    拒绝
                  </button>
                  <button
                    className="ops-btn"
                    disabled={busy}
                    onClick={() => void resolve(item.id, 'resolved')}
                  >
                    标记已处理
                  </button>
                </div>
              ) : null}

              {payload ? <pre className="review-payload">{payload}</pre> : null}
            </article>
          );
        })}

        {items.length === 0 ? <div className="ops-panel ops-empty-panel">暂无审核项。</div> : null}
      </section>
    </main>
  );
}
