import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addBreadcrumb,
  reportError,
  setObservabilityTag,
  setObservabilityUser,
} from './observability/sentry';

// These tests guarantee the observability façade behaves as a safe no-op when
// Sentry has not been initialised (no SENTRY_DSN configured). This is the
// default state during local development, unit tests, and PR previews — the
// helpers must never throw or perform network I/O in that mode.

test('reportError returns undefined when Sentry is not initialised', () => {
  const id = reportError(new Error('boom'), {
    tags: { area: 'unit-test' },
    extras: { meaningOfLife: 42 },
    fingerprint: ['unit-test', 'reportError'],
    level: 'error',
  });
  assert.equal(id, undefined);
});

test('reportError tolerates non-Error throwables', () => {
  assert.doesNotThrow(() => {
    reportError('plain string error');
    reportError({ message: 'object error' });
    reportError(null);
    reportError(undefined);
  });
});

test('addBreadcrumb is a no-op when Sentry is not initialised', () => {
  assert.doesNotThrow(() => {
    addBreadcrumb({
      category: 'test',
      message: 'something happened',
      level: 'info',
      data: { foo: 'bar' },
    });
  });
});

test('setObservabilityUser accepts user payloads and null', () => {
  assert.doesNotThrow(() => {
    setObservabilityUser({ id: 'user-1', segment: 'beta' });
    setObservabilityUser(null);
  });
});

test('setObservabilityTag accepts string, number, and boolean values', () => {
  assert.doesNotThrow(() => {
    setObservabilityTag('workspace', 'demo');
    setObservabilityTag('attempt', 3);
    setObservabilityTag('cached', true);
  });
});
