'use client';

/**
 * Root error boundary for the App Router.
 *
 * Next.js renders this component when an uncaught error escapes a route
 * segment. We forward the error to Sentry and show a friendly Chinese
 * error page with recovery actions.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body {
                font-family: system-ui, -apple-system, sans-serif;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #faf9f5;
                color: #141413;
                padding: 32px;
              }
              .error-container {
                text-align: center;
                max-width: 420px;
              }
              .error-icon {
                font-size: 48px;
                margin-bottom: 16px;
                opacity: 0.7;
              }
              .error-title {
                font-size: 22px;
                font-weight: 600;
                margin-bottom: 8px;
              }
              .error-desc {
                font-size: 15px;
                color: #5e5d59;
                line-height: 1.6;
                margin-bottom: 24px;
              }
              .error-actions {
                display: flex;
                gap: 12px;
                justify-content: center;
                flex-wrap: wrap;
              }
              .error-btn {
                padding: 10px 20px;
                font-size: 14px;
                font-weight: 500;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                transition: opacity 0.15s;
              }
              .error-btn:hover { opacity: 0.85; }
              .error-btn-primary {
                background: #0f0f0e;
                color: #faf9f5;
              }
              .error-btn-secondary {
                background: #e8e6e1;
                color: #141413;
              }
              @media (prefers-color-scheme: dark) {
                body {
                  background: #1a1a19;
                  color: #e8e6e1;
                }
                .error-desc {
                  color: #a3a19c;
                }
                .error-btn-primary {
                  background: #e8e6e1;
                  color: #1a1a19;
                }
                .error-btn-secondary {
                  background: #2a2a28;
                  color: #e8e6e1;
                }
              }
            `,
          }}
        />
        <div className="error-container">
          <div className="error-icon" aria-hidden="true">
            ⚠
          </div>
          <h1 className="error-title">页面遇到问题</h1>
          <p className="error-desc">
            抱歉，页面加载时遇到了意外错误。你可以尝试刷新页面，或返回首页重新开始。
          </p>
          <div className="error-actions">
            <button
              className="error-btn error-btn-primary"
              onClick={() => window.location.reload()}
              aria-label="刷新当前页面"
            >
              刷新页面
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="error-btn error-btn-secondary" aria-label="返回知识库首页">
              返回首页
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
