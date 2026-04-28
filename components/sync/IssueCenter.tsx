'use client';

import { useState } from 'react';
import { fmtDate, type ErrorGroup } from './types';

interface Props {
  groups: ErrorGroup[];
  busy: boolean;
  onRetryAll: () => void;
  onRetryItem: (itemId: string) => void;
  onOpenAdvanced: () => void;
}

const CATEGORY_LABEL: Record<ErrorGroup['category'], string> = {
  timeout: '网络超时',
  github: 'GitHub 404',
  auth: '认证失败',
  rate: '限流',
  gateway: 'LLM 网关异常',
  parse: '内部解析错误',
  unknown: '未识别',
};

/**
 * Promoted from "tab inside tabs" to a top-level section so the user
 * sees actionable errors immediately. Hidden when there are no errors.
 */
export default function IssueCenter({
  groups,
  busy,
  onRetryAll,
  onRetryItem,
  onOpenAdvanced,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (groups.length === 0) return null;

  return (
    <section className="sync-v2-issues" aria-label="问题中心">
      <header className="sync-v2-section-head">
        <h2>问题中心 · {groups.length} 类</h2>
        <button type="button" className="sync-v2-link" onClick={onOpenAdvanced}>
          全部活动
        </button>
      </header>
      <div className="sync-v2-issue-list">
        {groups.map((group) => {
          const key = `${group.fingerprint}::${group.stage ?? ''}`;
          const isOpen = !!expanded[key];
          return (
            <article key={key} className={`sync-v2-issue cat-${group.category}`}>
              <div className="sync-v2-issue-head">
                <div className="sync-v2-issue-title">
                  <span className={`sync-v2-issue-tag cat-${group.category}`}>
                    {CATEGORY_LABEL[group.category]}
                  </span>
                  <strong>{group.count} 个文件</strong>
                  <span className="sync-v2-issue-when">最近 {fmtDate(group.lastAt)}</span>
                  {group.stage ? <span className="sync-v2-issue-stage">{group.stage}</span> : null}
                </div>
                <div className="sync-v2-issue-actions">
                  <button
                    type="button"
                    className="sync-v2-btn sync-v2-btn-tiny"
                    disabled={busy}
                    onClick={onRetryAll}
                  >
                    重试这一类
                  </button>
                  <button
                    type="button"
                    className="sync-v2-btn sync-v2-btn-tiny sync-v2-btn-ghost"
                    onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? '收起' : `查看 ${group.examples.length} 条`}
                  </button>
                </div>
              </div>
              <p className="sync-v2-issue-message" title={group.message}>
                {group.message}
              </p>
              <p className="sync-v2-issue-suggest">建议：{group.suggestion}</p>
              {isOpen ? (
                <ul className="sync-v2-issue-examples">
                  {group.examples.map((ex) => (
                    <li key={ex.itemId}>
                      <code title={ex.path}>{ex.path}</code>
                      <button
                        type="button"
                        className="sync-v2-btn sync-v2-btn-tiny"
                        disabled={busy}
                        onClick={() => onRetryItem(ex.itemId)}
                      >
                        重试此文件
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
