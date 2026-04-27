'use client';

import { useState } from 'react';
import { fmtDate, type ErrorGroup } from './types';

interface Props {
  groups: ErrorGroup[];
  onRetryAll?: () => void;
  onRetryItem?: (itemId: string) => void;
  busy?: boolean;
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

export default function ErrorGroups({ groups, onRetryAll, onRetryItem, busy }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (groups.length === 0) {
    return <p className="ops-empty">暂无错误。</p>;
  }

  return (
    <div className="ops-error-groups">
      {groups.map((group) => {
        const key = `${group.fingerprint}::${group.stage ?? ''}`;
        const isOpen = expanded[key];
        return (
          <article key={key} className={`ops-error-group cat-${group.category}`}>
            <header>
              <div className="ops-error-group-title">
                <span className={`ops-error-cat cat-${group.category}`}>
                  {CATEGORY_LABEL[group.category]}
                </span>
                <strong>{group.count} 个文件</strong>
                <span className="ops-error-group-when">最近 {fmtDate(group.lastAt)}</span>
                {group.stage ? <span className="ops-error-group-stage">{group.stage}</span> : null}
              </div>
              <div className="ops-error-group-actions">
                {onRetryAll ? (
                  <button
                    type="button"
                    className="ops-btn ops-btn-tiny"
                    disabled={busy}
                    onClick={onRetryAll}
                  >
                    重试这一类
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ops-btn ops-btn-tiny subtle"
                  onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}
                  aria-expanded={isOpen}
                >
                  {isOpen ? '收起' : `展开 ${group.examples.length} 条`}
                </button>
              </div>
            </header>
            <p className="ops-error-group-message" title={group.message}>
              {group.message}
            </p>
            <p className="ops-error-group-suggest">建议：{group.suggestion}</p>
            {isOpen ? (
              <ul className="ops-error-group-examples">
                {group.examples.map((ex) => (
                  <li key={ex.itemId}>
                    <code title={ex.path}>{ex.path}</code>
                    {onRetryItem ? (
                      <button
                        type="button"
                        className="ops-btn ops-btn-tiny"
                        disabled={busy}
                        onClick={() => onRetryItem(ex.itemId)}
                      >
                        重试此文件
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
