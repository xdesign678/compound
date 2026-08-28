'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAdminAuthHeaders } from '@/lib/admin-auth-client';
import { fetchCompoundPrivateApi } from '@/lib/auth-response-guard';
import { withRequestId } from '@/lib/trace-client';
import { friendlyErrorMessage, useAppStore } from '@/lib/store';
import HeroStatus from './sync/HeroStatus';
import PhaseTimeline from './sync/PhaseTimeline';
import ActiveFilesList from './sync/ActiveFilesList';
import IssueCenter from './sync/IssueCenter';
import HealthLine from './sync/HealthLine';
import AdvancedDrawer from './sync/AdvancedDrawer';
import SyncDiagnosticsBanner from './sync/SyncDiagnosticsBanner';
import { ToastProvider, useToast } from './sync/Toast';
import { fmtDuration, type Dashboard, type DiagnosticActionId } from './sync/types';

const POLL_RUNNING_MS = 2_000;
const POLL_IDLE_MS = 10_000;

type ApiResult = { message?: string; error?: string } & Record<string, unknown>;

async function postJson(path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetchCompoundPrivateApi(path, {
    method: 'POST',
    headers: withRequestId({ ...getAdminAuthHeaders(), 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as ApiResult | null;
  if (!res.ok) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json ?? {};
}

function DashboardInner() {
  const toast = useToast();
  const router = useRouter();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [paused, setPaused] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchCompoundPrivateApi('/api/sync/dashboard', {
        headers: withRequestId(getAdminAuthHeaders()),
        cache: 'no-store',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as ApiResult | null;
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setDashboard((await res.json()) as Dashboard);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const runAction = useCallback(
    async (
      label: string,
      title: string,
      fn: () => Promise<ApiResult>,
      successFallback?: string,
    ) => {
      setBusy(label);
      try {
        const result = await fn();
        await load();
        const message = result.message || successFallback || `${title}已完成`;
        toast.push('success', title, message);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.push('error', `${title}失败`, message);
      } finally {
        setBusy('');
      }
    },
    [load, toast],
  );

  useEffect(() => {
    if (paused) return;
    void load();
    const isRunning = dashboard?.activeRun?.status === 'running';
    const interval = isRunning ? POLL_RUNNING_MS : POLL_IDLE_MS;
    const timer = window.setInterval(() => void load(), interval);
    return () => window.clearInterval(timer);
  }, [load, paused, dashboard?.activeRun?.status]);

  // Auto-pause polling when the tab is hidden to avoid wasted requests.
  // 区分自动暂停与手动暂停：只有自动暂停的才在回到前台时恢复；
  // 之前只要切到后台就永久暂停且主界面无提示，仪表盘静默冻结。
  const autoPausedRef = useRef(false);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        if (!paused) {
          autoPausedRef.current = true;
          setPaused(true);
        }
      } else if (autoPausedRef.current) {
        autoPausedRef.current = false;
        setPaused(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [paused]);

  const story = dashboard?.story ?? null;
  const run = dashboard?.activeRun ?? dashboard?.latestRuns?.[0] ?? null;
  const reviewOpenRaw = dashboard?.coverage?.reviewOpen;
  const reviewOpen = typeof reviewOpenRaw === 'number' ? reviewOpenRaw : 0;
  const errorGroups = dashboard?.errorGroups ?? [];
  const phases = story?.phases ?? null;
  const health = story?.health ?? null;
  const stalled = dashboard?.health?.stalled ?? false;
  const stalledFor = dashboard?.health?.stalledFor ?? 0;
  const deadLetters = dashboard?.dlq?.count ?? 0;

  const handlePrimary = useCallback(() => {
    const action = story?.narrative?.nextAction ?? 'sync';
    if (action === 'review') {
      router.push('/review');
      return;
    }
    if (action === 'cancel') {
      void runAction('cancel', '取消运行', () => postJson('/api/sync/cancel'));
      return;
    }
    void runAction('sync', '立即同步', () => postJson('/api/sync/run'));
  }, [router, runAction, story?.narrative?.nextAction]);

  const handleCancel = useCallback(() => {
    void runAction('cancel', '取消运行', () => postJson('/api/sync/cancel'));
  }, [runAction]);

  const handleRetryItem = useCallback(
    (itemId: string) => {
      void runAction(
        `retry-${itemId}`,
        '重试此文件',
        () => postJson('/api/sync/retry', { runId: run?.id, itemId }),
        '已重新加入分析队列',
      );
    },
    [runAction, run?.id],
  );

  const handleRetryAll = useCallback(() => {
    void runAction('retry-all', '重试失败', () => postJson('/api/sync/retry', { runId: run?.id }));
  }, [runAction, run?.id]);

  const handleRetryDeadLetter = useCallback(
    (jobId: string) => {
      void runAction(
        `dlq-retry-${jobId}`,
        '重试死信',
        () => postJson('/api/sync/dlq', { action: 'retry', jobId }),
        '已重新加入分析队列',
      );
    },
    [runAction],
  );

  const handleDeleteDeadLetter = useCallback(
    (jobId: string) => {
      void runAction(
        `dlq-delete-${jobId}`,
        '删除死信',
        () => postJson('/api/sync/dlq', { action: 'delete', jobId }),
        '已删除死信任务',
      );
    },
    [runAction],
  );

  const handleRunWorker = useCallback(() => {
    void runAction('worker', '跑分析', () => postJson('/api/sync/worker'));
  }, [runAction]);

  const handleOpenReview = useCallback(() => {
    router.push('/review');
  }, [router]);

  const handleDiagnosticAction = useCallback(
    (id: DiagnosticActionId, _diagnosticId: string) => {
      switch (id) {
        case 'switch-fast-model':
          toast.push(
            'info',
            '切换主模型',
            '在 Settings 选一个更快的主模型；gateway 会按 COMPOUND_LLM_FALLBACK_MODELS 列表顺序自动轮询，连续撞墙的模型会被自动跳过。',
          );
          // 设置是主页的抽屉（不存在 /settings 路由），回主页后通过 store 打开
          useAppStore.getState().openSettings();
          router.push('/');
          return;
        case 'open-env':
          toast.push(
            'info',
            '环境变量自查',
            '查 COMPOUND_LLM_TIMEOUT_MS / LLM_MODEL / LLM_API_KEY；详细参考 .env.example。',
          );
          return;
        case 'retry-all':
          void runAction('retry-all', '全部重试', () =>
            postJson('/api/sync/retry', { runId: run?.id }),
          );
          return;
        case 'open-runbook':
          // href links handle this case; fallthrough is fine
          return;
        default:
          return;
      }
    },
    [router, runAction, run?.id, toast],
  );

  const isAuthError = loadError.includes('401') || loadError.toLowerCase().includes('unauthorized');
  // 首次加载就失败（没有任何数据）时只显示错误卡：此时 HeroStatus / 空态
  // 列表里的 CTA 点了也只会再次失败，与错误语义自相矛盾。已有数据时的
  // 轮询失败仍保留旧数据，仅顶部出错误卡。
  const showBlockingError = Boolean(loadError) && !dashboard;

  return (
    <main className="sync-v2-page">
      <div className="sync-v2-topnav">
        <div className="sync-v2-topnav-left">
          <span className="sync-v2-kicker">Compound · 同步控制台</span>
        </div>
        <div className="sync-v2-topnav-right">
          {paused && (
            <button
              type="button"
              className="sync-v2-btn sync-v2-btn-ghost sync-v2-paused-chip"
              onClick={() => setPaused(false)}
              title="轮询已暂停（页面曾切到后台），点击恢复实时刷新"
            >
              已暂停轮询 · 点击恢复
            </button>
          )}
          <button
            type="button"
            className="sync-v2-btn sync-v2-btn-ghost"
            onClick={() => setDrawerOpen(true)}
            title="底层操作 / 完整文件表 / 事件流"
            aria-label="打开高级抽屉"
          >
            高级
          </button>
          <Link href="/" className="sync-v2-btn sync-v2-btn-ghost">
            返回主页
          </Link>
        </div>
      </div>

      {loadError ? (
        <div role="alert" className="sync-v2-error">
          <div className="sync-v2-error-body">
            <h3 className="sync-v2-error-title">
              {isAuthError
                ? '需要认证'
                : loadError.includes('403')
                  ? '权限不足'
                  : loadError.includes('500')
                    ? '服务器出了点问题'
                    : '无法加载同步面板'}
            </h3>
            <p className="sync-v2-error-copy">
              {isAuthError
                ? '访问保护认证失败。请回到主页，在「设置 → 模型 → 访问保护」中重新保存 Admin Token，然后回到本页重试。'
                : friendlyErrorMessage(loadError)}
            </p>
            <div className="sync-v2-error-actions">
              <button type="button" className="sync-v2-btn" onClick={() => void load()}>
                重试
              </button>
              <Link href="/" className="sync-v2-btn sync-v2-btn-ghost">
                返回首页
              </Link>
            </div>
            <details className="sync-v2-error-details">
              <summary>技术详情</summary>
              <pre>{loadError}</pre>
            </details>
          </div>
        </div>
      ) : null}

      {!dashboard && !loadError ? (
        <div role="status" aria-live="polite" className="sync-v2-loading">
          <div aria-hidden="true" className="sync-v2-loading-spinner" />
          <p>加载同步状态…</p>
        </div>
      ) : null}

      {!showBlockingError ? (
        <>
          {stalled ? (
            <div className="sync-v2-alert sync-v2-alert-warn" role="status">
              运行已停滞 {fmtDuration(stalledFor)}。点「立即同步」唤醒 worker，或检查上游 LLM 服务。
            </div>
          ) : null}

          <SyncDiagnosticsBanner
            diagnostics={story?.diagnostics ?? []}
            busy={Boolean(busy)}
            onAction={handleDiagnosticAction}
          />

          <HeroStatus
            story={story}
            run={run}
            busy={Boolean(busy)}
            reviewOpen={reviewOpen}
            onPrimary={handlePrimary}
            onCancel={handleCancel}
            onOpenReview={handleOpenReview}
          />

          <PhaseTimeline phases={phases} />

          <ActiveFilesList
            items={dashboard?.activeItems ?? []}
            hasRunHistory={(dashboard?.latestRuns?.length ?? 0) > 0}
            busy={Boolean(busy)}
            onRetryItem={handleRetryItem}
            onOpenAdvanced={() => setDrawerOpen(true)}
          />

          <IssueCenter
            groups={errorGroups}
            busy={Boolean(busy)}
            onRetryAll={handleRetryAll}
            onRetryItem={handleRetryItem}
            onOpenAdvanced={() => setDrawerOpen(true)}
          />

          <HealthLine
            health={health}
            reviewOpen={reviewOpen}
            deadLetters={deadLetters}
            onOpenReview={handleOpenReview}
          />
        </>
      ) : null}

      <AdvancedDrawer
        open={drawerOpen}
        busy={Boolean(busy)}
        paused={paused}
        dashboard={dashboard}
        onClose={() => setDrawerOpen(false)}
        onRetryItem={handleRetryItem}
        onTogglePaused={() => setPaused((v) => !v)}
        onRunWorker={handleRunWorker}
        onCancel={handleCancel}
        onRetryAll={handleRetryAll}
        onRetryDeadLetter={handleRetryDeadLetter}
        onDeleteDeadLetter={handleDeleteDeadLetter}
      />
    </main>
  );
}

export default function SyncDashboard() {
  return (
    <ToastProvider>
      <DashboardInner />
    </ToastProvider>
  );
}
