'use client';

import { asNumber } from './types';

interface Props {
  coverage: Record<string, number | string | boolean>;
}

interface Row {
  label: string;
  value: number;
  total: number;
  hint?: string;
}

/**
 * Replaces the flat KV grid with a "ratio against denominator" view. The eye
 * immediately notices the partial bar and how many records still need work.
 */
export default function CoverageBars({ coverage }: Props) {
  const sources = asNumber(coverage.sources);
  const githubSources = asNumber(coverage.githubSources);
  const activeFiles = asNumber(coverage.activeSourceFiles);
  const sourceChunks = asNumber(coverage.sourceChunks);
  const ftsRows = asNumber(coverage.chunkFtsRows);
  const embeddings = asNumber(coverage.chunkEmbeddings);
  const evidence = asNumber(coverage.conceptEvidence);
  const concepts = asNumber(coverage.concepts);
  const modelRuns = asNumber(coverage.modelRuns);

  const rows: Row[] = [
    { label: '活跃文件', value: activeFiles, total: githubSources || sources || activeFiles },
    { label: '原文分块', value: sourceChunks, total: Math.max(sourceChunks, 1), hint: '总分块' },
    { label: '全文索引 (FTS)', value: ftsRows, total: sourceChunks || ftsRows },
    { label: '向量索引', value: embeddings, total: sourceChunks || embeddings },
    { label: '概念证据链', value: evidence, total: Math.max(concepts, evidence) },
    { label: '模型调用历史', value: modelRuns, total: Math.max(modelRuns, 1), hint: '累计' },
  ];

  return (
    <ul className="ops-coverage-list">
      {rows.map((row) => {
        const total = Math.max(row.total, 0);
        const value = Math.max(0, Math.min(row.value, total || row.value));
        const pct = total > 0 ? Math.round((value / total) * 100) : 0;
        const isFull = total > 0 && value >= total;
        const tone = total === 0 ? 'empty' : isFull ? 'full' : value === 0 ? 'none' : 'partial';
        return (
          <li key={row.label} className={`ops-coverage-row tone-${tone}`}>
            <div className="ops-coverage-row-head">
              <span className="ops-coverage-row-label">{row.label}</span>
              <span className="ops-coverage-row-value">
                {value} {total > 0 ? `/ ${total}` : ''}
                <em>{pct}%</em>
              </span>
            </div>
            <div className="ops-coverage-row-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            {row.hint ? <small>{row.hint}</small> : null}
          </li>
        );
      })}
      <li className="ops-coverage-row tone-flag">
        <div className="ops-coverage-row-head">
          <span className="ops-coverage-row-label">FTS 状态</span>
          <span className="ops-coverage-row-value">{coverage.ftsReady ? '就绪 ✓' : '关闭'}</span>
        </div>
      </li>
    </ul>
  );
}
