import { nanoid } from 'nanoid';
import { getDb } from './db';
import { ensureConceptsHydrated } from './cloud-sync';
import { normalizeCategoryKeys, normalizeCategoryState } from './category-normalization';
import { getLlmConfig } from './llm-config';
import { getAdminAuthHeaders } from './admin-auth-client';
import { generateClientRequestId } from './trace-client';
import type {
  Source,
  Concept,
  ActivityLog,
  IngestRequest,
  PersistedIngestResponse,
  QueryRequest,
  QueryResponse,
  LintRequest,
  LintResponse,
  CategorizeRequest,
  CategorizeResponse,
  SelectionWikiRequest,
  SelectionWikiResponse,
  SourceType,
} from './types';

const CLIENT_CANDIDATE_LIMIT = 320;
const QUERY_CANDIDATE_LIMIT = 50;
const MIN_DIRECT_TITLE_MENTION_LENGTH = 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const ASK_STREAM_TIMEOUT_MS = 180_000;

export class OfflineError extends Error {
  readonly offlineSince?: number;

  constructor(message = '当前离线，写入操作已暂停，请联网后重试。', offlineSince?: number) {
    super(message);
    this.name = 'OfflineError';
    this.offlineSince = offlineSince;
  }
}

export function isOfflineError(error: unknown): error is OfflineError {
  return error instanceof OfflineError || (error instanceof Error && error.name === 'OfflineError');
}

function assertOnlineForWrite(): void {
  if (typeof navigator === 'undefined' || navigator.onLine) return;
  const offlineSince =
    typeof window !== 'undefined'
      ? Number(window.localStorage.getItem('compound:offline-since') || 0) || undefined
      : undefined;
  throw new OfflineError(undefined, offlineSince);
}

function extractSearchTerms(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/i)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2),
    ),
  ).slice(0, 12);
}

function normalizeSearchText(text: string | undefined): string {
  return (text || '').trim().toLowerCase();
}

function isDirectTitleMention(title: string | undefined, searchText: string): boolean {
  const normalizedTitle = normalizeSearchText(title);
  return (
    normalizedTitle.length >= MIN_DIRECT_TITLE_MENTION_LENGTH &&
    normalizeSearchText(searchText).includes(normalizedTitle)
  );
}

async function findClientConceptCandidates(
  searchText: string,
  limit: number = CLIENT_CANDIDATE_LIMIT,
): Promise<Concept[]> {
  const db = getDb();
  const keywords = extractSearchTerms(searchText);
  const collection = () => db.concepts.orderBy('updatedAt').reverse();

  if (keywords.length === 0) {
    return collection().limit(limit).toArray();
  }

  const directMatches = await collection()
    .filter((concept) => isDirectTitleMention(concept.title, searchText))
    .limit(limit)
    .toArray();
  const directIds = new Set(directMatches.map((concept) => concept.id));

  const matched = await collection()
    .filter((concept) => {
      if (directIds.has(concept.id)) return false;
      const haystack = `${concept.title}\n${concept.summary}`.toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword));
    })
    .limit(limit)
    .toArray();
  const candidates = [...directMatches, ...matched].slice(0, limit);

  if (candidates.length >= Math.min(limit, 80)) {
    return candidates;
  }

  const fallback = await collection()
    .limit(limit * 2)
    .toArray();
  const seen = new Set(candidates.map((concept) => concept.id));
  return [...candidates, ...fallback.filter((concept) => !seen.has(concept.id))].slice(0, limit);
}

/** Build an AbortSignal with a timeout, optionally combined with an external signal. */
function buildTimeoutSignal(
  externalSignal?: AbortSignal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): AbortSignal {
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!externalSignal) return timeoutSignal;
    // Combine external signal with timeout
    if (typeof AbortSignal.any === 'function') {
      return AbortSignal.any([externalSignal, timeoutSignal]);
    }
    // Fallback: manual combination
    const ctrl = new AbortController();
    const abort = () => ctrl.abort();
    if (externalSignal.aborted) {
      ctrl.abort();
    } else {
      externalSignal.addEventListener('abort', abort, { once: true });
    }
    const timer = setTimeout(abort, timeoutMs);
    // Cleanup on abort
    ctrl.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        externalSignal.removeEventListener('abort', abort);
      },
      { once: true },
    );
    return ctrl.signal;
  } catch {
    // AbortSignal.timeout not supported — full fallback
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    if (externalSignal) {
      if (externalSignal.aborted) {
        ctrl.abort();
      } else {
        const abort = () => ctrl.abort();
        externalSignal.addEventListener('abort', abort, { once: true });
        ctrl.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            externalSignal.removeEventListener('abort', abort);
          },
          { once: true },
        );
      }
    }
    ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
    return ctrl.signal;
  }
}

function isAbortLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const text = `${err.name}|${err.message}`.toLowerCase();
  return (
    text.includes('abort') ||
    text.includes('aborted') ||
    text.includes('timeout') ||
    text.includes('fetch is aborted')
  );
}

function askAbortMessage(externalSignal?: AbortSignal): string {
  if (externalSignal?.aborted) return '问答已取消';
  return `问答超时：模型超过 ${Math.round(ASK_STREAM_TIMEOUT_MS / 1000)} 秒仍未完成，请稍后重试或切换更快的模型。`;
}

async function postJSON<T>(
  path: string,
  body: unknown,
  options?: { signal?: AbortSignal; retries?: number; write?: boolean },
): Promise<T> {
  if (options?.write) assertOnlineForWrite();

  const signal = buildTimeoutSignal(options?.signal);
  const maxRetries = Math.min(options?.retries ?? 0, 3);

  const llmConfig = getLlmConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-ID': generateClientRequestId(),
    ...getAdminAuthHeaders(),
  };
  // Send via headers (fast path)
  if (llmConfig.apiKey) headers['X-User-Api-Key'] = llmConfig.apiKey;
  if (llmConfig.apiUrl) headers['X-User-Api-Url'] = llmConfig.apiUrl;
  if (llmConfig.model) headers['X-User-Model'] = llmConfig.model;
  // Also embed in body as fallback (some proxies strip custom headers)
  const hasConfig = !!(llmConfig.apiKey || llmConfig.model || llmConfig.apiUrl);
  const payload = hasConfig ? { ...(body as object), llmConfig } : body;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
      await new Promise((r) => setTimeout(r, delay));
    }

    let res: Response;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
    } catch {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw options?.write ? new OfflineError() : new Error('网络已断开，请检查网络连接后重试');
      }
      lastError = new Error('网络连接失败');
      // Network error — retry if allowed
      if (attempt < maxRetries) continue;
      throw lastError;
    }

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error('请求过于频繁，请稍后重试（可切换模型或减少并发）');
      }
      if (res.status === 401 || res.status === 403) {
        throw new Error('认证失败，请在设置中检查 API Key 和 Admin Token');
      }
      // 5xx — retry if allowed
      if (res.status >= 500) {
        lastError = new Error('服务暂时不可用（502/503），请稍后重试或查看 /sync 日志');
        if (attempt < maxRetries) continue;
        throw lastError;
      }
      // 4xx — never retry
      const text = await res.text().catch(() => '');
      throw new Error(text.slice(0, 200) || `请求失败 (${res.status})`);
    }
    return (await res.json()) as T;
  }
  throw lastError ?? new Error('请求失败');
}

function buildLintActivity(
  id: string,
  status: NonNullable<ActivityLog['status']>,
  details: string,
): ActivityLog {
  const titleMap: Record<NonNullable<ActivityLog['status']>, string> = {
    running: '深度检查进行中',
    success: '健康检查完成',
    error: '健康检查失败',
  };

  return {
    id,
    type: 'lint',
    title: titleMap[status],
    details,
    status,
    at: Date.now(),
  };
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
}): Promise<{
  sourceId: string;
  newConceptIds: string[];
  updatedConceptIds: string[];
  activityId: string;
}> {
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

  // 2. Let the server run the canonical ingest pipeline and persist the rows.
  const req: IngestRequest = {
    source: {
      title: source.title,
      type: source.type,
      author: source.author,
      url: source.url,
      rawContent: source.rawContent,
      externalKey: source.externalKey,
    },
  };

  // 3. Call API
  const resp = await postJSON<PersistedIngestResponse>('/api/ingest', req, { write: true });

  // 4. Mirror the server-persisted rows into IndexedDB so the current browser
  // immediately shows the same IDs and content as other devices.
  await db.transaction('rw', [db.sources, db.concepts, db.activity], async () => {
    await db.sources.put({ ...resp.source, contentStatus: 'full' });
    if (resp.concepts.length > 0) {
      await db.concepts.bulkPut(
        resp.concepts.map((concept) => ({ ...concept, contentStatus: 'full' as const })),
      );
    }
    await db.activity.put(resp.activity);
  });

  return {
    sourceId: resp.sourceId,
    newConceptIds: resp.newConceptIds,
    updatedConceptIds: resp.updatedConceptIds,
    activityId: resp.activityId,
  };
}

/** Pipeline stage event emitted by the server during a streaming query. */
export interface AskStageEvent {
  key: 'rewrite' | 'retrieve' | 'graph' | 'rerank' | 'synthesize';
  status: 'start' | 'done';
  detail?: string;
  conceptTitles?: string[];
}

export interface WikiSearchResult {
  concepts: Concept[];
  chunks: Array<{
    id: string;
    sourceId: string;
    heading: string;
    content: string;
  }>;
  evidence: Array<{
    id: string;
    conceptId: string;
    sourceId: string;
    claim: string;
    quote?: string;
    confidence: number;
  }>;
}

export async function searchWikiContext(input: {
  query: string;
  conceptLimit?: number;
  chunkLimit?: number;
}): Promise<WikiSearchResult> {
  return postJSON<WikiSearchResult>('/api/wiki/search', {
    query: input.query,
    conceptLimit: input.conceptLimit,
    chunkLimit: input.chunkLimit,
  });
}

/** Ask the Wiki with streaming deltas, then resolve with the full response. */
export async function askWikiStream(
  question: string,
  history: Array<{ role: 'user' | 'ai'; text: string }>,
  onDelta: (text: string) => void,
  options?: { signal?: AbortSignal; onStage?: (event: AskStageEvent) => void },
): Promise<QueryResponse> {
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

  const llmConfig = getLlmConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'X-Request-ID': generateClientRequestId(),
    ...getAdminAuthHeaders(),
  };
  if (llmConfig.apiKey) headers['X-User-Api-Key'] = llmConfig.apiKey;
  if (llmConfig.apiUrl) headers['X-User-Api-Url'] = llmConfig.apiUrl;
  if (llmConfig.model) headers['X-User-Model'] = llmConfig.model;

  const hasConfig = !!(llmConfig.apiKey || llmConfig.model || llmConfig.apiUrl);
  const payload = hasConfig ? { ...req, llmConfig } : req;

  const streamSignal = buildTimeoutSignal(options?.signal, ASK_STREAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('/api/query', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: streamSignal,
    });
  } catch (err) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('网络已断开，请检查网络连接后重试');
    }
    if (streamSignal.aborted || isAbortLikeError(err)) {
      throw new Error(askAbortMessage(options?.signal));
    }
    throw new Error('网络连接失败');
  }

  if (!res.ok) {
    if (res.status === 429) throw new Error('请求过于频繁，请稍后重试（可切换模型或减少并发）');
    if (res.status === 401 || res.status === 403)
      throw new Error('认证失败，请在设置中检查 API Key 和 Admin Token');
    if (res.status >= 500) {
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        requestId?: string;
      } | null;
      const detail = json?.error || '服务暂时不可用（502/503），请稍后重试或查看 /sync 日志';
      throw new Error(json?.requestId ? `${detail} (requestId: ${json.requestId})` : detail);
    }
    const text = await res.text().catch(() => '');
    throw new Error(text.slice(0, 200) || `请求失败 (${res.status})`);
  }

  // Fallback: if the server didn't return SSE (e.g. older deployment),
  // parse as regular JSON.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const json = (await res.json()) as QueryResponse;
    onDelta(json.answer || '(无回答)');
    return json;
  }

  // Parse SSE stream
  const reader = res.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let answer = '';
  let doneData: Record<string, unknown> = {};

  try {
    while (true) {
      if (streamSignal.aborted) throw new Error(askAbortMessage(options?.signal));
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\n\n/);
      buffer = events.pop() ?? '';

      for (const evt of events) {
        let eventType = '';
        let eventData = '';
        for (const line of evt.split('\n')) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) eventData = line.slice(5);
        }
        if (!eventData) continue;

        if (eventType === 'delta') {
          try {
            const parsed = JSON.parse(eventData) as { text: string };
            answer += parsed.text;
            onDelta(parsed.text);
          } catch {
            // skip malformed delta
          }
        } else if (eventType === 'stage') {
          if (options?.onStage) {
            try {
              const parsed = JSON.parse(eventData) as AskStageEvent;
              options.onStage(parsed);
            } catch {
              // skip malformed stage
            }
          }
        } else if (eventType === 'done') {
          try {
            doneData = JSON.parse(eventData) as Record<string, unknown>;
          } catch {
            // skip
          }
        } else if (eventType === 'error') {
          try {
            const errPayload = JSON.parse(eventData) as { error: string };
            throw new Error(errPayload.error || 'Query processing failed');
          } catch (e) {
            if (e instanceof Error && e.message !== 'Query processing failed') throw e;
          }
        }
      }
    }
  } catch (err) {
    if (streamSignal.aborted || isAbortLikeError(err)) {
      throw new Error(askAbortMessage(options?.signal));
    }
    throw err;
  } finally {
    reader.releaseLock();
  }

  return {
    answer: answer || '(无回答)',
    citedConceptIds: (doneData.citedConceptIds as string[]) || [],
    archivable: Boolean(doneData.archivable),
    suggestedTitle: doneData.suggestedTitle as string | undefined,
    suggestedSummary: doneData.suggestedSummary as string | undefined,
    suggestedQuestions: doneData.suggestedQuestions as string[] | undefined,
    rewrittenQuestion: doneData.rewrittenQuestion as string | undefined,
    retrievalMode: doneData.retrievalMode as QueryResponse['retrievalMode'],
  };
}

/**
 * Create a new wiki concept from a free-form text selection. The server
 * runs the LLM with related-concept context and persists the new concept,
 * we mirror the result into Dexie so the page is immediately visible.
 */
export async function createWikiFromSelection(input: {
  selection: string;
  sourceConceptId?: string;
  contextTitle?: string;
}): Promise<SelectionWikiResponse> {
  const req: SelectionWikiRequest = {
    selection: input.selection,
    sourceConceptId: input.sourceConceptId,
    contextTitle: input.contextTitle,
  };
  const resp = await postJSON<SelectionWikiResponse>('/api/concepts/from-selection', req, {
    write: true,
  });

  if (resp.concepts.length > 0) {
    const db = getDb();
    await db.transaction('rw', db.concepts, async () => {
      await db.concepts.bulkPut(
        resp.concepts.map((concept) => ({
          ...concept,
          contentStatus: 'full' as const,
        })),
      );
    });
  }
  if (resp.activity) {
    await getDb().activity.put(resp.activity);
  }

  return resp;
}

export async function archiveAnswerAsConcept(
  title: string,
  summary: string,
  body: string,
  citedConceptIds: string[],
): Promise<string> {
  const resp = await postJSON<{
    conceptId: string;
    concepts: Concept[];
    activity: ActivityLog;
  }>(
    '/api/concepts/archive-answer',
    {
      title,
      summary,
      body,
      citedConceptIds,
    },
    { write: true },
  );

  const db = getDb();
  await db.transaction('rw', [db.concepts, db.activity], async () => {
    if (resp.concepts.length > 0) {
      await db.concepts.bulkPut(
        resp.concepts.map((concept) => ({ ...concept, contentStatus: 'full' as const })),
      );
    }
    await db.activity.put(resp.activity);
  });

  return resp.conceptId;
}

export async function updateSourceContent(input: {
  id: string;
  title?: string;
  rawContent: string;
}): Promise<{
  source: Source;
  concepts: Concept[];
  activity?: ActivityLog;
}> {
  assertOnlineForWrite();
  const res = await fetch('/api/data/sources', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': generateClientRequestId(),
      ...getAdminAuthHeaders(),
    },
    body: JSON.stringify(input),
    signal: buildTimeoutSignal(undefined, DEFAULT_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('认证失败，请在设置中检查 Admin Token');
    }
    const text = await res.text().catch(() => '');
    throw new Error(text.slice(0, 200) || `保存失败 (${res.status})`);
  }
  const payload = (await res.json()) as {
    source: Source;
    concepts?: Concept[];
    activity?: ActivityLog;
  };
  const db = getDb();
  await db.transaction('rw', [db.sources, db.concepts, db.activity], async () => {
    await db.sources.put({ ...payload.source, contentStatus: 'full' });
    if (payload.concepts?.length) {
      await db.concepts.bulkPut(
        payload.concepts.map((concept) => ({ ...concept, contentStatus: 'full' as const })),
      );
    }
    if (payload.activity) await db.activity.put(payload.activity);
  });
  return {
    source: payload.source,
    concepts: payload.concepts ?? [],
    activity: payload.activity,
  };
}

export interface RepairFindingPayload {
  type: 'duplicate' | 'missing-link' | 'orphan' | 'contradiction';
  message: string;
  conceptIds: string[];
}

export interface RepairStartResponse {
  runId: string | null;
  total: number;
  dropped: number;
  ok: boolean;
}

export interface RepairStatusSummary {
  merged: number;
  linked: number;
  orphanFixed: number;
  conflictQueued: number;
  deletedConceptIds: string[];
  touchedConceptIds: string[];
  aiFallbacks: number;
  activityId?: string;
}

export interface RepairStatusResponse {
  id: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  total: number;
  done: number;
  failed: number;
  startedAt: number;
  finishedAt: number | null;
  summary: RepairStatusSummary;
}

export async function startRepair(findings: RepairFindingPayload[]): Promise<RepairStartResponse> {
  return postJSON<RepairStartResponse>('/api/repair/run', { findings }, { write: true });
}

export async function getRepairStatus(runId: string): Promise<RepairStatusResponse> {
  const res = await fetch(`/api/repair/status?runId=${encodeURIComponent(runId)}`, {
    headers: { 'X-Request-ID': generateClientRequestId(), ...getAdminAuthHeaders() },
    cache: 'no-store',
  });
  if (res.status === 404) throw new Error('run not found');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text.slice(0, 200) || `状态查询失败 (${res.status})`);
  }
  return (await res.json()) as RepairStatusResponse;
}

/** Remove Dexie rows for concepts the server-side merge deleted. */
export async function pruneDeletedConcepts(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const db = getDb();
  await db.concepts.bulkDelete(ids);
}

export async function lintWiki(activityId?: string): Promise<LintResponse> {
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
  const resp = await postJSON<LintResponse>('/api/lint', req, { write: true });

  const successDetails =
    resp.findings.length === 0
      ? '未发现问题 · Wiki 结构健康'
      : `发现 ${resp.findings.length} 处问题需要关注`;
  await db.activity.put(
    buildLintActivity(activityId ?? 'a-' + nanoid(8), 'success', successDetails),
  );

  return resp;
}

// ---- async lint (cloud-side) ----

export interface LintRunStatusResponse {
  id: string;
  status: 'running' | 'done' | 'failed';
  phase: 'loading_concepts' | 'analyzing' | 'done';
  conceptCount: number;
  findings: Array<{
    type: 'contradiction' | 'orphan' | 'missing-link' | 'duplicate';
    message: string;
    conceptIds: string[];
  }>;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface LintRunStartResponse {
  runId: string;
  ok: boolean;
}

/** Start a cloud-side async lint run. The server reads its own DB, no client data needed. */
export async function startLintRun(): Promise<LintRunStartResponse> {
  return postJSON<LintRunStartResponse>('/api/lint/run', {}, { write: true });
}

/** Poll the status of an async lint run. Throws on 404 (run not found). */
export async function getLintStatus(runId: string): Promise<LintRunStatusResponse> {
  const res = await fetch(`/api/lint/status?runId=${encodeURIComponent(runId)}`, {
    headers: { 'X-Request-ID': generateClientRequestId(), ...getAdminAuthHeaders() },
    cache: 'no-store',
  });
  if (res.status === 404) throw new Error('run not found');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text.slice(0, 200) || `状态查询失败 (${res.status})`);
  }
  return (await res.json()) as LintRunStatusResponse;
}

/**
 * Batch-categorize uncategorized concepts via /api/categorize.
 * Processes in batches of 10. Calls onProgress after each batch.
 * Returns the total number of concepts processed.
 */
export async function categorizeConcepts(
  onProgress?: (done: number, total: number, failed: number, errors: string[]) => void,
): Promise<{ total: number; failed: number; errors: string[] }> {
  const db = getDb();
  const all = await db.concepts.toArray();
  const uncategorized = all.filter((c) => !c.categories || c.categories.length === 0);

  if (uncategorized.length === 0) return { total: 0, failed: 0, errors: [] };

  const existingCategories = await getExistingCategories();
  const BATCH_SIZE = 10;
  let done = 0;
  let failed = 0;
  const errors: string[] = [];

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
      const resp = await postJSON<CategorizeResponse>('/api/categorize', req, { write: true });

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
    } catch (e) {
      failed += batch.length;
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg.slice(0, 200));
    }

    done += batch.length;
    onProgress?.(done, uncategorized.length, failed, errors);
  }

  return { total: uncategorized.length, failed, errors };
}
