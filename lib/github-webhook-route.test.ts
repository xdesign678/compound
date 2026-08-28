import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-github-webhook-route-'));
  const previousEnv = new Map<string, string | undefined>();
  for (const key of ['DATA_DIR', 'GITHUB_WEBHOOK_SECRET', 'COMPOUND_WEBHOOK_RATE_LIMIT']) {
    previousEnv.set(key, process.env[key]);
  }
  process.env.DATA_DIR = tempDir;
  process.env.GITHUB_WEBHOOK_SECRET = 'webhook-test-secret';
  process.env.COMPOUND_WEBHOOK_RATE_LIMIT = '1000';
  closeServerDbGlobal();
  return {
    tempDir,
    cleanup() {
      closeServerDbGlobal();
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function sign(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function waitForSyncLoops(): Promise<void> {
  const holder = globalThis as unknown as {
    __activeSyncPromises?: Set<Promise<void>>;
  };
  for (let i = 0; i < 40; i += 1) {
    const promises = Array.from(holder.__activeSyncPromises ?? []);
    if (promises.length === 0) return;
    await Promise.allSettled(promises);
  }
}

test(
  'webhook route persists the inbox before ACK and never stores raw payload or signature',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    const { fingerprintWebhookSignature } = await import('./webhook-inbox');
    const { setGithubSyncLoopRunnerForTests } = await import('./github-sync-runner');
    const { handleGithubWebhookRequest } = await import('./webhook-inbox-http');
    t.after(() => setGithubSyncLoopRunnerForTests(null));
    setGithubSyncLoopRunnerForTests(async (jobId) => {
      repo.updateSyncJob(jobId, { status: 'done', finished_at: Date.now(), current: 'injected' });
    });

    const uniqueMarker = 'raw-payload-marker-should-never-hit-sqlite';
    const body = JSON.stringify({
      ref: 'refs/heads/main',
      before: 'sha-before',
      after: 'sha-after',
      marker: uniqueMarker,
    });
    const signature = sign(body, 'webhook-test-secret');
    const req = new Request('http://localhost/api/sync/github/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': 'route-delivery-1',
        'x-hub-signature-256': signature,
        'x-forwarded-for': '203.0.113.10',
      },
      body,
    });
    const res = await handleGithubWebhookRequest(req);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { jobId: string; existing: boolean; queued: boolean };
    assert.equal(json.existing, false);
    assert.ok(json.jobId);
    await waitForSyncLoops();

    const { getServerDb } = await import('./server-db');
    const dump = JSON.stringify(getServerDb().prepare(`SELECT * FROM webhook_deliveries`).all());
    const row = getServerDb()
      .prepare(
        `SELECT delivery_id, event, ref, before_sha, after_sha, status, job_id, signature_sha256
           FROM webhook_deliveries WHERE delivery_id = ?`,
      )
      .get('route-delivery-1') as {
      delivery_id: string;
      event: string;
      ref: string | null;
      before_sha: string | null;
      after_sha: string | null;
      status: string;
      job_id: string | null;
      signature_sha256: string;
    };
    assert.equal(row.delivery_id, 'route-delivery-1');
    assert.equal(row.event, 'push');
    assert.equal(row.ref, 'refs/heads/main');
    assert.equal(row.before_sha, 'sha-before');
    assert.equal(row.after_sha, 'sha-after');
    assert.equal(row.status, 'processed');
    assert.equal(row.job_id, json.jobId);
    assert.equal(row.signature_sha256, fingerprintWebhookSignature(signature));
    assert.equal(dump.includes(uniqueMarker), false);
    assert.equal(dump.includes(signature), false);
    assert.equal(dump.includes('webhook-test-secret'), false);
  },
);

test('webhook route keeps B queued while A is running', { concurrency: false }, async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { setGithubSyncLoopRunnerForTests, startGithubSync } = await import('./github-sync-runner');
  const { handleGithubWebhookRequest } = await import('./webhook-inbox-http');
  t.after(() => setGithubSyncLoopRunnerForTests(null));

  const gate = { release() {} };
  const aRunning = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  let seenFirst = false;
  setGithubSyncLoopRunnerForTests(async (jobId) => {
    if (!seenFirst) {
      seenFirst = true;
      await aRunning;
    }
    repo.updateSyncJob(jobId, { status: 'done', finished_at: Date.now(), current: 'injected' });
  });

  const a = startGithubSync({ triggerType: 'manual' });
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !seenFirst) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const body = JSON.stringify({
    ref: 'refs/heads/main',
    before: 'sha-a',
    after: 'sha-b',
  });
  const signature = sign(body, 'webhook-test-secret');
  const res = await handleGithubWebhookRequest(
    new Request('http://localhost/api/sync/github/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': 'route-delivery-b',
        'x-hub-signature-256': signature,
        'x-forwarded-for': '203.0.113.11',
      },
      body,
    }),
  );
  assert.equal(res.status, 200);
  const json = (await res.json()) as { jobId: string; existing: boolean; queued: boolean };
  assert.equal(json.queued, true);
  assert.equal(json.existing, false);
  const row = getServerDb()
    .prepare(`SELECT status, job_id FROM webhook_deliveries WHERE delivery_id = ?`)
    .get('route-delivery-b') as { status: string; job_id: string | null };
  assert.ok(['received', 'queued'].includes(row.status));
  assert.equal(row.job_id, null);
  assert.notEqual(json.jobId, a.jobId);

  gate.release();
  await waitForSyncLoops();
  const after = getServerDb()
    .prepare(`SELECT status, job_id FROM webhook_deliveries WHERE delivery_id = ?`)
    .get('route-delivery-b') as { status: string; job_id: string | null };
  assert.equal(after.status, 'processed');
  assert.ok(after.job_id);
  assert.notEqual(after.job_id, a.jobId);
});
