'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Database, FileText, LockKeyhole, RefreshCcw, WifiOff } from 'lucide-react';
import { canReadPrivateCache, checkAdminSession, saveAdminToken } from '@/lib/admin-auth-client';
import { getDb } from '@/lib/db';
import './offline.css';

interface OfflineCounts {
  sources: number;
  concepts: number;
}

export default function OfflinePage() {
  const [accessAllowed, setAccessAllowed] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<OfflineCounts | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState('');
  const [adminToken, setAdminToken] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadCounts() {
      try {
        const allowed = await canReadPrivateCache();
        if (cancelled) return;
        setAccessAllowed(allowed);
        if (!allowed) return;

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

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryMessage('正在检查连接…');
    try {
      const authenticated = await checkAdminSession();
      if (authenticated === false) {
        setAccessAllowed(false);
        setRetryMessage('连接已恢复，但访问会话已失效。请重新登录。');
        setRetrying(false);
        return;
      }
      if (authenticated === null) throw new Error('offline');
      setRetryMessage('连接已恢复，正在返回知识库。');
      window.location.assign('/');
    } catch {
      setRetryMessage('仍然无法连接。你可以继续阅读本地缓存内容。');
      setRetrying(false);
    }
  };

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (retrying) return;
    setRetrying(true);
    setRetryMessage('正在验证访问密钥…');
    try {
      await saveAdminToken(adminToken);
      setRetryMessage('验证成功，正在返回知识库。');
      window.location.assign('/');
    } catch (error) {
      setRetryMessage(error instanceof Error ? error.message : '登录失败，请重试。');
      setRetrying(false);
    }
  };

  const locked = accessAllowed === false;

  return (
    <main className="offline-page">
      <section className="offline-state" aria-labelledby="offline-title">
        <div className="offline-status-mark" aria-hidden="true">
          {locked ? (
            <LockKeyhole size={28} strokeWidth={1.8} />
          ) : (
            <WifiOff size={28} strokeWidth={1.8} />
          )}
        </div>

        <p className="offline-kicker">{locked ? '访问已锁定' : '本地可读'}</p>
        <h1 id="offline-title">{locked ? '本地缓存已锁定' : '离线模式'}</h1>
        <p className="offline-copy">
          {locked
            ? '此设备已退出访问保护，缓存内容不会显示。请联网并重新登录；也可以在彻底退出时清除此设备缓存。'
            : '当前无法连接网络。你仍然可以查看已缓存的知识库内容；摄入、修复和归类会在恢复连接后继续可用。'}
        </p>

        {!locked ? (
          <section
            className="offline-counts"
            aria-label="本地缓存概览"
            aria-busy={counts === null}
            aria-live="polite"
          >
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
        ) : (
          <form className="offline-login" onSubmit={(event) => void handleLogin(event)}>
            <label htmlFor="offline-admin-token">访问保护密钥</label>
            <input
              id="offline-admin-token"
              type="password"
              value={adminToken}
              onChange={(event) => setAdminToken(event.target.value)}
              autoComplete="current-password"
              required
            />
            <button className="offline-primary-action" type="submit" disabled={retrying}>
              {retrying ? '验证中…' : '重新登录'}
            </button>
          </form>
        )}

        {!locked ? (
          <div className="offline-actions">
            <button
              className="offline-primary-action"
              type="button"
              onClick={() => void handleRetry()}
              disabled={retrying}
              aria-describedby={retryMessage ? 'offline-retry-status' : undefined}
            >
              <RefreshCcw
                className={retrying ? 'offline-action-spin' : undefined}
                size={16}
                aria-hidden="true"
              />
              {retrying ? '检查中' : '重试连接'}
            </button>
            <Link className="offline-secondary-action" href="/" aria-label="返回知识库首页">
              <BookOpen size={16} aria-hidden="true" />
              返回知识库
            </Link>
          </div>
        ) : null}

        {retryMessage ? (
          <p className="offline-retry-status" id="offline-retry-status" role="status">
            {retryMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
