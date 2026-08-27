/**
 * Durable ingest operation keys. Same operationId + payload hash returns the
 * same persisted result; the same key with a different payload is a 409.
 *
 * Server-only.
 */
import { createHash } from 'node:crypto';
import { getServerDb } from './server-db';

export const INGEST_OPERATION_LEASE_MS = 5 * 60 * 1000;

export type IngestOperationStatus = 'processing' | 'succeeded' | 'failed';

export class IngestOperationHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'IngestOperationHttpError';
  }
}

export interface CanonicalIngestPayload {
  title: string;
  type: string;
  author?: string;
  url?: string;
  rawContent: string;
  externalKey?: string;
}

interface IngestOperationRow {
  operation_id: string;
  payload_hash: string;
  status: IngestOperationStatus;
  result_json: string | null;
  source_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  lease_until: number | null;
}

export function hashIngestPayload(input: CanonicalIngestPayload): string {
  const canonical = JSON.stringify({
    title: input.title,
    type: input.type,
    author: input.author ?? '',
    url: input.url ?? '',
    rawContent: input.rawContent,
    externalKey: input.externalKey ?? '',
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function beginIngestOperation(
  operationId: string,
  payloadHash: string,
  now = Date.now(),
): { kind: 'new' } | { kind: 'replay'; result: unknown } {
  const db = getServerDb();
  const existing = db
    .prepare(`SELECT * FROM ingest_operations WHERE operation_id = ?`)
    .get(operationId) as IngestOperationRow | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO ingest_operations(
        operation_id, payload_hash, status, result_json, source_id, error,
        created_at, updated_at, lease_until
      ) VALUES (?, ?, 'processing', NULL, NULL, NULL, ?, ?, ?)`,
    ).run(operationId, payloadHash, now, now, now + INGEST_OPERATION_LEASE_MS);
    return { kind: 'new' };
  }

  if (existing.payload_hash !== payloadHash) {
    throw new IngestOperationHttpError(
      'operationId already used with a different payload',
      409,
      'ingest_operation_conflict',
    );
  }

  if (existing.status === 'succeeded' && existing.result_json) {
    return { kind: 'replay', result: JSON.parse(existing.result_json) as unknown };
  }

  if (
    existing.status === 'processing' &&
    existing.lease_until !== null &&
    existing.lease_until > now
  ) {
    throw new IngestOperationHttpError(
      'operation is still processing',
      409,
      'ingest_operation_in_progress',
    );
  }

  db.prepare(
    `UPDATE ingest_operations
     SET status = 'processing', error = NULL, updated_at = ?, lease_until = ?
     WHERE operation_id = ?`,
  ).run(now, now + INGEST_OPERATION_LEASE_MS, operationId);
  return { kind: 'new' };
}

export function completeIngestOperation(
  operationId: string,
  result: { sourceId: string },
  now = Date.now(),
): void {
  const payload = JSON.stringify(result);
  const outcome = getServerDb()
    .prepare(
      `UPDATE ingest_operations
       SET status = 'succeeded', result_json = ?, source_id = ?, error = NULL,
           updated_at = ?, lease_until = NULL
       WHERE operation_id = ? AND status = 'processing'`,
    )
    .run(payload, result.sourceId, now, operationId);
  if (outcome.changes === 0) {
    throw new IngestOperationHttpError(
      'operation lease lost before success was recorded',
      409,
      'ingest_operation_lease_lost',
    );
  }
}

export function failIngestOperation(operationId: string, error: unknown, now = Date.now()): void {
  const message = error instanceof Error ? error.message : String(error);
  getServerDb()
    .prepare(
      `UPDATE ingest_operations
       SET status = 'failed', error = ?, updated_at = ?, lease_until = NULL
       WHERE operation_id = ? AND status = 'processing'`,
    )
    .run(message.slice(0, 500), now, operationId);
}
