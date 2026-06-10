import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import { normalizeCategoryState } from '@/lib/category-normalization';
import { escapeHTML } from '@/lib/format';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';
import { requireAdmin } from '@/lib/server-auth';
import { getServerDb, repo } from '@/lib/server-db';
import { compileConceptArtifactsAfterManualChange } from '@/lib/wiki-compiler';
import type { ActivityLog, Concept } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BODY_BYTES = 256_000;
const MAX_TITLE_CHARS = 80;
const MAX_SUMMARY_CHARS = 240;
const MAX_ANSWER_CHARS = 60_000;
const MAX_CITED_CONCEPTS = 80;

function clampString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, MAX_CITED_CONCEPTS),
    ),
  );
}

/**
 * Archive an Ask answer as a first-class server Wiki concept. The new concept
 * is linked to the cited concepts, indexed into FTS, versioned, and mirrored
 * back to the caller with all touched related concepts.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await readJsonWithLimit<Record<string, unknown>>(req, MAX_BODY_BYTES);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    body = {};
  }
  const title = clampString(body.title, MAX_TITLE_CHARS) || '新归档概念';
  const summary = clampString(body.summary, MAX_SUMMARY_CHARS) || title;
  const answerBody = clampString(body.body, MAX_ANSWER_CHARS);
  const citedConceptIds = normalizeIds(body.citedConceptIds);

  if (!answerBody) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }
  if (citedConceptIds.length === 0) {
    return NextResponse.json({ error: 'citedConceptIds is required' }, { status: 400 });
  }

  const citedConcepts = repo.getConceptsByIds(citedConceptIds);
  const validCitedIds = citedConcepts.map((concept) => concept.id);
  if (validCitedIds.length === 0) {
    return NextResponse.json({ error: 'no cited concepts found' }, { status: 404 });
  }

  const now = Date.now();
  const conceptId = `c-${nanoid(8)}`;
  const { categories, categoryKeys } = normalizeCategoryState({ categories: [] });
  const concept: Concept = {
    id: conceptId,
    title,
    summary,
    body: answerBody,
    sources: [],
    related: validCitedIds,
    categories,
    categoryKeys,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const citedById = new Map(citedConcepts.map((item) => [item.id, item]));
  const relatedUpdates: Concept[] = [];
  for (const relatedId of validCitedIds) {
    const related = citedById.get(relatedId);
    if (!related || related.related.includes(conceptId)) continue;
    relatedUpdates.push({
      ...related,
      related: [...related.related, conceptId],
      updatedAt: now,
    });
  }

  const activity: ActivityLog = {
    id: `a-${nanoid(8)}`,
    type: 'query',
    title: `归档问答为新概念 <em>${escapeHTML(title)}</em>`,
    details: `基于 ${validCitedIds.length} 个现有概念综合生成`,
    relatedConceptIds: [conceptId, ...validCitedIds],
    at: now,
  };

  const trx = getServerDb().transaction(() => {
    repo.upsertConcept(concept);
    for (const update of relatedUpdates) repo.upsertConcept(update);
    compileConceptArtifactsAfterManualChange({
      createdConcepts: [concept],
      updatedConcepts: relatedUpdates
        .map((next) => {
          const previous = citedById.get(next.id);
          return previous ? { previous, next } : null;
        })
        .filter((item): item is { previous: Concept; next: Concept } => Boolean(item)),
      sourceIds: [],
      changeSummary: `归档问答为「${title}」。`,
    });
    repo.insertActivity(activity);
  });
  trx();

  return NextResponse.json({
    conceptId,
    concepts: repo.getConceptsByIds([conceptId, ...validCitedIds]),
    activity,
  });
}
