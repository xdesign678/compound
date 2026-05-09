'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import { ErrorBoundaryState } from '@/components/ErrorBoundaryState';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [sentryEventId, setSentryEventId] = useState<string | null>(null);

  useEffect(() => {
    setSentryEventId(Sentry.captureException(error));
  }, [error]);

  return <ErrorBoundaryState error={error} reset={reset} sentryEventId={sentryEventId} />;
}
