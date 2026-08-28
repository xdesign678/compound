/**
 * Human review queue.
 *
 * Low-confidence summaries, large ingest changes, relation suggestions, or
 * conflict candidates are written here instead of being blindly applied.
 */
import { nanoid } from 'nanoid';
import {
  assertWritableRevision,
  DEFAULT_SERVER_REVISION,
  EntityNotFoundError,
  getServerDb,
  repo,
} from './server-db';
import { approveDerivedDraft, rejectDerivedDraft } from './query-provenance';
import type { ActivityLog } from './types';
import { wikiRepo, type ConceptRelationKind } from './wiki-db';

export type ReviewStatus = 'open' | 'approved' | 'rejected' | 'resolved';
export type ReviewKind =
  | 'low_confidence_summary'
  | 'large_ingest_change'
  | 'concept_merge_candidate'
  | 'relation_suggestion'
  | 'conflict'
  | 'manual'
  | 'concept_incorrect'
  | 'derived_draft';

export const REVIEW_KINDS: readonly ReviewKind[] = [
  'low_confidence_summary',
  'large_ingest_change',
  'concept_merge_candidate',
  'relation_suggestion',
  'conflict',
  'manual',
  'concept_incorrect',
  'derived_draft',
] as const;

export const CONCEPT_INCORRECT_KIND: ReviewKind = 'concept_incorrect';
export const DERIVED_DRAFT_KIND: ReviewKind = 'derived_draft';

export function isReviewKind(value: unknown): value is ReviewKind {
  return typeof value === 'string' && (REVIEW_KINDS as readonly string[]).includes(value);
}

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

function applyDerivedDraftReview(
  item: ReviewItem,
  status: Extract<ReviewStatus, 'approved' | 'rejected'>,
): Record<string, unknown> | null {
  if (item.kind !== DERIVED_DRAFT_KIND || item.target_type !== 'concept' || !item.target_id) {
    return null;
  }
  const concept =
    status === 'approved'
      ? approveDerivedDraft(item.target_id)
      : rejectDerivedDraft(item.target_id);
  if (!concept) return { applied: false, reason: 'derived draft concept not found' };
  return {
    applied: true,
    conceptId: concept.id,
    knowledgeStatus: concept.knowledgeStatus,
  };
}

function applyApprovedReviewItem(item: ReviewItem): Record<string, unknown> | null {
  if (item.kind === DERIVED_DRAFT_KIND) return applyDerivedDraftReview(item, 'approved');
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
  if (!repo.getConcept(sourceConceptId) || !repo.getConcept(targetConceptId)) {
    return { applied: false, reason: 'relation concept not found' };
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_review_items_open_concept_incorrect
      ON review_items(target_id)
      WHERE status = 'open' AND target_type = 'concept' AND kind = 'concept_incorrect';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_review_items_open_derived_draft
      ON review_items(target_id)
      WHERE status = 'open' AND target_type = 'concept' AND kind = 'derived_draft';
  `);
}

export function getReviewItem(id: string): ReviewItem | null {
  ensureReviewQueueSchema();
  return (
    (getServerDb().prepare(`SELECT * FROM review_items WHERE id = ?`).get(id) as
      | ReviewItem
      | undefined) ?? null
  );
}

export function findOpenConceptIncorrectReview(conceptId: string): ReviewItem | null {
  ensureReviewQueueSchema();
  if (!conceptId) return null;
  return (
    (getServerDb()
      .prepare(
        `SELECT * FROM review_items
          WHERE status = 'open'
            AND kind = 'concept_incorrect'
            AND target_type = 'concept'
            AND target_id = ?
          ORDER BY created_at ASC
          LIMIT 1`,
      )
      .get(conceptId) as ReviewItem | undefined) ?? null
  );
}

export interface FlagConceptIncorrectResult {
  created: boolean;
  review: ReviewItem;
  activity: ActivityLog | null;
}

/**
 * Create or reuse a server review item for a user-flagged concept.
 * Consecutive clicks on the same open concept do not create extra pending
 * reviews or extra activity. CAS, review insert, activity, and sync change
 * share one transaction.
 */
export function flagConceptIncorrect(input: {
  conceptId: string;
  expectedRevision?: number;
  cas?: boolean;
}): FlagConceptIncorrectResult {
  ensureReviewQueueSchema();
  const db = getServerDb();
  return db.transaction((): FlagConceptIncorrectResult => {
    const concept = repo.getConcept(input.conceptId);
    if (!concept) throw new EntityNotFoundError('concept', input.conceptId);

    const existing = findOpenConceptIncorrectReview(input.conceptId);
    if (existing) {
      const payload = parseReviewPayload<{ activityId?: string }>(existing.payload_json);
      const activity = payload?.activityId
        ? (repo.getActivityByIds([payload.activityId])[0] ?? null)
        : null;
      return { created: false, review: existing, activity };
    }

    const shouldCas = input.cas === true || input.expectedRevision !== undefined;
    if (shouldCas) {
      assertWritableRevision(
        'concept',
        input.conceptId,
        input.expectedRevision,
        concept.serverRevision ?? DEFAULT_SERVER_REVISION,
      );
    }

    const ts = now();
    const activity: ActivityLog = {
      id: `a-${nanoid(8)}`,
      type: 'lint',
      title: `标记有误：${concept.title}`,
      details: `用户手动标记概念 "${concept.title}" 需要审核`,
      status: 'success',
      relatedConceptIds: [concept.id],
      at: ts,
    };
    const reviewId = createReviewItem({
      kind: CONCEPT_INCORRECT_KIND,
      title: `标记有误：${concept.title}`,
      targetType: 'concept',
      targetId: concept.id,
      payload: { reason: 'user_flagged_incorrect', activityId: activity.id },
    });
    repo.insertActivity(activity);
    const review = getReviewItem(reviewId);
    if (!review) {
      throw new Error('failed to persist concept-incorrect review item');
    }
    return { created: true, review, activity };
  })();
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
  const db = getServerDb();
  return db
    .transaction((): ReviewItem | null => {
      const existing = db.prepare(`SELECT * FROM review_items WHERE id = ?`).get(id) as
        | ReviewItem
        | undefined;
      if (!existing) return null;
      if (existing.status !== 'open') return existing;

      const ts = now();
      const claim = db
        .prepare(
          `UPDATE review_items
           SET status = ?, resolution_json = ?, resolved_at = ?, updated_at = ?
           WHERE id = ? AND status = 'open'`,
        )
        .run(status, resolution === undefined ? null : JSON.stringify(resolution), ts, ts, id);
      if (claim.changes !== 1) {
        return (
          (db.prepare(`SELECT * FROM review_items WHERE id = ?`).get(id) as
            | ReviewItem
            | undefined) ?? existing
        );
      }

      const applied =
        status === 'approved'
          ? applyApprovedReviewItem(existing)
          : status === 'rejected' && existing.kind === DERIVED_DRAFT_KIND
            ? applyDerivedDraftReview(existing, 'rejected')
            : null;
      const resolutionPayload =
        applied && resolution && typeof resolution === 'object'
          ? { ...(resolution as Record<string, unknown>), application: applied }
          : applied
            ? { application: applied }
            : resolution;
      if (resolutionPayload !== undefined) {
        db.prepare(`UPDATE review_items SET resolution_json = ? WHERE id = ?`).run(
          JSON.stringify(resolutionPayload),
          id,
        );
      }
      return (
        (db.prepare(`SELECT * FROM review_items WHERE id = ?`).get(id) as ReviewItem | undefined) ??
        null
      );
    })
    .immediate();
}

export function reopenReviewItem(id: string, resolution?: unknown): ReviewItem | null {
  ensureReviewQueueSchema();
  const db = getServerDb();
  return db
    .transaction((): ReviewItem | null => {
      const existing = db.prepare(`SELECT * FROM review_items WHERE id = ?`).get(id) as
        | ReviewItem
        | undefined;
      if (!existing) return null;

      if (
        existing.status !== 'open' &&
        existing.kind === CONCEPT_INCORRECT_KIND &&
        existing.target_type === 'concept' &&
        existing.target_id
      ) {
        const alreadyOpen = findOpenConceptIncorrectReview(existing.target_id);
        if (alreadyOpen && alreadyOpen.id !== existing.id) return alreadyOpen;
      }

      const ts = now();
      db.prepare(
        `UPDATE review_items
         SET status = 'open', resolution_json = ?, resolved_at = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(resolution === undefined ? null : JSON.stringify(resolution), ts, id);
      return (
        (db.prepare(`SELECT * FROM review_items WHERE id = ?`).get(id) as ReviewItem | undefined) ??
        null
      );
    })
    .immediate();
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
