'use client';

/**
 * Root error boundary for the App Router.
 *
 * Next.js renders this component when an uncaught error escapes a route
 * segment. We forward the error to Sentry and show a friendly Chinese
 * error page with recovery actions.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import { ErrorBoundaryState } from '@/components/ErrorBoundaryState';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [sentryEventId, setSentryEventId] = useState<string | null>(null);

  useEffect(() => {
    setSentryEventId(Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/* 与 app/layout.tsx 的主题探测保持一致：全局错误页不走 layout，需要自行补 .dark 类 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
  try {
    var theme = localStorage.getItem('compound_theme');
    if (theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch(e) {}
`,
          }}
        />
        <ErrorBoundaryState error={error} sentryEventId={sentryEventId} />
      </body>
    </html>
  );
}
