import { nanoid } from 'nanoid';
import { getDb } from './db';
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
  SourceType,
} from './types';

async function addBidirectionalLinks(db: ReturnType<typeof getDb>, sourceId: string, relatedIds: string[], now: number) {
  for (const relId of relatedIds) {
    const c = await db.concepts.get(relId);
    if (c && !c.related.includes(sourceId)) {
      await db.concepts.update(relId, { related: [...c.related, sourceId], updatedAt: now });
    }
  }
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
}): Promise<{ newConceptIds: string[]; updatedConceptIds: string[]; activityId: string }> {
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
  };

  // 2. Gather existing concepts
  const existing = await db.concepts.toArray();
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

  // 3. Call API
  const resp = await postJSON<IngestResponse>('/api/ingest', req);

  // 4. Build new concepts list (pure computation, no DB writes yet)
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

  // 5. Pre-fetch existing concepts to update (reads before transaction)
  const updatedConceptIds: string[] = [];
  const updatedConceptDocs: Concept[] = [];
  for (const upd of resp.updatedConcepts) {
    const c = await db.concepts.get(upd.id);
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
    };
    updatedConceptDocs.push(next);
    updatedConceptIds.push(c.id);
  }

  // Pre-fetch concepts that need bidirectional link updates (reads before transaction)
  const biDirUpdates: Array<{ id: string; related: string[] }> = [];
  for (const nc of newConcepts) {
    for (const relId of nc.related) {
      const c = await db.concepts.get(relId);
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

  return { newConceptIds, updatedConceptIds, activityId: activity.id };
}

export async function askWiki(
  question: string,
  history: Array<{ role: 'user' | 'ai'; text: string }>
): Promise<QueryResponse> {
  const db = getDb();
  const allConcepts = await db.concepts.toArray();

  // 基于问题关键词预筛选，限制发送量最多 50 个
  const keywords = question.toLowerCase().split(/\W+/).filter(k => k.length > 2);
  let conceptsToSend = allConcepts;
  if (keywords.length > 0) {
    const scored = allConcepts.map(c => {
      const text = `${c.title} ${c.summary || ''}`.toLowerCase();
      const score = keywords.filter(k => text.includes(k)).length;
      return { ...c, _score: score };
    });
    // 优先高分，保留至少10个（即使无匹配）
    const sorted = scored.sort((a, b) => b._score - a._score);
    conceptsToSend = sorted.slice(0, 50).map(({ _score, ...c }) => c);
  }

  const req: QueryRequest = {
    question,
    concepts: conceptsToSend.map((c) => ({
      id: c.id,
      title: c.title,
      summary: c.summary,
      body: c.body,
    })),
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

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  );
}
