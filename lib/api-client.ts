import { nanoid } from 'nanoid';
import { getDb } from './db';
import { ensureConceptsHydrated } from './cloud-sync';
import { normalizeCategoryKeys, normalizeCategoryState } from './category-normalization';
import { getLlmConfig } from './llm-config';
import type {
  Source,
  Concept,
  ActivityLog,
  IngestRequest,
  IngestResponse,
  QueryRequest,
  QueryResponse,
  LintRequest,
  LintResponse,
  CategorizeRequest,
  CategorizeResponse,
  SourceType,
} from './types';

const CLIENT_CANDIDATE_LIMIT = 320;
const QUERY_CANDIDATE_LIMIT = 50;

function extractSearchTerms(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/i)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2)
    )
  ).slice(0, 12);
}

async function findClientConceptCandidates(
  searchText: string,
  limit: number = CLIENT_CANDIDATE_LIMIT
): Promise<Concept[]> {
  const db = getDb();
  const keywords = extractSearchTerms(searchText);
  const collection = db.concepts.orderBy('updatedAt').reverse();

  if (keywords.length === 0) {
    return collection.limit(limit).toArray();
  }

  const matched = await collection
    .filter((concept) => {
      const haystack = `${concept.title}\n${concept.summary}`.toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword));
    })
    .limit(limit)
    .toArray();

  if (matched.length >= Math.min(limit, 80)) {
    return matched;
  }

  const fallback = await collection.limit(limit * 2).toArray();
  const seen = new Set(matched.map((concept) => concept.id));
  return [...matched, ...fallback.filter((concept) => !seen.has(concept.id))].slice(0, limit);
}

async function addBidirectionalLinks(db: ReturnType<typeof getDb>, sourceId: string, relatedIds: string[], now: number) {
  const fetched = await db.concepts.bulkGet(relatedIds);
  await db.transaction('rw', db.concepts, async () => {
    for (let i = 0; i < relatedIds.length; i++) {
      const c = fetched[i];
      if (c && !c.related.includes(sourceId)) {
        await db.concepts.update(relatedIds[i], { related: [...c.related, sourceId], updatedAt: now });
      }
    }
  });
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const llmConfig = getLlmConfig();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Send via headers (fast path)
  if (llmConfig.apiKey) headers['X-User-Api-Key'] = llmConfig.apiKey;
  if (llmConfig.apiUrl) headers['X-User-Api-Url'] = llmConfig.apiUrl;
  if (llmConfig.model) headers['X-User-Model'] = llmConfig.model;
  // Also embed in body as fallback (some proxies strip custom headers)
  const hasConfig = !!(llmConfig.apiKey || llmConfig.model || llmConfig.apiUrl);
  const payload = hasConfig
    ? { ...(body as object), llmConfig }
    : body;
  const res = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Read all unique categoryKeys from Dexie for prompt injection. */
export async function getExistingCategories(): Promise<string[]> {
  const db = getDb();
  const keys = await db.concepts.orderBy('categoryKeys').uniqueKeys();
  return normalizeCategoryKeys(keys.map((key) => String(key))).sort();
}

/**
 * Ingest pipeline: save source → call /api/ingest → apply new+updated concepts to Dexie → log activity.
 * Returns the ids of newly created concepts (for "fresh" badging).
 */
export async function ingestSource(input: {
  title: string;
  type: SourceType;
  author?: string;
  url?: string;
  rawContent: string;
  externalKey?: string;
}): Promise<{ sourceId: string; newConceptIds: string[]; updatedConceptIds: string[]; activityId: string }> {
  const db = getDb();
  const now = Date.now();

  // 1. Build source record (will be written inside transaction later)
  const source: Source = {
    id: 's-' + nanoid(8),
    title: input.title.trim(),
    type: input.type,
    author: input.author?.trim() || undefined,
    url: input.url?.trim() || undefined,
    rawContent: input.rawContent,
    ingestedAt: now,
    contentStatus: 'full',
    externalKey: input.externalKey,
  };

  // 2. Gather existing concepts
  const existing = await findClientConceptCandidates(
    `${source.title}\n${source.rawContent.slice(0, 4000)}`,
    CLIENT_CANDIDATE_LIMIT
  );
  const req: IngestRequest = {
    source: {
      title: source.title,
      type: source.type,
      author: source.author,
      url: source.url,
      rawContent: source.rawContent,
    },
    existingConcepts: existing.map((c) => ({ id: c.id, title: c.title, summary: c.summary })),
  };

  // Inject existing categories for LLM reference (derived from already-fetched existing concepts)
  const existingCategories = normalizeCategoryKeys(
    existing.flatMap((c) => c.categoryKeys || [])
  ).sort();
  const reqWithCategories = { ...req, existingCategories };

  // 3. Call API
  const resp = await postJSON<IngestResponse>('/api/ingest', reqWithCategories);

  // 4. Build new concepts list (pure computation, no DB writes yet)
  const newConceptIds: string[] = [];
  const newConcepts: Concept[] = resp.newConcepts.map((nc) => {
    const id = 'c-' + nanoid(8);
    newConceptIds.push(id);
    const { categories, categoryKeys } = normalizeCategoryState({ categories: nc.categories || [] });
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
      contentStatus: 'full',
      categories,
      categoryKeys,
    };
  });

  // 5. Pre-fetch existing concepts to update (bulk read before transaction)
  const updatedConceptIds: string[] = [];
  const updatedConceptDocs: Concept[] = [];
  const updIds = resp.updatedConcepts.map((u) => u.id);
  const updFetched = await db.concepts.bulkGet(updIds);
  for (let i = 0; i < resp.updatedConcepts.length; i++) {
    const upd = resp.updatedConcepts[i];
    const c = updFetched[i];
    if (!c) continue;
    const sources = c.sources.includes(source.id) ? c.sources : [...c.sources, source.id];
    const related = new Set(c.related);
    (upd.addRelatedIds || []).forEach((r) => related.add(r));
    const next: Concept = {
      ...c,
      body: upd.newBody || c.body,
      summary: upd.newSummary || c.summary,
      sources,
      related: Array.from(related),
      updatedAt: now,
      version: c.version + 1,
      contentStatus: 'full',
    };
    updatedConceptDocs.push(next);
    updatedConceptIds.push(c.id);
  }

  // Pre-fetch concepts that need bidirectional link updates (bulk read)
  const biDirRelIds = Array.from(new Set(newConcepts.flatMap((nc) => nc.related)));
  const biDirFetched = await db.concepts.bulkGet(biDirRelIds);
  const biDirMap = new Map<string, Concept>();
  biDirRelIds.forEach((rid, i) => { if (biDirFetched[i]) biDirMap.set(rid, biDirFetched[i]!); });

  const biDirUpdates: Array<{ id: string; related: string[] }> = [];
  for (const nc of newConcepts) {
    for (const relId of nc.related) {
      const c = biDirMap.get(relId);
      if (c && !c.related.includes(nc.id)) {
        biDirUpdates.push({ id: relId, related: [...c.related, nc.id] });
      }
    }
  }

  // Build activity log record
  const activity: ActivityLog = {
    id: 'a-' + nanoid(8),
    type: 'ingest',
    title: `摄入 <em>${escapeHTML(source.title)}</em>`,
    details: resp.activitySummary,
    relatedSourceIds: [source.id],
    relatedConceptIds: [...newConceptIds, ...updatedConceptIds],
    at: now,
  };

  // 6-8. All writes wrapped in a single Dexie transaction
  await db.transaction('rw', [db.sources, db.concepts, db.activity], async () => {
    // Save source
    await db.sources.put(source);

    // Apply updates to existing concepts
    for (const next of updatedConceptDocs) {
      await db.concepts.put(next);
    }

    // Bulk add new concepts
    if (newConcepts.length > 0) {
      await db.concepts.bulkPut(newConcepts);
    }

    // Bidirectional linking: update related lists on existing concepts
    for (const { id, related } of biDirUpdates) {
      await db.concepts.update(id, { related, updatedAt: now });
    }

    // Activity log
    await db.activity.put(activity);
  });

  return { sourceId: source.id, newConceptIds, updatedConceptIds, activityId: activity.id };
}

export async function askWiki(
  question: string,
  history: Array<{ role: 'user' | 'ai'; text: string }>
): Promise<QueryResponse> {
  const db = getDb();
  const conceptsToSend = await findClientConceptCandidates(question, QUERY_CANDIDATE_LIMIT);

  const hydrated = await ensureConceptsHydrated(conceptsToSend.map((concept) => concept.id));
  const hydratedMap = new Map(hydrated.map((concept) => [concept.id, concept]));

  const req: QueryRequest = {
    question,
    concepts: conceptsToSend.map((c) => {
      const full = hydratedMap.get(c.id) ?? c;
      return {
      id: c.id,
      title: c.title,
      summary: c.summary,
      body: full.body,
      };
    }),
    conversationHistory: history,
  };

  return postJSON<QueryResponse>('/api/query', req);
}

export async function archiveAnswerAsConcept(
  title: string,
  summary: string,
  body: string,
  citedConceptIds: string[]
): Promise<string> {
  const db = getDb();
  const now = Date.now();
  const id = 'c-' + nanoid(8);
  const concept: Concept = {
    id,
    title,
    summary,
    body,
    sources: [],
    related: citedConceptIds,
    createdAt: now,
    updatedAt: now,
    version: 1,
    contentStatus: 'full',
    categories: [],
    categoryKeys: [],
  };
  await db.concepts.put(concept);

  // Bidirectional links
  await addBidirectionalLinks(db, id, citedConceptIds, now);

  // Log
  const activity: ActivityLog = {
    id: 'a-' + nanoid(8),
    type: 'query',
    title: `归档问答为新概念 <em>${escapeHTML(title)}</em>`,
    details: `基于 ${citedConceptIds.length} 个现有概念综合生成`,
    relatedConceptIds: [id, ...citedConceptIds],
    at: now,
  };
  await db.activity.put(activity);

  return id;
}

export async function lintWiki(): Promise<LintResponse> {
  const db = getDb();
  const concepts = await db.concepts.toArray();
  const req: LintRequest = {
    concepts: concepts.map((c) => ({
      id: c.id,
      title: c.title,
      summary: c.summary,
      related: c.related,
    })),
  };
  const resp = await postJSON<LintResponse>('/api/lint', req);

  const activity: ActivityLog = {
    id: 'a-' + nanoid(8),
    type: 'lint',
    title: '健康检查完成',
    details:
      resp.findings.length === 0
        ? '未发现问题 · Wiki 结构健康'
        : `发现 ${resp.findings.length} 处问题需要关注`,
    at: Date.now(),
  };
  await db.activity.put(activity);

  return resp;
}

/**
 * Batch-categorize uncategorized concepts via /api/categorize.
 * Processes in batches of 10. Calls onProgress after each batch.
 * Returns the total number of concepts processed.
 */
export async function categorizeConcepts(
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const db = getDb();
  const all = await db.concepts.toArray();
  const uncategorized = all.filter((c) => !c.categories || c.categories.length === 0);

  if (uncategorized.length === 0) return 0;

  const existingCategories = await getExistingCategories();
  const BATCH_SIZE = 10;
  let done = 0;

  for (let i = 0; i < uncategorized.length; i += BATCH_SIZE) {
    const batch = uncategorized.slice(i, i + BATCH_SIZE);
    const hydratedBatch = await ensureConceptsHydrated(batch.map((concept) => concept.id));
    const hydratedMap = new Map(hydratedBatch.map((concept) => [concept.id, concept]));
    const req: CategorizeRequest = {
      concepts: batch.map((c) => {
        const full = hydratedMap.get(c.id) ?? c;
        return {
        id: c.id,
        title: c.title,
        summary: c.summary,
        body: full.body,
        };
      }),
      existingCategories,
    };

    try {
      const resp = await postJSON<CategorizeResponse>('/api/categorize', req);

      // Write results to Dexie
      await db.transaction('rw', db.concepts, async () => {
        for (const result of resp.results) {
          const { categories, categoryKeys } = normalizeCategoryState({
            categories: result.categories || [],
          });
          await db.concepts.update(result.id, { categories, categoryKeys });
        }
      });

      // Update existing categories list with newly created ones
      for (const result of resp.results) {
        const normalizedKeys = normalizeCategoryState({
          categories: result.categories || [],
        }).categoryKeys;
        for (const key of normalizedKeys) {
          if (!existingCategories.includes(key)) existingCategories.push(key);
        }
      }
    } catch {
      // If one batch fails, skip it and continue with the next
      // done count still advances; caller receives total attempted
    }

    done += batch.length;
    onProgress?.(done, uncategorized.length);
  }

  return uncategorized.length;
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}
