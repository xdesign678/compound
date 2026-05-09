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
    <html lang="zh-CN">
      <body>
        <ErrorBoundaryState error={error} sentryEventId={sentryEventId} />
      </body>
    </html>
  );
}
