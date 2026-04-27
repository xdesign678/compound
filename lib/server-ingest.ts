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
import { normalizeCategoryKeys, normalizeCategoryState } from './category-normalization';
import { runIngestLLM } from './ingest-core';
import { compileWikiArtifactsAfterIngest } from './wiki-compiler';
import { wikiRepo } from './wiki-db';
import type { Source, Concept, ActivityLog, SourceType, LlmConfig } from './types';

export interface ServerIngestInput {
  title: string;
  type: SourceType;
  author?: string;
  url?: string;
  rawContent: string;
  externalKey?: string;
  replaceSourceId?: string;
  llmConfig?: LlmConfig;
}

export interface ServerIngestResult {
  sourceId: string;
  newConceptIds: string[];
  updatedConceptIds: string[];
  activityId: string;
  source: Source;
  concepts: Concept[];
  activity: ActivityLog;
  compiler?: {
    chunks: number;
    evidence: number;
    conceptsIndexed: number;
    versions: number;
  };
}

export async function ingestSourceToServerDb(
  input: ServerIngestInput,
): Promise<ServerIngestResult> {
  const now = Date.now();
  const exactExisting = input.externalKey ? repo.getSourceByExternalKey(input.externalKey) : null;
  const sourceIdToReplace =
    input.replaceSourceId && input.replaceSourceId.trim()
      ? input.replaceSourceId.trim()
      : exactExisting?.id;

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
  const candidateConcepts = repo.findConceptCandidates(
    `${source.title}\n${source.rawContent.slice(0, 4000)}`,
    320,
  );
  const existingCategories = normalizeCategoryKeys(repo.listCategoryKeys());

  // 3. Call LLM (no DB writes yet)
  const resp = await runIngestLLM({
    source: {
      title: source.title,
      type: source.type,
      author: source.author,
      url: source.url,
      rawContent: source.rawContent,
    },
    existingConcepts: candidateConcepts.map((c) => ({
      id: c.id,
      title: c.title,
      summary: c.summary,
    })),
    existingCategories,
    llmConfig: input.llmConfig,
  });

  // 4. Compose new concepts
  const newConceptIds: string[] = [];
  const newConcepts: Concept[] = resp.newConcepts.map((nc) => {
    const id = 'c-' + nanoid(8);
    const { categories, categoryKeys } = normalizeCategoryState({
      categories: nc.categories || [],
    });
    newConceptIds.push(id);
    return {
      id,
      title: nc.title.trim(),
      summary: nc.summary.trim(),
      body: nc.body,
      sources: [source.id],
      related: nc.relatedConceptIds || [],
      categories,
      categoryKeys,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
  });

  // 5. Compute updates to existing concepts
  const referencedConceptIds = Array.from(
    new Set([
      ...resp.updatedConcepts.map((upd) => upd.id),
      ...newConcepts.flatMap((concept) => concept.related),
    ]),
  );
  const conceptById = new Map(repo.getConceptsByIds(referencedConceptIds).map((c) => [c.id, c]));
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
  const nextConceptById = new Map(conceptById);
  for (const next of updatedConceptDocs) {
    nextConceptById.set(next.id, next);
  }

  const biDirUpdates: Array<{ id: string; related: string[] }> = [];
  for (const nc of newConcepts) {
    for (const relId of nc.related) {
      const c = nextConceptById.get(relId);
      if (c && !c.related.includes(nc.id)) {
        const related = [...c.related, nc.id];
        biDirUpdates.push({ id: relId, related });
        nextConceptById.set(relId, { ...c, related, updatedAt: now });
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

  let compilerResult: ServerIngestResult['compiler'];

  // 8. Write everything in a single transaction (better-sqlite3 is synchronous)
  const trx = getServerDb().transaction(() => {
    repo.insertSource(source);

    for (const next of updatedConceptDocs) {
      repo.upsertConcept(next);
    }
    for (const nc of newConcepts) {
      repo.upsertConcept(nc);
    }
    for (const upd of biDirUpdates) {
      const c = nextConceptById.get(upd.id);
      if (!c) continue;
      repo.upsertConcept({ ...c, related: upd.related, updatedAt: now });
    }

    if (sourceIdToReplace && sourceIdToReplace !== source.id) {
      repo.replaceSourceIdInConcepts(sourceIdToReplace, source.id, now);
      wikiRepo.deleteSourceArtifacts(sourceIdToReplace);
      repo.deleteSource(sourceIdToReplace);
    }

    compilerResult = compileWikiArtifactsAfterIngest({
      source,
      createdConcepts: newConcepts,
      updatedConcepts: updatedConceptDocs
        .map((next) => {
          const previous = conceptById.get(next.id);
          return previous ? { previous, next } : null;
        })
        .filter((pair): pair is { previous: Concept; next: Concept } => Boolean(pair)),
      activitySummary: resp.activitySummary,
    });

    repo.insertActivity(activity);
  });
  trx();

  const affectedConceptIds = Array.from(
    new Set([...newConceptIds, ...updatedConceptIds, ...biDirUpdates.map((update) => update.id)]),
  );

  return {
    sourceId: source.id,
    newConceptIds,
    updatedConceptIds,
    activityId: activity.id,
    source: repo.getSource(source.id) ?? source,
    concepts: repo.getConceptsByIds(affectedConceptIds),
    activity,
    compiler: compilerResult,
  };
}

function escapeHTML(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
