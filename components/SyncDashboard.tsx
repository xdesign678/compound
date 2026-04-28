'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAdminAuthHeaders } from '@/lib/admin-auth-client';
import { withRequestId } from '@/lib/trace-client';
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
  const res = await fetch(path, {
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
      const res = await fetch('/api/sync/dashboard', {
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

  const story = dashboard?.story ?? null;
  const run = dashboard?.activeRun ?? dashboard?.latestRuns?.[0] ?? null;
  const reviewOpenRaw = dashboard?.coverage?.reviewOpen;
  const reviewOpen = typeof reviewOpenRaw === 'number' ? reviewOpenRaw : 0;
  const errorGroups = dashboard?.errorGroups ?? [];
  const phases = story?.phases ?? null;
  const health = story?.health ?? null;
  const stalled = dashboard?.health?.stalled ?? false;
  const stalledFor = dashboard?.health?.stalledFor ?? 0;

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
          router.push('/settings');
          return;
        case 'open-env':
          toast.push(
            'info',
            '环境变量自查',
            '查 COMPOUND_LLM_TIMEOUT_MS / LLM_MODEL / LLM_API_KEY；详细参考 .env.example。',
          );
          return;
        case 'skip-failed':
          void runAction(
            'skip-failed',
            '跳过失败文件',
            () => postJson('/api/sync/cancel', { skipFailed: true }),
            '已把失败文件标记为永久失败，跳过后续重试',
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

  return (
    <main className="sync-v2-page">
      <div className="sync-v2-topnav">
        <div className="sync-v2-topnav-left">
          <span className="sync-v2-kicker">Compound · 同步控制台</span>
        </div>
        <div className="sync-v2-topnav-right">
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

      {loadError ? <div className="sync-v2-alert">{loadError}</div> : null}
      {stalled ? (
        <div className="sync-v2-alert sync-v2-alert-warn">
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

      <HealthLine health={health} reviewOpen={reviewOpen} onOpenReview={handleOpenReview} />

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
