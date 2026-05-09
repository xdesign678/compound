/**
 * Human review queue.
 *
 * Low-confidence summaries, large ingest changes, relation suggestions, or
 * conflict candidates are written here instead of being blindly applied.
 */
import { nanoid } from 'nanoid';
import { getServerDb } from './server-db';
import { wikiRepo, type ConceptRelationKind } from './wiki-db';

export type ReviewStatus = 'open' | 'approved' | 'rejected' | 'resolved';
export type ReviewKind =
  | 'low_confidence_summary'
  | 'large_ingest_change'
  | 'concept_merge_candidate'
  | 'relation_suggestion'
  | 'conflict'
  | 'manual';

export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  status: ReviewStatus;
  title: string;
  target_type: string | null;
  target_id: string | null;
  source_id: string | null;
  confidence: number | null;
  payload_json: string | null;
  resolution_json: string | null;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
}

let schemaReady = false;

function now(): number {
  return Date.now();
}

function parseReviewPayload<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeRelationKind(value: unknown): ConceptRelationKind {
  if (value === 'supports') return 'supports';
  if (value === 'extends') return 'extends';
  if (value === 'depends_on') return 'depends_on';
  if (value === 'example_of') return 'example_of';
  if (value === 'similar_to') return 'similar_to';
  if (value === 'contradicts') return 'contradicts';
  if (value === 'same_as') return 'same_as';
  return 'related';
}

function applyApprovedReviewItem(item: ReviewItem): Record<string, unknown> | null {
  if (item.kind !== 'relation_suggestion') return null;
  const payload = parseReviewPayload<{
    sourceConceptId?: string;
    targetConceptId?: string;
    kind?: string;
    reason?: string;
    confidence?: number;
  }>(item.payload_json);
  const sourceConceptId = payload?.sourceConceptId?.trim() || '';
  const targetConceptId = payload?.targetConceptId?.trim() || '';
  if (!sourceConceptId || !targetConceptId || sourceConceptId === targetConceptId) {
    return { applied: false, reason: 'invalid relation payload' };
  }
  const relation = wikiRepo.upsertConceptRelation({
    sourceConceptId,
    targetConceptId,
    kind: normalizeRelationKind(payload?.kind),
    reason: payload?.reason,
    confidence:
      typeof payload?.confidence === 'number' ? Math.max(0, Math.min(1, payload.confidence)) : 0.6,
  });
  const concepts = wikiRepo.linkConceptPair(sourceConceptId, targetConceptId);
  return {
    applied: Boolean(relation),
    relationId: relation?.id,
    touchedConceptIds: concepts.map((concept) => concept.id),
  };
}

export function ensureReviewQueueSchema(): void {
  if (schemaReady) return;
  getServerDb().exec(`
    CREATE TABLE IF NOT EXISTS review_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      title TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      source_id TEXT,
      confidence REAL,
      payload_json TEXT,
      resolution_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_review_items_status_created ON review_items(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_review_items_kind_status ON review_items(kind, status);
    CREATE INDEX IF NOT EXISTS idx_review_items_source ON review_items(source_id);
  `);
  schemaReady = true;
}

export function createReviewItem(input: {
  kind: ReviewKind;
  title: string;
  targetType?: string | null;
  targetId?: string | null;
  sourceId?: string | null;
  confidence?: number | null;
  payload?: unknown;
}): string {
  ensureReviewQueueSchema();
  const ts = now();
  const id = `rv-${nanoid(10)}`;
  getServerDb()
    .prepare(
      `INSERT INTO review_items
        (id, kind, status, title, target_type, target_id, source_id, confidence, payload_json, created_at, updated_at)
       VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.kind,
      input.title,
      input.targetType ?? null,
      input.targetId ?? null,
      input.sourceId ?? null,
      input.confidence ?? null,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      ts,
      ts,
    );
  return id;
}

export function listReviewItems(
  options: { status?: ReviewStatus | 'all'; limit?: number } = {},
): ReviewItem[] {
  ensureReviewQueueSchema();
  const status = options.status || 'open';
  const limit = Math.max(1, Math.min(500, options.limit || 100));
  if (status === 'all') {
    return getServerDb()
      .prepare(`SELECT * FROM review_items ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as ReviewItem[];
  }
  return getServerDb()
    .prepare(`SELECT * FROM review_items WHERE status = ? ORDER BY created_at DESC LIMIT ?`)
    .all(status, limit) as ReviewItem[];
}

export function resolveReviewItem(
  id: string,
  status: Extract<ReviewStatus, 'approved' | 'rejected' | 'resolved'>,
  resolution?: unknown,
): ReviewItem | null {
  ensureReviewQueueSchema();
  const existing = getServerDb().prepare(`SELECT * FROM review_items WHERE id = ?`).get(id) as
    | ReviewItem
    | undefined;
  if (!existing) return null;

  const ts = now();
  const applied =
    status === 'approved' && existing.status === 'open' ? applyApprovedReviewItem(existing) : null;
  const resolutionPayload =
    applied && resolution && typeof resolution === 'object'
      ? { ...(resolution as Record<string, unknown>), application: applied }
      : applied
        ? { application: applied }
        : resolution;
  getServerDb()
    .prepare(
      `UPDATE review_items
       SET status = ?, resolution_json = ?, resolved_at = ?, updated_at = ?
       WHERE id = ? AND status = 'open'`,
    )
    .run(
      status,
      resolutionPayload === undefined ? null : JSON.stringify(resolutionPayload),
      ts,
      ts,
      id,
    );
  return (
    (getServerDb().prepare(`SELECT * FROM review_items WHERE id = ?`).get(id) as
      | ReviewItem
      | undefined) ?? null
  );
}

export function reopenReviewItem(id: string, resolution?: unknown): ReviewItem | null {
  ensureReviewQueueSchema();
  const existing = getServerDb().prepare(`SELECT * FROM review_items WHERE id = ?`).get(id) as
    | ReviewItem
    | undefined;
  if (!existing) return null;

  const ts = now();
  getServerDb()
    .prepare(
      `UPDATE review_items
       SET status = 'open', resolution_json = ?, resolved_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(resolution === undefined ? null : JSON.stringify(resolution), ts, id);
  return (
    (getServerDb().prepare(`SELECT * FROM review_items WHERE id = ?`).get(id) as
      | ReviewItem
      | undefined) ?? null
  );
}

export function getReviewMetrics(): Record<string, number> {
  ensureReviewQueueSchema();
  const scalar = (sql: string) =>
    Number((getServerDb().prepare(sql).get() as { count?: number } | undefined)?.count ?? 0);
  return {
    reviewOpen: scalar(`SELECT COUNT(*) AS count FROM review_items WHERE status = 'open'`),
    reviewResolved: scalar(
      `SELECT COUNT(*) AS count FROM review_items WHERE status IN ('approved', 'rejected', 'resolved')`,
    ),
  };
}
