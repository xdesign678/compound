'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Clipboard, Home, RotateCcw } from 'lucide-react';

const ERROR_BOUNDARY_STYLES = `
  html,
  body {
    margin: 0;
    min-height: 100%;
  }
  * {
    box-sizing: border-box;
  }
  button {
    font: inherit;
  }
  .error-boundary-shell {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 32px 20px;
    background: #faf9f5;
    color: #141413;
    font-family: Inter, system-ui, -apple-system, sans-serif;
  }
  .error-boundary-state {
    width: min(100%, 520px);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .error-boundary-mark {
    width: 64px;
    height: 64px;
    display: grid;
    place-items: center;
    color: #7d3522;
    background: rgba(217, 119, 87, 0.12);
    border: 1px solid rgba(217, 119, 87, 0.22);
    border-radius: 8px;
    margin-bottom: 24px;
  }
  .error-boundary-kicker {
    margin: 0 0 8px;
    color: #7d3522;
    font-size: 12px;
    font-weight: 650;
    line-height: 1.4;
  }
  .error-boundary-title {
    margin: 0;
    font-size: clamp(2rem, 1.694rem + 1.306vw, 3rem);
    font-weight: 650;
    line-height: 1.12;
    letter-spacing: 0;
  }
  .error-boundary-copy {
    max-width: 440px;
    margin: 16px 0 0;
    color: rgba(20, 20, 19, 0.85);
    font-family: Lora, "Noto Serif SC", Georgia, "Times New Roman", serif;
    font-size: 17px;
    line-height: 1.72;
  }
  .error-boundary-status {
    width: min(100%, 420px);
    margin-top: 28px;
    padding: 14px 16px;
    border: 1px solid rgba(20, 20, 19, 0.12);
    border-radius: 8px;
    background: #ffffff;
    color: #5e5d59;
    font-size: 13px;
    line-height: 1.55;
  }
  .error-boundary-status strong {
    display: block;
    margin-top: 4px;
    color: #141413;
    font-family: "Geist Mono", "SF Mono", monospace;
    font-size: 12px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .error-boundary-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
    margin-top: 32px;
  }
  .error-boundary-action {
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 650;
    line-height: 1.4;
    text-decoration: none;
    cursor: pointer;
  }
  .error-boundary-primary {
    border: 1px solid #141413;
    background: #141413;
    color: #faf9f5;
  }
  .error-boundary-primary:hover {
    background: #7d3522;
    border-color: #7d3522;
  }
  .error-boundary-secondary {
    border: 1px solid rgba(20, 20, 19, 0.12);
    background: transparent;
    color: #141413;
  }
  .error-boundary-secondary:hover {
    background: #f5f4f0;
    border-color: rgba(125, 53, 34, 0.3);
  }
  .error-boundary-action:focus-visible {
    outline: 2px solid #7d3522;
    outline-offset: 3px;
    box-shadow: 0 0 0 4px rgba(217, 119, 87, 0.12);
  }
  @media (prefers-color-scheme: dark) {
    .error-boundary-shell {
      background: #1a1a18;
      color: #ece9e1;
    }
    .error-boundary-mark {
      color: #f0a183;
      background: rgba(217, 119, 87, 0.14);
      border-color: rgba(217, 119, 87, 0.28);
    }
    .error-boundary-kicker {
      color: #f0a183;
    }
    .error-boundary-copy {
      color: rgba(236, 233, 225, 0.85);
    }
    .error-boundary-status {
      background: #232320;
      border-color: rgba(236, 233, 225, 0.12);
      color: #9b9b95;
    }
    .error-boundary-status strong {
      color: #ece9e1;
    }
    .error-boundary-primary {
      border-color: #ece9e1;
      background: #ece9e1;
      color: #1a1a18;
    }
    .error-boundary-primary:hover {
      background: #f0a183;
      border-color: #f0a183;
    }
    .error-boundary-secondary {
      border-color: rgba(236, 233, 225, 0.12);
      color: #ece9e1;
    }
    .error-boundary-secondary:hover {
      background: #2a2a27;
      border-color: rgba(240, 161, 131, 0.36);
    }
  }
  @media (max-width: 520px) {
    .error-boundary-shell {
      align-items: start;
      padding-top: 72px;
    }
    .error-boundary-actions {
      width: 100%;
      flex-direction: column;
    }
    .error-boundary-action {
      width: 100%;
    }
  }
`;

interface ErrorBoundaryStateProps {
  error: Error & { digest?: string };
  reset?: () => void;
  sentryEventId?: string | null;
}

export function ErrorBoundaryState({ error, reset, sentryEventId }: ErrorBoundaryStateProps) {
  const [copied, setCopied] = useState(false);
  const errorId = useMemo(
    () => error.digest || sentryEventId || 'local-error',
    [error, sentryEventId],
  );
  const sentryStatus = sentryEventId ? '已上报 Sentry' : 'Sentry 未返回事件 ID';

  const handleRetry = () => {
    if (reset) {
      reset();
      return;
    }
    window.location.reload();
  };

  const handleCopy = async () => {
    await navigator.clipboard?.writeText(errorId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ERROR_BOUNDARY_STYLES }} />
      <main className="error-boundary-shell">
        <section className="error-boundary-state" aria-labelledby="error-boundary-title">
          <div className="error-boundary-mark" aria-hidden="true">
            <AlertTriangle size={28} strokeWidth={1.8} />
          </div>

          <p className="error-boundary-kicker">页面异常</p>
          <h1 className="error-boundary-title" id="error-boundary-title">
            页面遇到问题
          </h1>
          <p className="error-boundary-copy">
            页面加载时出现了意外错误。你可以先重试当前页面；如果问题持续，把错误 ID 发给维护者排查。
          </p>

          <div className="error-boundary-status" aria-live="polite">
            {sentryStatus}
            <strong>错误 ID：{errorId}</strong>
          </div>

          <div className="error-boundary-actions">
            <button
              className="error-boundary-action error-boundary-primary"
              type="button"
              onClick={handleRetry}
            >
              <RotateCcw size={16} aria-hidden="true" />
              重试
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="error-boundary-action error-boundary-secondary" href="/">
              <Home size={16} aria-hidden="true" />
              回首页
            </a>
            <button
              className="error-boundary-action error-boundary-secondary"
              type="button"
              onClick={() => void handleCopy()}
            >
              <Clipboard size={16} aria-hidden="true" />
              {copied ? '已复制' : '复制错误 ID'}
            </button>
          </div>
        </section>
      </main>
    </>
  );
}
