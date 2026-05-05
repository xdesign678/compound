'use client';

import { useState } from 'react';
import { useAppStore, type TaskItem, type TaskStatus, type TaskKind } from '@/lib/store';
import { Icon } from './Icons';

const TASK_KIND_LABEL: Record<TaskKind, string> = {
  ingest: '摄入',
  lint: '体检',
  repair: '修复',
  categorize: '归类',
  query: '问答',
};

const TASK_KIND_ICON: Record<TaskKind, React.ReactNode> = {
  ingest: <Icon.Ingest />,
  lint: <Icon.Lint />,
  repair: <Icon.Refresh />,
  categorize: <Icon.Wiki />,
  query: <Icon.Ask />,
};

function statusBadge(status: TaskStatus) {
  switch (status) {
    case 'running':
      return <span className="tc-badge tc-badge-running">进行中</span>;
    case 'success':
      return <span className="tc-badge tc-badge-success">完成</span>;
    case 'error':
      return <span className="tc-badge tc-badge-error">失败</span>;
  }
}

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  return `${Math.floor(diff / 3600000)}小时前`;
}

export function TaskCenter() {
  const tasks = useAppStore((s) => s.tasks);
  const open = useAppStore((s) => s.taskCenterOpen);
  const toggleTaskCenter = useAppStore((s) => s.toggleTaskCenter);
  const updateTask = useAppStore((s) => s.updateTask);
  const removeTask = useAppStore((s) => s.removeTask);
  const clearFinishedTasks = useAppStore((s) => s.clearFinishedTasks);

  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const hasTasks = tasks.length > 0;

  const handleRetry = async (task: TaskItem) => {
    if (!task.retry) return;
    updateTask(task.id, { status: 'running', error: undefined, result: undefined });
    try {
      await task.retry();
    } catch {
      // updateTask will be called by the original caller
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      {hasTasks && !open && (
        <button
          className="tc-trigger"
          onClick={toggleTaskCenter}
          aria-label={`任务中心 · ${runningCount > 0 ? `${runningCount} 个进行中` : '全部完成'}`}
        >
          {runningCount > 0 ? <span className="tc-trigger-indicator" /> : <Icon.Lint />}
          <span className="tc-trigger-text">
            {runningCount > 0 ? `${runningCount} 个任务` : '任务中心'}
          </span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="tc-panel">
          <div className="tc-header">
            <h4 className="tc-title">任务中心</h4>
            <div className="tc-header-actions">
              {tasks.some((t) => t.status !== 'running') && (
                <button className="tc-header-btn" onClick={clearFinishedTasks}>
                  清除已完成
                </button>
              )}
              <button className="tc-header-btn tc-close-btn" onClick={toggleTaskCenter}>
                ✕
              </button>
            </div>
          </div>
          <div className="tc-list">
            {tasks.length === 0 && <div className="tc-empty">暂无任务</div>}
            {tasks.map((task) => (
              <div key={task.id} className={`tc-item tc-item-${task.status}`}>
                <span className="tc-item-icon">{TASK_KIND_ICON[task.kind]}</span>
                <div className="tc-item-body">
                  <div className="tc-item-row">
                    <span className="tc-item-label">{task.label}</span>
                    {statusBadge(task.status)}
                  </div>
                  <div className="tc-item-meta">
                    <span className="tc-item-kind">{TASK_KIND_LABEL[task.kind]}</span>
                    <span className="tc-item-time">{relativeTime(task.startedAt)}</span>
                    {task.result && <span className="tc-item-result">{task.result}</span>}
                  </div>
                  {task.error && <div className="tc-item-error">{task.error}</div>}
                </div>
                <div className="tc-item-actions">
                  {task.status === 'running' && <div className="spinner tc-spinner" />}
                  {task.status === 'error' && task.retry && (
                    <button
                      className="tc-retry-btn"
                      onClick={() => void handleRetry(task)}
                      aria-label="重试"
                    >
                      重试
                    </button>
                  )}
                  {task.status !== 'running' && (
                    <button
                      className="tc-dismiss-btn"
                      onClick={() => removeTask(task.id)}
                      aria-label="关闭"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
