'use client';

/**
 * Root error boundary for the App Router.
 *
 * Next.js renders this component when an uncaught error escapes a route
 * segment. We forward the error to Sentry so the client breadcrumb trail and
 * stack trace are preserved alongside the React component stack.
 */
import * as Sentry from '@sentry/nextjs';
import NextError from 'next/error';
import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
