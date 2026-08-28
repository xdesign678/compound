import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CREDENTIAL_CONTEXT_LOST,
  MAX_OUTBOX_ATTEMPTS,
  OUTBOX_CLAIM_LEASE_MS,
  buildCredentialContext,
  cancelOutboxItem,
  claimOutboxItem,
  classifyOutboxError,
  clearTerminalOutbox,
  completeOutboxIfClaimed,
  createOutboxItem,
  dismissTerminalOutbox,
  credentialContextMatches,
  fingerprintSecret,
  hashOutboxPayload,
  nextOutboxAttempt,
  payloadContainsRawSecret,
  setOutboxStoreForTests,
  sha256Hex,
  type OfflineOutboxItem,
  type OutboxRecordStore,
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

test('createOutboxItem reuses a supplied operationId instead of minting another', () => {
  const item = createOutboxItem({
    kind: 'ingest',
    payload: { title: 'x', type: 'text', rawContent: 'y' },
    operationId: 'op-existing-token-01',
  });
  assert.equal(item.operationId, 'op-existing-token-01');
});

test('createOutboxItem refuses to persist a raw BYOK key', () => {
  assert.equal(payloadContainsRawSecret({ apiKey: 'sk-live' }), true);
  assert.equal(payloadContainsRawSecret({ title: 'note', rawContent: 'hi' }), false);
  assert.throws(
    () =>
      createOutboxItem({
        kind: 'ingest',
        payload: { title: 'x', type: 'text', rawContent: 'y', apiKey: 'sk-live' },
      }),
    /raw API keys/,
  );
});

test('credential fingerprints use SHA-256 and never store the raw key', async () => {
  const stored = await buildCredentialContext({
    apiKey: 'sk-secret',
    apiUrl: 'https://api.example',
    model: 'wiki-model',
  });
  const digest = await sha256Hex('sk-secret');
  assert.equal(stored.keyFingerprint, digest);
  assert.equal(stored.keyFingerprint, await fingerprintSecret('sk-secret'));
  assert.equal(stored.keyFingerprint.length, 64);
  assert.notEqual(stored.keyFingerprint, hashOutboxPayload('sk-secret'));
  assert.equal('sk-secret' in stored, false);
  assert.equal(
    credentialContextMatches(
      stored,
      await buildCredentialContext({
        apiKey: 'sk-secret',
        apiUrl: 'https://api.example',
        model: 'wiki-model',
      }),
    ),
    true,
  );
  assert.equal(
    credentialContextMatches(
      stored,
      await buildCredentialContext({
        apiKey: 'sk-other',
        apiUrl: 'https://api.example',
        model: 'wiki-model',
      }),
    ),
    false,
  );
});

test('nextOutboxAttempt uses bounded backoff for retryable errors and eventually fails closed', () => {
  let item = createOutboxItem({
    kind: 'ingest',
    payload: { title: 'x', type: 'text', rawContent: 'y' },
    now: 0,
  });
  for (let i = 0; i < MAX_OUTBOX_ATTEMPTS - 1; i += 1) {
    item = nextOutboxAttempt({ ...item, error: 'offline', errorClass: 'retryable' }, i);
    assert.equal(item.state, 'queued');
    assert.ok((item.nextAttemptAt ?? 0) > i);
  }
  item = nextOutboxAttempt(item, 99_000);
  assert.equal(item.state, 'failed');
  assert.equal(item.attempt, MAX_OUTBOX_ATTEMPTS);
});

test('permanent and auth errors fail immediately instead of looping eight times', () => {
  const base = createOutboxItem({
    kind: 'ingest',
    payload: { title: 'x', type: 'text', rawContent: 'y' },
    now: 0,
  });
  const permanent = nextOutboxAttempt({
    ...base,
    error: 'operationId already used with a different payload',
    errorClass: classifyOutboxError({ status: 409, code: 'ingest_operation_conflict' }),
  });
  const auth = nextOutboxAttempt({
    ...base,
    error: '认证失败',
    errorClass: classifyOutboxError({ status: 401 }),
  });
  const lost = nextOutboxAttempt({
    ...base,
    error: CREDENTIAL_CONTEXT_LOST,
    errorClass: classifyOutboxError(new Error(CREDENTIAL_CONTEXT_LOST)),
  });
  const inProgress = classifyOutboxError({ status: 409, code: 'ingest_operation_in_progress' });
  const timeout = classifyOutboxError({ status: 504, message: 'timeout' });
  const server = classifyOutboxError({ status: 503 });

  assert.equal(permanent.state, 'failed');
  assert.equal(permanent.attempt, 0);
  assert.equal(auth.state, 'failed');
  assert.equal(lost.state, 'failed');
  assert.equal(lost.errorClass, 'credential_context_lost');
  assert.equal(inProgress, 'retryable');
  assert.equal(timeout, 'retryable');
  assert.equal(server, 'retryable');
});

function memoryOutboxStore(seed: OfflineOutboxItem[] = []): OutboxRecordStore & {
  rows: Map<string, OfflineOutboxItem>;
} {
  const rows = new Map(seed.map((item) => [item.id, { ...item }]));
  return {
    rows,
    async get(id: string) {
      const row = rows.get(id);
      return row ? { ...row } : undefined;
    },
    async put(item: OfflineOutboxItem) {
      rows.set(item.id, { ...item });
    },
    async toArray() {
      return [...rows.values()].map((item) => ({ ...item }));
    },
    async bulkDelete(ids: string[]) {
      for (const id of ids) rows.delete(id);
    },
  };
}

test('outbox claim lease outlives ingest timeouts and expired A cannot overwrite B', async () => {
  const item = createOutboxItem({
    kind: 'ingest',
    payload: { title: 'x', type: 'text', rawContent: 'body' },
    now: 0,
  });
  const store = memoryOutboxStore([item]);
  setOutboxStoreForTests(store);
  try {
    const claimA = await claimOutboxItem(item.id, 1_000);
    assert.ok(claimA?.claimToken);
    assert.ok((claimA?.claimUntil ?? 0) - 1_000 >= OUTBOX_CLAIM_LEASE_MS);
    assert.ok(OUTBOX_CLAIM_LEASE_MS > 270_000);
    assert.ok(OUTBOX_CLAIM_LEASE_MS > 300_000);

    const duringLease = await claimOutboxItem(item.id, 1_000 + 270_000);
    assert.equal(duringLease, null);

    const claimB = await claimOutboxItem(item.id, 1_000 + OUTBOX_CLAIM_LEASE_MS + 1);
    assert.ok(claimB?.claimToken);
    assert.notEqual(claimB?.claimToken, claimA?.claimToken);

    const aComplete = await completeOutboxIfClaimed(item.id, claimA!.claimToken!, {
      state: 'succeeded',
      result: 'from A',
    });
    assert.equal(aComplete, false);
    assert.equal(store.rows.get(item.id)?.state, 'inflight');
    assert.equal(store.rows.get(item.id)?.result, undefined);
    assert.equal(store.rows.get(item.id)?.claimToken, claimB?.claimToken);

    const bComplete = await completeOutboxIfClaimed(item.id, claimB!.claimToken!, {
      state: 'succeeded',
      result: 'from B',
    });
    assert.equal(bComplete, true);
    assert.equal(store.rows.get(item.id)?.state, 'succeeded');
    assert.equal(store.rows.get(item.id)?.result, 'from B');
  } finally {
    setOutboxStoreForTests(null);
  }
});

test('clearTerminalOutbox deletes succeeded/failed/cancelled and keeps queued/inflight', async () => {
  const queued = createOutboxItem({
    kind: 'ingest',
    payload: { title: 'q', type: 'text', rawContent: 'q' },
    now: 1,
  });
  const inflight = {
    ...createOutboxItem({
      kind: 'ingest',
      payload: { title: 'i', type: 'text', rawContent: 'i' },
      now: 2,
    }),
    state: 'inflight' as const,
    claimToken: 'tok',
    claimUntil: Date.now() + 60_000,
  };
  const done = {
    ...createOutboxItem({
      kind: 'ingest',
      payload: { title: 'd', type: 'text', rawContent: 'd' },
      now: 3,
    }),
    state: 'succeeded' as const,
  };
  const failed = {
    ...createOutboxItem({
      kind: 'ingest',
      payload: { title: 'f', type: 'text', rawContent: 'f' },
      now: 4,
    }),
    state: 'failed' as const,
  };
  const store = memoryOutboxStore([queued, inflight, done, failed]);
  setOutboxStoreForTests(store);
  try {
    const removed = await clearTerminalOutbox();
    assert.equal(removed.length, 2);
    assert.equal(store.rows.has(queued.id), true);
    assert.equal(store.rows.has(inflight.id), true);
    assert.equal(store.rows.has(done.id), false);
    assert.equal(store.rows.has(failed.id), false);

    store.rows.set(done.id, done);
    assert.equal(await dismissTerminalOutbox(done.id), true);
    assert.equal(store.rows.has(done.id), false);
    assert.equal(await dismissTerminalOutbox(queued.id), false);
    assert.equal(store.rows.has(queued.id), true);
  } finally {
    setOutboxStoreForTests(null);
  }
});

test('cancel while A is inflight prevents a late success from resurrecting the item', async () => {
  const item = createOutboxItem({
    kind: 'ingest',
    payload: { title: 'x', type: 'text', rawContent: 'body' },
    now: 0,
  });
  const store = memoryOutboxStore([item]);
  setOutboxStoreForTests(store);
  try {
    const claimA = await claimOutboxItem(item.id, 50);
    assert.ok(claimA?.claimToken);
    const cancelled = await cancelOutboxItem(item.id, 80);
    assert.equal(cancelled, true);
    assert.equal(store.rows.get(item.id)?.state, 'cancelled');

    const late = await completeOutboxIfClaimed(item.id, claimA!.claimToken!, {
      state: 'succeeded',
      result: 'late A',
    });
    assert.equal(late, false);
    assert.equal(store.rows.get(item.id)?.state, 'cancelled');
    assert.notEqual(store.rows.get(item.id)?.result, 'late A');
  } finally {
    setOutboxStoreForTests(null);
  }
});
