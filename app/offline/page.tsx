'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Database, FileText, RefreshCcw, WifiOff } from 'lucide-react';
import { getDb } from '@/lib/db';
import './offline.css';

interface OfflineCounts {
  sources: number;
  concepts: number;
}

export default function OfflinePage() {
  const [counts, setCounts] = useState<OfflineCounts | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCounts() {
      try {
        const db = getDb();
        const [sources, concepts] = await Promise.all([db.sources.count(), db.concepts.count()]);
        if (!cancelled) setCounts({ sources, concepts });
      } catch {
        if (!cancelled) setCounts({ sources: 0, concepts: 0 });
      }
    }

    void loadCounts();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <main className="offline-page">
      <section className="offline-state" aria-labelledby="offline-title">
        <div className="offline-status-mark" aria-hidden="true">
          <WifiOff size={28} strokeWidth={1.8} />
        </div>

        <p className="offline-kicker">本地可读</p>
        <h1 id="offline-title">离线模式</h1>
        <p className="offline-copy">
          当前无法连接网络。你仍然可以查看已缓存的知识库内容；摄入、修复和归类会在恢复连接后继续可用。
        </p>

        <section className="offline-counts" aria-label="本地缓存概览">
          <div className="offline-count">
            <Database size={18} aria-hidden="true" />
            <span>已缓存资料</span>
            <strong>{counts ? counts.sources : '...'}</strong>
          </div>
          <div className="offline-count">
            <FileText size={18} aria-hidden="true" />
            <span>可读概念</span>
            <strong>{counts ? counts.concepts : '...'}</strong>
          </div>
        </section>

        <div className="offline-actions">
          <button className="offline-primary-action" type="button" onClick={handleRetry}>
            <RefreshCcw size={16} aria-hidden="true" />
            重试连接
          </button>
          <Link className="offline-secondary-action" href="/" aria-label="返回知识库首页">
            <BookOpen size={16} aria-hidden="true" />
            返回知识库
          </Link>
        </div>
      </section>
    </main>
  );
}
