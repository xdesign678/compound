import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-webhook-inbox-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();
  return {
    tempDir,
    cleanup() {
      closeServerDbGlobal();
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test(
  'webhook inbox schema is additive and persist is idempotent',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { getServerDb } = await import('./server-db');
    const { ensureWebhookInboxSchema, fingerprintWebhookSignature, persistWebhookDelivery } =
      await import('./webhook-inbox');

    ensureWebhookInboxSchema();
    ensureWebhookInboxSchema();
    const cols = new Set(
      (
        getServerDb().prepare(`PRAGMA table_info(webhook_deliveries)`).all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    for (const column of [
      'delivery_id',
      'event',
      'ref',
      'before_sha',
      'after_sha',
      'received_at',
      'status',
      'attempts',
      'lease_version',
      'job_id',
      'error',
    ]) {
      assert.ok(cols.has(column), `${column} exists`);
    }

    const rawSignature = 'sha256=raw-hmac-must-not-be-stored';
    const first = persistWebhookDelivery({
      deliveryId: 'd-persist',
      event: 'push',
      signatureSha256: rawSignature,
      ref: 'refs/heads/main',
      beforeSha: 'aaa',
      afterSha: 'bbb',
    });
    const second = persistWebhookDelivery({
      deliveryId: 'd-persist',
      event: 'push',
      signatureSha256: rawSignature,
      ref: 'refs/heads/main',
      beforeSha: 'ccc',
      afterSha: 'ddd',
    });
    const dump = JSON.stringify(getServerDb().prepare(`SELECT * FROM webhook_deliveries`).all());

    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);
    assert.equal(first.row.status, 'received');
    assert.equal(second.row.status, 'received');
    assert.equal(second.row.after_sha, 'bbb');
    assert.equal(first.row.signature_sha256, fingerprintWebhookSignature(rawSignature));
    assert.equal(dump.includes(rawSignature), false);
    assert.equal(dump.includes('payload'), false);
  },
);

test(
  'legacy sha256= signatures are hashed once and 64-hex fingerprints stay stable',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { getServerDb } = await import('./server-db');
    const { ensureWebhookInboxSchema, fingerprintWebhookSignature } =
      await import('./webhook-inbox');

    ensureWebhookInboxSchema();
    const rawHeader = 'sha256=legacy-github-signature-header';
    const stableFingerprint = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const now = Date.now();
    getServerDb()
      .prepare(
        `INSERT INTO webhook_deliveries (delivery_id, event, signature_sha256, received_at, status)
         VALUES (?, 'push', ?, ?, 'received')`,
      )
      .run('d-legacy-sig', rawHeader, now);
    getServerDb()
      .prepare(
        `INSERT INTO webhook_deliveries (delivery_id, event, signature_sha256, received_at, status)
         VALUES (?, 'push', ?, ?, 'received')`,
      )
      .run('d-stable-sig', stableFingerprint, now);

    ensureWebhookInboxSchema();
    const afterFirst = getServerDb()
      .prepare(`SELECT delivery_id, signature_sha256 FROM webhook_deliveries ORDER BY delivery_id`)
      .all() as Array<{ delivery_id: string; signature_sha256: string }>;
    const legacy = afterFirst.find((row) => row.delivery_id === 'd-legacy-sig');
    const stable = afterFirst.find((row) => row.delivery_id === 'd-stable-sig');
    assert.equal(legacy?.signature_sha256, fingerprintWebhookSignature(rawHeader));
    assert.notEqual(legacy?.signature_sha256, rawHeader);
    assert.equal(legacy?.signature_sha256.length, 64);
    assert.equal(stable?.signature_sha256, stableFingerprint);

    ensureWebhookInboxSchema();
    const afterSecond = getServerDb()
      .prepare(`SELECT delivery_id, signature_sha256 FROM webhook_deliveries ORDER BY delivery_id`)
      .all() as Array<{ delivery_id: string; signature_sha256: string }>;
    assert.deepEqual(afterSecond, afterFirst);
  },
);

test(
  'claim uses lease_version so a stale complete cannot overwrite',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const {
      claimWebhookInboxForSync,
      completeWebhookDelivery,
      persistWebhookDelivery,
      recoverClaimedWebhookDeliveries,
      getWebhookDelivery,
    } = await import('./webhook-inbox');

    persistWebhookDelivery({
      deliveryId: 'd-lease',
      event: 'push',
      signatureSha256: 'sha256=lease',
      afterSha: 'head',
    });

    const claim = claimWebhookInboxForSync({
      hasActiveJob: () => false,
      createJob: () => ({ jobId: 'job-lease-1' }),
    });
    assert.ok(claim);
    assert.equal(claim.deliveryId, 'd-lease');
    assert.equal(claim.leaseVersion, 1);

    const stale = completeWebhookDelivery({
      deliveryId: 'd-lease',
      leaseVersion: 0,
      status: 'processed',
    });
    assert.equal(stale, false);
    assert.equal(getWebhookDelivery('d-lease')?.status, 'claimed');

    const recovered = recoverClaimedWebhookDeliveries();
    assert.equal(recovered, 1);
    const afterRecover = getWebhookDelivery('d-lease');
    assert.equal(afterRecover?.status, 'received');
    assert.equal(afterRecover?.job_id, null);
    assert.equal(afterRecover?.lease_version, 2);

    const lateAfterRecover = completeWebhookDelivery({
      deliveryId: 'd-lease',
      leaseVersion: 1,
      status: 'processed',
    });
    assert.equal(lateAfterRecover, false);
    assert.equal(getWebhookDelivery('d-lease')?.status, 'received');

    const reclaim = claimWebhookInboxForSync({
      hasActiveJob: () => false,
      createJob: () => ({ jobId: 'job-lease-2' }),
    });
    assert.ok(reclaim);
    assert.equal(reclaim.jobId, 'job-lease-2');
    assert.equal(reclaim.leaseVersion, 3);
    const ok = completeWebhookDelivery({
      deliveryId: 'd-lease',
      leaseVersion: 3,
      status: 'processed',
    });
    assert.equal(ok, true);
    assert.equal(getWebhookDelivery('d-lease')?.status, 'processed');
    assert.equal(getWebhookDelivery('d-lease')?.job_id, 'job-lease-2');
  },
);

test(
  'same-ref deliveries coalesce to the latest after_sha with terminal states',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { persistWebhookDelivery, claimWebhookInboxForSync, getWebhookDelivery } =
      await import('./webhook-inbox');

    persistWebhookDelivery({
      deliveryId: 'd-old',
      event: 'push',
      signatureSha256: 'sha256=old',
      ref: 'refs/heads/main',
      beforeSha: 'sha-0',
      afterSha: 'sha-1',
    });
    persistWebhookDelivery({
      deliveryId: 'd-mid',
      event: 'push',
      signatureSha256: 'sha256=mid',
      ref: 'refs/heads/main',
      beforeSha: 'sha-1',
      afterSha: 'sha-2',
    });
    persistWebhookDelivery({
      deliveryId: 'd-new',
      event: 'push',
      signatureSha256: 'sha256=new',
      ref: 'refs/heads/main',
      beforeSha: 'sha-2',
      afterSha: 'sha-3',
    });

    const claim = claimWebhookInboxForSync({
      hasActiveJob: () => false,
      createJob: () => ({ jobId: 'job-coalesce' }),
    });
    assert.ok(claim);
    assert.equal(claim.deliveryId, 'd-new');
    assert.equal(claim.afterSha, 'sha-3');
    assert.equal(claim.beforeSha, 'sha-0');
    assert.deepEqual(claim.coalescedDeliveryIds.sort(), ['d-mid', 'd-old']);
    assert.equal(getWebhookDelivery('d-old')?.status, 'coalesced');
    assert.equal(getWebhookDelivery('d-mid')?.status, 'coalesced');
    assert.equal(getWebhookDelivery('d-new')?.status, 'claimed');
    assert.equal(getWebhookDelivery('d-old')?.job_id, 'job-coalesce');
    assert.equal(getWebhookDelivery('d-new')?.job_id, 'job-coalesce');
  },
);

test('claim is skipped while another sync job is running', { concurrency: false }, async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { persistWebhookDelivery, claimWebhookInboxForSync, getWebhookDelivery } =
    await import('./webhook-inbox');
  persistWebhookDelivery({
    deliveryId: 'd-wait',
    event: 'push',
    signatureSha256: 'sha256=wait',
  });
  const claim = claimWebhookInboxForSync({
    hasActiveJob: () => true,
    createJob: () => ({ jobId: 'job-should-not-exist' }),
  });
  assert.equal(claim, null);
  const row = getWebhookDelivery('d-wait');
  assert.equal(row?.status, 'received');
  assert.equal(row?.job_id, null);
});
