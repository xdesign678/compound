'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAdminAuthHeaders } from '@/lib/admin-auth-client';
import { withRequestId } from '@/lib/trace-client';

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

type Severity = 'info' | 'warn' | 'danger';

type Friendly = {
  kindLabel: string;
  severity: Severity;
  headline: string;
  why: string;
  facts: { label: string; value: string }[];
  decision: string;
};

function fmtDate(value: number) {
  return new Date(value).toLocaleString();
}

function safeParse(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function prettyPayload(value: string | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function statusLabel(status: string): { text: string; tone: 'warn' | 'good' | 'bad' | 'neutral' } {
  switch (status) {
    case 'open':
      return { text: '待审核', tone: 'warn' };
    case 'approved':
      return { text: '已批准', tone: 'good' };
    case 'rejected':
      return { text: '已拒绝', tone: 'bad' };
    case 'resolved':
      return { text: '已处理', tone: 'neutral' };
    default:
      return { text: status, tone: 'neutral' };
  }
}

function describeReviewItem(item: ReviewItem): Friendly {
  const payload = safeParse(item.payload_json) as Record<string, unknown> | null;

  switch (item.kind) {
    case 'large_ingest_change': {
      const path = (payload?.path as string) || item.target_id || '';
      const newIds = Array.isArray(payload?.newConceptIds)
        ? (payload!.newConceptIds as string[])
        : [];
      const updIds = Array.isArray(payload?.updatedConceptIds)
        ? (payload!.updatedConceptIds as string[])
        : [];
      const total = newIds.length + updIds.length;
      return {
        kindLabel: '大批量概念变更',
        severity: 'warn',
        headline: `《${basename(path) || '未命名文档'}》一次入库改动了 ${total} 个概念`,
        why: `这篇文档在最近一次入库时，新增了 ${newIds.length} 个概念，更新了 ${updIds.length} 个概念，超过了系统设定的阈值（默认 8 个）。变更可能来自重要更新，也可能是误改或抓取异常，请确认是否符合预期。`,
        facts: [
          { label: '文档路径', value: path || '—' },
          { label: '新增概念', value: `${newIds.length} 个` },
          { label: '更新概念', value: `${updIds.length} 个` },
          { label: '入库时间', value: fmtDate(item.created_at) },
        ],
        decision:
          '批准 = 我已核对，这批改动没问题；拒绝 = 这批改动有问题（仅记入审计，不会自动回滚）；稍后 = 暂时跳过。',
      };
    }
    case 'low_confidence_summary': {
      const conf = item.confidence;
      return {
        kindLabel: '低置信度分析',
        severity: 'warn',
        headline: `《${item.title.replace(/^.*：/, '') || '未命名文档'}》的 AI 分析结果不太确定`,
        why: `模型在分析这篇文档时，整体置信度只有 ${conf != null ? conf.toFixed(2) : '未知'}（低于阈值 0.62）。可能是文档结构特殊、内容偏短，或者抽取出的概念/实体不够清晰。建议你打开原文核对一下抽取结果。`,
        facts: [
          { label: '关联文档', value: item.target_id || '—' },
          { label: '置信度', value: conf != null ? conf.toFixed(2) : '未知' },
          { label: '检测时间', value: fmtDate(item.created_at) },
        ],
        decision: '批准 = 抽取结果可接受；拒绝 = 不可用，需要人工重写；稍后 = 暂时跳过。',
      };
    }
    case 'concept_merge_candidate': {
      return {
        kindLabel: '疑似重复概念',
        severity: 'info',
        headline: '系统发现两个概念可能是同一件事',
        why: '基于标题与内容相似度，下面这组概念被判定为可能重复。合并后会保留一个、删除另一个并迁移引用，请你确认是否真的应该合并。',
        facts: [
          { label: '候选目标', value: item.target_id || '—' },
          { label: '检测时间', value: fmtDate(item.created_at) },
        ],
        decision: '批准 = 确认合并；拒绝 = 它们不是一回事；稍后 = 暂时跳过。',
      };
    }
    case 'relation_suggestion': {
      return {
        kindLabel: '关系建议',
        severity: 'info',
        headline: '系统建议在两个概念之间建立关联',
        why: '模型在阅读相关材料时发现这两个概念可能存在关联（包含 / 等价 / 相关）。批准后会写入概念图谱。',
        facts: [
          { label: '候选目标', value: item.target_id || '—' },
          { label: '检测时间', value: fmtDate(item.created_at) },
        ],
        decision: '批准 = 建立关联；拒绝 = 不应建立；稍后 = 暂时跳过。',
      };
    }
    case 'conflict': {
      return {
        kindLabel: '同步冲突',
        severity: 'danger',
        headline: '本地与远端版本出现冲突',
        why: '同一份资源在本地和远端出现了不一致的写入。系统不会替你做选择，请你先对照下方原始数据，再决定保留哪一边。',
        facts: [
          { label: '冲突对象', value: `${item.target_type || '—'}:${item.target_id || '—'}` },
          { label: '检测时间', value: fmtDate(item.created_at) },
        ],
        decision: '批准 = 采纳本次写入；拒绝 = 放弃本次写入；稍后 = 暂时挂起。',
      };
    }
    case 'manual': {
      return {
        kindLabel: '人工标记',
        severity: 'info',
        headline: item.title || '人工添加的审核项',
        why: '这是被手动加入审核队列的条目，没有自动化判定逻辑。请按下方原始数据进行判断。',
        facts: [
          { label: '关联对象', value: `${item.target_type || '—'}:${item.target_id || '—'}` },
          { label: '加入时间', value: fmtDate(item.created_at) },
        ],
        decision: '按你的判断处理即可。',
      };
    }
    default:
      return {
        kindLabel: item.kind,
        severity: 'info',
        headline: item.title,
        why: '系统未对这个类型提供说明。请展开下方原始数据自行判断。',
        facts: [
          { label: '关联对象', value: `${item.target_type || '—'}:${item.target_id || '—'}` },
          { label: '加入时间', value: fmtDate(item.created_at) },
        ],
        decision: '按你的判断处理即可。',
      };
  }
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: withRequestId({ ...getAdminAuthHeaders(), 'Content-Type': 'application/json' }),
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
          headers: withRequestId(getAdminAuthHeaders()),
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
          <p>
            系统遇到不太放心的自动化变更（大批量入库、低置信度抽取、同步冲突等）时，会先丢到这里等你拍板。
          </p>
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
          const friendly = describeReviewItem(item);
          const payload = prettyPayload(item.payload_json);
          const busy = busyId === item.id;
          const st = statusLabel(item.status);
          return (
            <article className={`review-card severity-${friendly.severity}`} key={item.id}>
              <div className="review-card-head">
                <span className="review-kind-tag">{friendly.kindLabel}</span>
                <span className={`ops-badge tone-${st.tone}`}>{st.text}</span>
                {typeof item.confidence === 'number' ? (
                  <span className="review-conf">置信度 {item.confidence.toFixed(2)}</span>
                ) : null}
              </div>

              <h2 className="review-headline">{friendly.headline}</h2>
              <p className="review-why">{friendly.why}</p>

              <dl className="review-facts">
                {friendly.facts.map((f) => (
                  <div className="review-fact" key={f.label}>
                    <dt>{f.label}</dt>
                    <dd title={f.value}>{f.value}</dd>
                  </div>
                ))}
              </dl>

              {item.status === 'open' ? (
                <>
                  <div className="review-decision">
                    <span className="review-decision-label">需要你的决定</span>
                    <span>{friendly.decision}</span>
                  </div>
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
                      className="ops-btn subtle"
                      disabled={busy}
                      onClick={() => void resolve(item.id, 'resolved')}
                    >
                      稍后再说
                    </button>
                  </div>
                </>
              ) : null}

              {payload ? (
                <details className="review-raw">
                  <summary>查看原始数据</summary>
                  <pre>{payload}</pre>
                </details>
              ) : null}
            </article>
          );
        })}

        {items.length === 0 ? (
          <div className="ops-panel ops-empty-panel">
            <p>当前没有待审核的条目。系统认为最近的自动化变更都在阈值范围内。</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
