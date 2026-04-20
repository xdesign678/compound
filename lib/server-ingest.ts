/**
 * Server-side ingest pipeline.
 *
 * Called by the GitHub sync runner. Mirrors the client-side `ingestSource`
 * in `lib/api-client.ts`, but writes to SQLite instead of IndexedDB.
 *
 * Must never be imported from client code.
 */

import { nanoid } from 'nanoid';
import { repo, getServerDb } from './server-db';
import { runIngestLLM } from './ingest-core';
import type {
  Source,
  Concept,
  ActivityLog,
  SourceType,
} from './types';

export interface ServerIngestInput {
  title: string;
  type: SourceType;
  author?: string;
  url?: string;
  rawContent: string;
  externalKey?: string;
}

export interface ServerIngestResult {
  sourceId: string;
  newConceptIds: string[];
  updatedConceptIds: string[];
  activityId: string;
}

export async function ingestSourceToServerDb(
  input: ServerIngestInput
): Promise<ServerIngestResult> {
  const now = Date.now();

  // 1. Build Source
  const source: Source = {
    id: 's-' + nanoid(8),
    title: input.title.trim(),
    type: input.type,
    author: input.author?.trim() || undefined,
    url: input.url?.trim() || undefined,
    rawContent: input.rawContent,
    ingestedAt: now,
    externalKey: input.externalKey,
  };

  // 2. Gather existing concepts for LLM context
  const allConcepts = repo.listConcepts();

  // 3. Call LLM (no DB writes yet)
  const resp = await runIngestLLM({
    source: {
      title: source.title,
      type: source.type,
      author: source.author,
      url: source.url,
      rawContent: source.rawContent,
    },
    existingConcepts: allConcepts.map((c) => ({
      id: c.id,
      title: c.title,
      summary: c.summary,
    })),
    // llmConfig omitted → falls through to server env (LLM_API_KEY etc.)
  });

  // 4. Compose new concepts
  const newConceptIds: string[] = [];
  const newConcepts: Concept[] = resp.newConcepts.map((nc) => {
    const id = 'c-' + nanoid(8);
    newConceptIds.push(id);
    return {
      id,
      title: nc.title.trim(),
      summary: nc.summary.trim(),
      body: nc.body,
      sources: [source.id],
      related: nc.relatedConceptIds || [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
  });

  // 5. Compute updates to existing concepts
  const conceptById = new Map(allConcepts.map((c) => [c.id, c]));
  const updatedConceptIds: string[] = [];
  const updatedConceptDocs: Concept[] = [];
  for (const upd of resp.updatedConcepts) {
    const c = conceptById.get(upd.id);
    if (!c) continue;
    const sources = c.sources.includes(source.id) ? c.sources : [...c.sources, source.id];
    const related = new Set(c.related);
    (upd.addRelatedIds || []).forEach((r) => related.add(r));
    updatedConceptDocs.push({
      ...c,
      body: upd.newBody || c.body,
      summary: upd.newSummary || c.summary,
      sources,
      related: Array.from(related),
      updatedAt: now,
      version: c.version + 1,
    });
    updatedConceptIds.push(c.id);
  }

  // 6. Bidirectional links for new concepts (relatedConceptIds points to existing)
  const biDirUpdates: Array<{ id: string; related: string[] }> = [];
  for (const nc of newConcepts) {
    for (const relId of nc.related) {
      const c = conceptById.get(relId);
      if (c && !c.related.includes(nc.id)) {
        biDirUpdates.push({ id: relId, related: [...c.related, nc.id] });
      }
    }
  }

  // 7. Activity log
  const activity: ActivityLog = {
    id: 'a-' + nanoid(8),
    type: 'ingest',
    title: `摄入 <em>${escapeHTML(source.title)}</em>`,
    details: resp.activitySummary,
    relatedSourceIds: [source.id],
    relatedConceptIds: [...newConceptIds, ...updatedConceptIds],
    at: now,
  };

  // 8. Write everything in a single transaction (better-sqlite3 is synchronous)
  const trx = getServerDb().transaction(() => {
    // Remove any existing source that shares the same externalKey (GitHub "update" case)
    if (source.externalKey) {
      const existing = repo.getSourceByExternalKey(source.externalKey);
      if (existing && existing.id !== source.id) {
        repo.deleteSource(existing.id);
      }
    }
    repo.insertSource(source);

    for (const next of updatedConceptDocs) {
      repo.upsertConcept(next);
    }
    for (const nc of newConcepts) {
      repo.upsertConcept(nc);
    }
    for (const upd of biDirUpdates) {
      const c = conceptById.get(upd.id);
      if (!c) continue;
      repo.upsertConcept({ ...c, related: upd.related, updatedAt: now });
    }

    repo.insertActivity(activity);
  });
  trx();

  return {
    sourceId: source.id,
    newConceptIds,
    updatedConceptIds,
    activityId: activity.id,
  };
}

function escapeHTML(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string
  );
}
