/**
 * Durable GitHub webhook delivery inbox.
 *
 * Persist happens in its own SQLite transaction before ACK. The signature is
 * stored only as an irreversible fingerprint; raw payloads and secrets are
 * never written. Duplicate delivery_id values are idempotent.
 *
 * Server-only.
 */
import crypto from 'node:crypto';
import { getServerDb } from './server-db';
import { syncObs } from './sync-observability';

const WEBHOOK_DELIVERY_PENDING_STATUSES = ['received', 'queued'] as const;
const WEBHOOK_DELIVERY_TERMINAL_STATUSES = [
  'processed',
  'coalesced',
  'failed',
  'rejected',
] as const;

type WebhookDeliveryPendingStatus = (typeof WEBHOOK_DELIVERY_PENDING_STATUSES)[number];
type WebhookDeliveryTerminalStatus = (typeof WEBHOOK_DELIVERY_TERMINAL_STATUSES)[number];
export type WebhookDeliveryStatus =
  | WebhookDeliveryPendingStatus
  | 'claimed'
  | WebhookDeliveryTerminalStatus;

export interface PersistWebhookDeliveryInput {
  deliveryId: string;
  event: string;
  signatureSha256?: string;
  ref?: string | null;
  beforeSha?: string | null;
  afterSha?: string | null;
}

export interface WebhookDeliveryRecord {
  delivery_id: string;
  event: string;
  ref: string | null;
  before_sha: string | null;
  after_sha: string | null;
  received_at: number;
  status: WebhookDeliveryStatus;
  attempts: number;
  lease_version: number;
  job_id: string | null;
  error: string | null;
  signature_sha256: string;
}

export interface PersistWebhookDeliveryResult {
  inserted: boolean;
  row: WebhookDeliveryRecord;
}

export interface WebhookInboxClaim {
  jobId: string;
  deliveryId: string;
  leaseVersion: number;
  coalescedDeliveryIds: string[];
  beforeSha: string | null;
  afterSha: string | null;
  ref: string | null;
}

const PENDING_STATUSES_SQL = `'received', 'queued'`;

function tableExists(tableName: string): boolean {
  const row = getServerDb()
    .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?`)
    .get(tableName) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function tableColumns(tableName: string): Set<string> {
  if (!tableExists(tableName)) return new Set();
  const rows = getServerDb().prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  return new Set(rows.map((row) => row.name));
}

function addColumnIfMissing(tableName: string, column: string, sql: string): void {
  if (!tableColumns(tableName).has(column)) {
    getServerDb().exec(`ALTER TABLE ${tableName} ADD COLUMN ${column} ${sql};`);
  }
}

export function fingerprintWebhookSignature(signature: string): string {
  return crypto.createHash('sha256').update(signature, 'utf8').digest('hex');
}

function isStableWebhookSignatureFingerprint(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function migrateLegacyWebhookSignatureFingerprints(): void {
  const db = getServerDb();
  if (
    !tableExists('webhook_deliveries') ||
    !tableColumns('webhook_deliveries').has('signature_sha256')
  ) {
    return;
  }
  const rows = db
    .prepare(`SELECT delivery_id, signature_sha256 FROM webhook_deliveries`)
    .all() as Array<{ delivery_id: string; signature_sha256: string | null }>;
  const update = db.prepare(
    `UPDATE webhook_deliveries
        SET signature_sha256 = ?
      WHERE delivery_id = ?
        AND signature_sha256 = ?`,
  );
  for (const row of rows) {
    const current = row.signature_sha256 ?? '';
    if (isStableWebhookSignatureFingerprint(current)) continue;
    update.run(fingerprintWebhookSignature(current), row.delivery_id, current);
  }
}

export function ensureWebhookInboxSchema(): void {
  syncObs.ensureSchema();
  const db = getServerDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      delivery_id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      signature_sha256 TEXT NOT NULL DEFAULT '',
      received_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      job_id TEXT,
      error TEXT,
      ref TEXT,
      before_sha TEXT,
      after_sha TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_version INTEGER NOT NULL DEFAULT 0
    );
  `);
  addColumnIfMissing('webhook_deliveries', 'ref', 'TEXT');
  addColumnIfMissing('webhook_deliveries', 'before_sha', 'TEXT');
  addColumnIfMissing('webhook_deliveries', 'after_sha', 'TEXT');
  addColumnIfMissing('webhook_deliveries', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('webhook_deliveries', 'lease_version', 'INTEGER NOT NULL DEFAULT 0');
  migrateLegacyWebhookSignatureFingerprints();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_received
      ON webhook_deliveries(received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status_received
      ON webhook_deliveries(status, received_at);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ref_received
      ON webhook_deliveries(ref, received_at);
  `);
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function coalesceKey(row: { ref: string | null; delivery_id: string }): string {
  return row.ref || row.delivery_id;
}

export function getWebhookDelivery(deliveryId: string): WebhookDeliveryRecord | null {
  ensureWebhookInboxSchema();
  const row = getServerDb()
    .prepare(
      `SELECT delivery_id, event, ref, before_sha, after_sha, received_at, status,
              COALESCE(attempts, 0) AS attempts,
              COALESCE(lease_version, 0) AS lease_version,
              job_id, error, signature_sha256
         FROM webhook_deliveries
        WHERE delivery_id = ?`,
    )
    .get(deliveryId) as WebhookDeliveryRecord | undefined;
  return row ?? null;
}

export function persistWebhookDelivery(
  input: PersistWebhookDeliveryInput,
): PersistWebhookDeliveryResult {
  ensureWebhookInboxSchema();
  if (!input.deliveryId.trim()) throw new Error('Missing X-GitHub-Delivery header');
  const fingerprint = fingerprintWebhookSignature(input.signatureSha256 ?? '');
  const receivedAt = Date.now();
  const db = getServerDb();
  return db.transaction(() => {
    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO webhook_deliveries
           (delivery_id, event, signature_sha256, received_at, status,
            ref, before_sha, after_sha, attempts, lease_version, job_id, error)
         VALUES (?, ?, ?, ?, 'received', ?, ?, ?, 0, 0, NULL, NULL)`,
      )
      .run(
        input.deliveryId,
        input.event,
        fingerprint,
        receivedAt,
        normalizeOptional(input.ref),
        normalizeOptional(input.beforeSha),
        normalizeOptional(input.afterSha),
      );
    const row = getWebhookDelivery(input.deliveryId);
    if (!row) throw new Error('webhook delivery persist failed');
    return { inserted: inserted.changes > 0, row };
  })();
}

export function recoverClaimedWebhookDeliveries(): number {
  ensureWebhookInboxSchema();
  const result = getServerDb()
    .prepare(
      `UPDATE webhook_deliveries
          SET status = 'received',
              job_id = NULL,
              lease_version = COALESCE(lease_version, 0) + 1
        WHERE status = 'claimed'`,
    )
    .run();
  return result.changes;
}

export function completeWebhookDelivery(input: {
  deliveryId: string;
  leaseVersion: number;
  status: 'processed' | 'failed';
  error?: string | null;
}): boolean {
  ensureWebhookInboxSchema();
  const result = getServerDb()
    .prepare(
      `UPDATE webhook_deliveries
          SET status = ?,
              error = ?
        WHERE delivery_id = ?
          AND lease_version = ?
          AND status = 'claimed'`,
    )
    .run(input.status, input.error ?? null, input.deliveryId, input.leaseVersion);
  return result.changes === 1;
}

export function claimWebhookInboxForSync(handlers: {
  hasActiveJob: () => boolean;
  createJob: () => { jobId: string; existing?: boolean };
}): WebhookInboxClaim | null {
  ensureWebhookInboxSchema();
  const db = getServerDb();
  return db.transaction(() => {
    if (handlers.hasActiveJob()) return null;
    const pending = db
      .prepare(
        `SELECT delivery_id, event, ref, before_sha, after_sha, received_at, status,
                COALESCE(attempts, 0) AS attempts,
                COALESCE(lease_version, 0) AS lease_version,
                job_id, error, signature_sha256
           FROM webhook_deliveries
          WHERE status IN (${PENDING_STATUSES_SQL})
          ORDER BY received_at ASC, rowid ASC`,
      )
      .all() as WebhookDeliveryRecord[];
    if (pending.length === 0) return null;

    const head = pending[0];
    if (!head) return null;
    const groupKey = coalesceKey(head);
    const group = pending.filter((row) => coalesceKey(row) === groupKey);
    const oldest = group[0];
    const winner = group[group.length - 1];
    if (!oldest || !winner) return null;

    const claimed = db
      .prepare(
        `UPDATE webhook_deliveries
            SET status = 'claimed',
                attempts = COALESCE(attempts, 0) + 1,
                lease_version = COALESCE(lease_version, 0) + 1,
                error = NULL
          WHERE delivery_id = ?
            AND status IN (${PENDING_STATUSES_SQL})
            AND COALESCE(lease_version, 0) = ?`,
      )
      .run(winner.delivery_id, winner.lease_version);
    if (claimed.changes !== 1) return null;
    const leaseVersion = winner.lease_version + 1;

    const coalescedDeliveryIds: string[] = [];
    for (const row of group) {
      if (row.delivery_id === winner.delivery_id) continue;
      const coalesced = db
        .prepare(
          `UPDATE webhook_deliveries
              SET status = 'coalesced',
                  lease_version = COALESCE(lease_version, 0) + 1,
                  error = NULL
            WHERE delivery_id = ?
              AND status IN (${PENDING_STATUSES_SQL})
              AND COALESCE(lease_version, 0) = ?`,
        )
        .run(row.delivery_id, row.lease_version);
      if (coalesced.changes === 1) coalescedDeliveryIds.push(row.delivery_id);
    }

    const created = handlers.createJob();
    if (created.existing) {
      db.prepare(
        `UPDATE webhook_deliveries
            SET status = 'received',
                job_id = NULL,
                lease_version = COALESCE(lease_version, 0) + 1
          WHERE delivery_id = ?
            AND lease_version = ?
            AND status = 'claimed'`,
      ).run(winner.delivery_id, leaseVersion);
      for (const deliveryId of coalescedDeliveryIds) {
        db.prepare(
          `UPDATE webhook_deliveries
              SET status = 'received',
                  job_id = NULL,
                  lease_version = COALESCE(lease_version, 0) + 1
            WHERE delivery_id = ?
              AND status = 'coalesced'`,
        ).run(deliveryId);
      }
      return null;
    }

    db.prepare(
      `UPDATE webhook_deliveries
          SET job_id = ?
        WHERE delivery_id = ?
          AND lease_version = ?
          AND status = 'claimed'`,
    ).run(created.jobId, winner.delivery_id, leaseVersion);
    for (const deliveryId of coalescedDeliveryIds) {
      db.prepare(
        `UPDATE webhook_deliveries
            SET job_id = ?
          WHERE delivery_id = ?
            AND status = 'coalesced'`,
      ).run(created.jobId, deliveryId);
    }

    return {
      jobId: created.jobId,
      deliveryId: winner.delivery_id,
      leaseVersion,
      coalescedDeliveryIds,
      beforeSha: oldest.before_sha,
      afterSha: winner.after_sha,
      ref: winner.ref,
    };
  })();
}
