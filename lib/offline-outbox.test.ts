import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_OUTBOX_ATTEMPTS,
  createOutboxItem,
  hashOutboxPayload,
  nextOutboxAttempt,
} from './offline-outbox';

test('createOutboxItem persists operationId and payload hash before UI confirmation', () => {
  const payload = { title: '笔记', type: 'text', rawContent: 'hello' };
  const item = createOutboxItem({ kind: 'ingest', payload, now: 1000 });

  assert.equal(item.kind, 'ingest');
  assert.equal(item.state, 'queued');
  assert.equal(item.attempt, 0);
  assert.equal(item.payloadHash, hashOutboxPayload(payload));
  assert.match(item.operationId, /^op-/);
  assert.equal(item.createdAt, 1000);
});

test('nextOutboxAttempt uses bounded backoff and eventually fails closed', () => {
  let item = createOutboxItem({
    kind: 'ingest',
    payload: { title: 'x', type: 'text', rawContent: 'y' },
    now: 0,
  });
  for (let i = 0; i < MAX_OUTBOX_ATTEMPTS - 1; i += 1) {
    item = nextOutboxAttempt({ ...item, error: 'offline' }, i);
    assert.equal(item.state, 'queued');
    assert.ok((item.nextAttemptAt ?? 0) > i);
  }
  item = nextOutboxAttempt(item, 99_000);
  assert.equal(item.state, 'failed');
  assert.equal(item.attempt, MAX_OUTBOX_ATTEMPTS);
});
