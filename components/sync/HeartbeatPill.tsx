'use client';

import { useEffect, useState } from 'react';
import { fmtDuration, type RunHealth, type SyncRun } from './types';

interface HeartbeatPillProps {
  run: SyncRun | null;
  health: RunHealth | undefined;
}

/**
 * Live "still alive?" indicator. We update once a second from the local clock
 * so the user sees the heartbeat age tick even between dashboard polls. When
 * `health.stalled` is true (heartbeat older than 60s on a running job) we
 * pulse the pill in red.
 */
export default function HeartbeatPill({ run, health }: HeartbeatPillProps) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!run) {
    return (
      <span className="ops-heartbeat tone-idle" aria-label="空闲">
        <span className="ops-heartbeat-dot" />
        空闲
      </span>
    );
  }

  const isRunning = run.status === 'running';
  const heartbeatAt = health?.heartbeatAt ?? run.heartbeat_at ?? null;
  const liveAge =
    heartbeatAt != null ? Math.max(0, Date.now() - heartbeatAt) : (health?.heartbeatAgeMs ?? null);
  const stalled = isRunning && liveAge != null && liveAge > 60_000;
  const tone = stalled
    ? 'stalled'
    : isRunning
      ? 'live'
      : run.status === 'failed'
        ? 'error'
        : 'done';
  const label = stalled
    ? `已停滞 ${fmtDuration(liveAge)}`
    : isRunning
      ? liveAge != null
        ? `心跳 ${fmtDuration(liveAge)} 前`
        : '运行中'
      : run.status === 'failed'
        ? '失败'
        : run.status === 'cancelled'
          ? '已取消'
          : '完成';

  // tick reference forces rerender for the live age clock
  void tick;

  return (
    <span className={`ops-heartbeat tone-${tone}`} aria-label={label}>
      <span className="ops-heartbeat-dot" />
      {label}
    </span>
  );
}
