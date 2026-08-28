/**
 * Durable ingest operation keys. Same operationId + payload hash returns the
 * same persisted result; the same key with a different payload is a 409.
 *
 * Server-only.
 */
import { createHash } from 'node:crypto';
import { getServerDb, repo } from './server-db';
import type { ActivityLog, Concept, Source } from './types';

export const INGEST_OPERATION_LEASE_MS = 5 * 60 * 1000;
export const INGEST_OPERATION_ID_PATTERN = /^op-[A-Za-z0-9_-]{8,64}$/;

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
  model?: string;
  apiUrl?: string;
  keyFingerprint?: string;
}

export interface CompactIngestResult {
  v: 1;
  sourceId: string;
  newConceptIds: string[];
  updatedConceptIds: string[];
  activityId: string;
}

export interface HydratedIngestResult {
  sourceId: string;
  newConceptIds: string[];
  updatedConceptIds: string[];
  activityId: string;
  source: Source | null;
  concepts: Concept[];
  activity: ActivityLog | null;
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
  attempt_token: number | null;
}

export function assertValidOperationId(operationId: string): void {
  if (!INGEST_OPERATION_ID_PATTERN.test(operationId)) {
    throw new IngestOperationHttpError('invalid operationId', 400, 'invalid_operation_id');
  }
}

export function hashIngestPayload(input: CanonicalIngestPayload): string {
  const canonical = JSON.stringify({
    title: input.title,
    type: input.type,
    author: input.author ?? '',
    url: input.url ?? '',
    rawContent: input.rawContent,
    externalKey: input.externalKey ?? '',
    model: input.model ?? '',
    apiUrl: input.apiUrl ?? '',
    keyFingerprint: input.keyFingerprint ?? '',
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function compactIngestResult(result: {
  sourceId: string;
  newConceptIds?: string[];
  updatedConceptIds?: string[];
  activityId?: string;
}): CompactIngestResult {
  return {
    v: 1,
    sourceId: result.sourceId,
    newConceptIds: [...(result.newConceptIds ?? [])],
    updatedConceptIds: [...(result.updatedConceptIds ?? [])],
    activityId: result.activityId ?? '',
  };
}

export function hydrateIngestResult(result: unknown): HydratedIngestResult {
  const compact = parseCompactResult(result);
  const conceptIds = [...compact.newConceptIds, ...compact.updatedConceptIds];
  const source = compact.sourceId ? repo.getSource(compact.sourceId) : null;
  const concepts = conceptIds.length > 0 ? repo.getConceptsByIds(conceptIds) : [];
  const activity = compact.activityId
    ? (repo.getActivityByIds([compact.activityId])[0] ?? null)
    : null;
  return {
    ...compact,
    source,
    concepts,
    activity,
  };
}

function parseCompactResult(result: unknown): CompactIngestResult {
  if (!result || typeof result !== 'object') {
    return { v: 1, sourceId: '', newConceptIds: [], updatedConceptIds: [], activityId: '' };
  }
  const record = result as Record<string, unknown>;
  if (typeof record.sourceId === 'string' && record.v === 1) {
    return {
      v: 1,
      sourceId: record.sourceId,
      newConceptIds: Array.isArray(record.newConceptIds)
        ? record.newConceptIds.filter((id): id is string => typeof id === 'string')
        : [],
      updatedConceptIds: Array.isArray(record.updatedConceptIds)
        ? record.updatedConceptIds.filter((id): id is string => typeof id === 'string')
        : [],
      activityId: typeof record.activityId === 'string' ? record.activityId : '',
    };
  }
  if (typeof record.sourceId === 'string') {
    return compactIngestResult({
      sourceId: record.sourceId,
      newConceptIds: Array.isArray(record.newConceptIds)
        ? record.newConceptIds.filter((id): id is string => typeof id === 'string')
        : [],
      updatedConceptIds: Array.isArray(record.updatedConceptIds)
        ? record.updatedConceptIds.filter((id): id is string => typeof id === 'string')
        : [],
      activityId: typeof record.activityId === 'string' ? record.activityId : '',
    });
  }
  const nestedSource = record.source as { id?: unknown } | undefined;
  if (nestedSource && typeof nestedSource.id === 'string') {
    return compactIngestResult({
      sourceId: nestedSource.id,
      newConceptIds: Array.isArray(record.newConceptIds)
        ? record.newConceptIds.filter((id): id is string => typeof id === 'string')
        : [],
      updatedConceptIds: Array.isArray(record.updatedConceptIds)
        ? record.updatedConceptIds.filter((id): id is string => typeof id === 'string')
        : [],
      activityId:
        typeof record.activityId === 'string'
          ? record.activityId
          : typeof (record.activity as { id?: unknown } | undefined)?.id === 'string'
            ? String((record.activity as { id: string }).id)
            : '',
    });
  }
  return { v: 1, sourceId: '', newConceptIds: [], updatedConceptIds: [], activityId: '' };
}

function ensureIngestOperationSchema(): void {
  const db = getServerDb();
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(ingest_operations)`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  if (!columns.has('attempt_token')) {
    db.exec(`ALTER TABLE ingest_operations ADD COLUMN attempt_token INTEGER NOT NULL DEFAULT 0`);
  }
}

export function beginIngestOperation(
  operationId: string,
  payloadHash: string,
  now = Date.now(),
): { kind: 'new'; attemptToken: number } | { kind: 'replay'; result: HydratedIngestResult } {
  assertValidOperationId(operationId);
  ensureIngestOperationSchema();
  const db = getServerDb();
  const existing = db
    .prepare(`SELECT * FROM ingest_operations WHERE operation_id = ?`)
    .get(operationId) as IngestOperationRow | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO ingest_operations(
        operation_id, payload_hash, status, result_json, source_id, error,
        created_at, updated_at, lease_until, attempt_token
      ) VALUES (?, ?, 'processing', NULL, NULL, NULL, ?, ?, ?, 1)`,
    ).run(operationId, payloadHash, now, now, now + INGEST_OPERATION_LEASE_MS);
    return { kind: 'new', attemptToken: 1 };
  }

  if (existing.payload_hash !== payloadHash) {
    throw new IngestOperationHttpError(
      'operationId already used with a different payload',
      409,
      'ingest_operation_conflict',
    );
  }

  if (existing.status === 'succeeded' && existing.result_json) {
    return {
      kind: 'replay',
      result: hydrateIngestResult(JSON.parse(existing.result_json) as unknown),
    };
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

  const updated = db
    .prepare(
      `UPDATE ingest_operations
       SET status = 'processing', error = NULL, updated_at = ?, lease_until = ?,
           attempt_token = COALESCE(attempt_token, 0) + 1
       WHERE operation_id = ?
       RETURNING attempt_token`,
    )
    .get(now, now + INGEST_OPERATION_LEASE_MS, operationId) as { attempt_token: number };
  return { kind: 'new', attemptToken: updated.attempt_token };
}

export function completeIngestOperation(
  operationId: string,
  result: {
    sourceId: string;
    newConceptIds?: string[];
    updatedConceptIds?: string[];
    activityId?: string;
  },
  attemptToken: number,
  now = Date.now(),
): void {
  ensureIngestOperationSchema();
  const compact = compactIngestResult(result);
  const payload = JSON.stringify(compact);
  const outcome = getServerDb()
    .prepare(
      `UPDATE ingest_operations
       SET status = 'succeeded', result_json = ?, source_id = ?, error = NULL,
           updated_at = ?, lease_until = NULL
       WHERE operation_id = ? AND status = 'processing' AND attempt_token = ?`,
    )
    .run(payload, compact.sourceId, now, operationId, attemptToken);
  if (outcome.changes === 0) {
    throw new IngestOperationHttpError(
      'operation lease lost before success was recorded',
      409,
      'ingest_operation_lease_lost',
    );
  }
}

export function failIngestOperation(
  operationId: string,
  error: unknown,
  attemptToken?: number,
  now = Date.now(),
): void {
  ensureIngestOperationSchema();
  const message = error instanceof Error ? error.message : String(error);
  if (typeof attemptToken !== 'number') return;
  getServerDb()
    .prepare(
      `UPDATE ingest_operations
       SET status = 'failed', error = ?, updated_at = ?, lease_until = NULL
       WHERE operation_id = ? AND status = 'processing' AND attempt_token = ?`,
    )
    .run(message.slice(0, 500), now, operationId, attemptToken);
}

export function readIngestOperationRow(operationId: string): IngestOperationRow | undefined {
  ensureIngestOperationSchema();
  return getServerDb()
    .prepare(`SELECT * FROM ingest_operations WHERE operation_id = ?`)
    .get(operationId) as IngestOperationRow | undefined;
}
