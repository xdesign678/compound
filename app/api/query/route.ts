import { NextResponse } from 'next/server';
import { chat, parseJSON, isReasoningModel } from '@/lib/gateway';
import { QUERY_SYSTEM_PROMPT, QUERY_SYSTEM_PROMPT_VERSION } from '@/lib/prompts';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
  readLlmConfigOverride,
} from '@/lib/request-guards';
import {
  formatQueryContextForPrompt,
  wikiRepo,
  type QueryContext,
  type SourceChunk,
  type ConceptEvidence,
} from '@/lib/wiki-db';
import { getEmbeddingMode, hybridSearchWikiContext } from '@/lib/embedding';
import { observeRagStageDuration } from '@/lib/observability/prometheus';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';
import { rewriteQuery } from '@/lib/retrieval/query-rewrite';
import { reciprocalRankFusion } from '@/lib/retrieval/rrf';
import { graphExpand } from '@/lib/retrieval/graph-expand';
import { llmRerank, type RerankCandidate } from '@/lib/retrieval/llm-rerank';
import { getModelForTask } from '@/lib/model-history';
import {
  decideRerank,
  getRerankCandidateLimit,
  limitRerankCandidates,
  type RerankDecisionReason,
} from '@/lib/retrieval/query-planning';
import { classifyQueryError, publicQueryErrorMessage } from '@/lib/retrieval/query-errors';
import { checkFaithfulness } from '@/lib/retrieval/faithfulness';
import { repo } from '@/lib/server-db';
import type { Concept, QueryRequest, QueryResponse, LlmConfig } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BODY_BYTES = 512_000;
const MAX_CONCEPTS = 500;
const MAX_QUESTION_CHARS = 2_000;
const MAX_HISTORY_MESSAGES = 6;
const RECALL_TOP_K = Math.max(10, Number(process.env.COMPOUND_RECALL_TOP_K || 30));
const FINAL_TOP_K = Math.max(3, Number(process.env.COMPOUND_FINAL_TOP_K || 8));
const SYNTHESIS_MAX_TOKENS = Math.max(
  900,
  Number(process.env.COMPOUND_QUERY_SYNTHESIS_MAX_TOKENS || 1600),
);

function conceptFromRequest(c: QueryRequest['concepts'][number]): Concept {
  const now = Date.now();
  return {
    id: c.id,
    title: c.title,
    summary: c.summary,
    body: c.body || '',
    sources: [],
    related: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    contentStatus: c.body ? 'full' : 'partial',
    categories: [],
    categoryKeys: [],
  };
}

function mergeConcepts(primary: Concept[], secondary: Concept[]): Concept[] {
  const concepts = new Map<string, Concept>();
  for (const concept of [...primary, ...secondary]) {
    const prev = concepts.get(concept.id);
    if (!prev || (!prev.body && concept.body)) {
      concepts.set(concept.id, concept);
    }
  }
  return Array.from(concepts.values());
}

async function getServerContext(question: string): Promise<QueryContext> {
  const options = {
    conceptLimit: Number(process.env.COMPOUND_QUERY_CONTEXT_CONCEPT_LIMIT || 24),
    chunkLimit: Number(process.env.COMPOUND_QUERY_CONTEXT_CHUNK_LIMIT || 12),
  };

  if (process.env.COMPOUND_DISABLE_HYBRID_SEARCH === 'true') {
    return wikiRepo.searchWikiContext(question, options);
  }

  try {
    return await hybridSearchWikiContext(question, options);
  } catch (err) {
    logger.warn('query.hybrid_search_fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
    return wikiRepo.searchWikiContext(question, options);
  }
}

/**
 * Compose the rerank candidate list from the unified retrieval set.
 * Each concept becomes a `concept` candidate; each chunk becomes a `chunk`
 * candidate. Graph-expanded concepts are tagged `kind="graph"` for the
 * reranker prompt.
 */
function buildRerankCandidates(input: {
  concepts: Concept[];
  graphConceptIds: Set<string>;
  chunks: SourceChunk[];
}): RerankCandidate[] {
  const candidates: RerankCandidate[] = [];
  for (const concept of input.concepts) {
    candidates.push({
      id: `concept:${concept.id}`,
      kind: input.graphConceptIds.has(concept.id) ? 'graph' : 'concept',
      title: concept.title,
      snippet: `${concept.summary}\n${concept.body || ''}`,
    });
  }
  for (const chunk of input.chunks) {
    candidates.push({
      id: `chunk:${chunk.id}`,
      kind: 'chunk',
      title: chunk.heading,
      snippet: chunk.contextualPrefix
        ? `[情境] ${chunk.contextualPrefix}\n\n${chunk.content}`
        : chunk.content,
    });
  }
  return candidates;
}

function partitionRanked(
  ranked: RerankCandidate[],
  conceptsById: Map<string, Concept>,
  chunksById: Map<string, SourceChunk>,
): { concepts: Concept[]; chunks: SourceChunk[] } {
  const concepts: Concept[] = [];
  const chunks: SourceChunk[] = [];
  for (const c of ranked) {
    if (c.id.startsWith('concept:')) {
      const concept = conceptsById.get(c.id.slice('concept:'.length));
      if (concept) concepts.push(concept);
    } else if (c.id.startsWith('chunk:')) {
      const chunk = chunksById.get(c.id.slice('chunk:'.length));
      if (chunk) chunks.push(chunk);
    }
  }
  return { concepts, chunks };
}

interface RetrievalResult {
  rewrittenQuestion: string;
  rewriteUsed: 'llm' | 'pass-through' | 'fallback';
  retrievalMode: 'remote-emb' | 'local-hash' | 'fts-only';
  rerankUsed: 'llm' | 'fallback';
  rerankReason: RerankDecisionReason;
  finalContext: QueryContext;
}

export type StageEventKey = 'rewrite' | 'retrieve' | 'graph' | 'rerank' | 'synthesize';
export type StageDurations = Record<StageEventKey, number>;

export interface StageEvent {
  key: StageEventKey;
  status: 'start' | 'done';
  detail?: string;
  conceptTitles?: string[];
}

type StageEmitter = (event: StageEvent) => void;
type StageDurationSnapshot = Partial<StageDurations>;

interface RetrievedConceptSummary {
  id: string;
  title: string;
}

function summarizeConcepts(concepts: Concept[]): RetrievedConceptSummary[] {
  return concepts.map((concept) => ({
    id: concept.id,
    title: concept.title,
  }));
}

const STAGE_KEYS: StageEventKey[] = ['rewrite', 'retrieve', 'graph', 'rerank', 'synthesize'];

function emptyStageDurations(): StageDurationSnapshot {
  return {};
}

function roundedDurationMs(durationMs: number): number {
  return Math.max(0, Math.round(durationMs));
}

function createStageTelemetry(onSnapshot: (durations: StageDurationSnapshot) => void) {
  const startedAt = new Map<StageEventKey, number>();
  const durations: StageDurationSnapshot = emptyStageDurations();

  function snapshot(): StageDurationSnapshot {
    const now = performance.now();
    const current: StageDurationSnapshot = { ...durations };
    for (const key of STAGE_KEYS) {
      const start = startedAt.get(key);
      if (start !== undefined && current[key] === undefined) {
        current[key] = roundedDurationMs(now - start);
      }
    }
    return current;
  }

  function publish(): void {
    onSnapshot(snapshot());
  }

  return {
    start(key: StageEventKey) {
      startedAt.set(key, performance.now());
      publish();
    },
    finish(key: StageEventKey) {
      const start = startedAt.get(key);
      if (start === undefined) return snapshot();
      const durationMs = roundedDurationMs(performance.now() - start);
      startedAt.delete(key);
      durations[key] = durationMs;
      observeRagStageDuration({ stage: key, durationMs });
      publish();
      return snapshot();
    },
    snapshot,
  };
}

async function runRetrievalPipeline(opts: {
  question: string;
  history?: Array<{ role: 'user' | 'ai'; text: string }>;
  llmConfig?: LlmConfig;
  requestConcepts: Concept[];
  onStage?: StageEmitter;
  stageTelemetry?: ReturnType<typeof createStageTelemetry>;
  /** Optional caller cancellation signal (e.g. req.signal). Propagated to LLM sub-calls. */
  signal?: AbortSignal;
}): Promise<RetrievalResult> {
  const emit: StageEmitter = opts.onStage ?? (() => {});
  const stageTelemetry = opts.stageTelemetry ?? createStageTelemetry(() => {});

  // Step 1: history-aware query rewrite
  stageTelemetry.start('rewrite');
  emit({ key: 'rewrite', status: 'start' });
  const { rewritten, used: rewriteUsed } = await rewriteQuery({
    question: opts.question,
    history: opts.history,
    llmConfig: opts.llmConfig,
    signal: opts.signal,
  });
  const effectiveQuery = rewritten || opts.question;
  emit({
    key: 'rewrite',
    status: 'done',
    detail:
      rewriteUsed === 'pass-through'
        ? '原问题足够清晰'
        : `已改写检索 query · ${rewriteUsed === 'llm' ? 'LLM 重写' : '回退方案'}`,
  });
  stageTelemetry.finish('rewrite');

  // Step 2: hybrid retrieval (FTS + vector when configured)
  stageTelemetry.start('retrieve');
  emit({ key: 'retrieve', status: 'start' });
  const serverContext = await getServerContext(effectiveQuery);
  const embeddingMode = getEmbeddingMode();
  const retrievalMode: RetrievalResult['retrievalMode'] =
    embeddingMode === 'remote' ? 'remote-emb' : 'fts-only';
  emit({
    key: 'retrieve',
    status: 'done',
    detail: `${embeddingMode === 'remote' ? '混合检索 (FTS + 向量)' : 'FTS 全文检索'} · 召回 ${serverContext.concepts.length} 个概念，${serverContext.chunks.length} 段证据`,
    conceptTitles: serverContext.concepts.slice(0, 12).map((c) => c.title),
  });
  stageTelemetry.finish('retrieve');

  // Step 3: graph 1-hop expansion off the seed concepts
  stageTelemetry.start('graph');
  emit({ key: 'graph', status: 'start' });
  const seedConceptIds = serverContext.concepts.slice(0, 8).map((c) => c.id);
  const graph = graphExpand(seedConceptIds, 5);
  const graphConceptIds = new Set(graph.concepts.map((c) => c.id));
  emit({
    key: 'graph',
    status: 'done',
    detail:
      graph.concepts.length === 0
        ? '未发现相关邻居概念'
        : `沿概念关系扩展 ${graph.concepts.length} 个邻居`,
  });
  stageTelemetry.finish('graph');

  // Step 4: RRF fusion across (a) FTS-ordered concepts (b) request mentions
  // (c) graph-expanded neighbors. Chunks fuse separately.
  stageTelemetry.start('rerank');
  emit({ key: 'rerank', status: 'start' });
  const conceptFused = reciprocalRankFusion<Concept>(
    [
      { name: 'mentioned', items: opts.requestConcepts, getId: (c) => c.id, weight: 1.5 },
      { name: 'fts', items: serverContext.concepts, getId: (c) => c.id, weight: 1.0 },
      { name: 'graph', items: graph.concepts, getId: (c) => c.id, weight: 0.6 },
    ],
    { topK: RECALL_TOP_K },
  );
  const chunkFused = reciprocalRankFusion<SourceChunk>(
    [{ name: 'fts-chunk', items: serverContext.chunks, getId: (ch) => ch.id }],
    { topK: RECALL_TOP_K },
  );

  // Step 5: dedupe + materialize into structured candidates
  const concepts = conceptFused.map((f) => f.item);
  const chunks = chunkFused.map((f) => f.item);
  const candidates = buildRerankCandidates({ concepts, graphConceptIds, chunks });

  // Step 6: LLM rerank to FINAL_TOP_K
  const candidateLimit = getRerankCandidateLimit(FINAL_TOP_K);
  const limitedCandidates = limitRerankCandidates(candidates, candidateLimit);
  const rerankDecision = decideRerank({
    candidateCount: limitedCandidates.length,
    finalTopK: FINAL_TOP_K,
    retrievalMode,
  });
  const rerank = rerankDecision.useLlm
    ? await llmRerank({
        query: effectiveQuery,
        candidates: limitedCandidates,
        topK: FINAL_TOP_K,
        llmConfig: opts.llmConfig,
        signal: opts.signal,
      })
    : {
        ranked: limitedCandidates.slice(0, FINAL_TOP_K),
        used: 'fallback' as const,
      };

  const conceptsById = new Map(concepts.map((c) => [c.id, c]));
  const chunksById = new Map(chunks.map((c) => [c.id, c]));
  const partitioned = partitionRanked(rerank.ranked, conceptsById, chunksById);

  emit({
    key: 'rerank',
    status: 'done',
    detail: `融合 ${candidates.length} 候选，裁剪到 ${limitedCandidates.length} · ${
      rerank.used === 'llm' ? 'LLM 重排' : `启发式排序 (${rerankDecision.reason})`
    } 到 Top-${partitioned.concepts.length + partitioned.chunks.length}`,
    conceptTitles: partitioned.concepts.slice(0, 8).map((c) => c.title),
  });
  stageTelemetry.finish('rerank');

  // Step 7: assemble final context. Always carry through evidence rows for
  // the chosen concepts so the answer prompt has factual handles.
  const evidenceRows: ConceptEvidence[] = wikiRepo.getEvidenceForConcepts(
    partitioned.concepts.map((c) => c.id),
    2,
  );

  return {
    rewrittenQuestion: effectiveQuery,
    rewriteUsed,
    retrievalMode,
    rerankUsed: rerank.used,
    rerankReason: rerankDecision.reason,
    finalContext: {
      concepts: partitioned.concepts,
      chunks: partitioned.chunks,
      evidence: evidenceRows,
    },
  };
}

/**
 * Answer a natural-language question against the user's Wiki using a
 * production-grade RAG pipeline:
 * 1. history-aware query rewrite
 * 2. hybrid retrieval (FTS5 BM25 + vector when configured)
 * 3. concept graph 1-hop expansion via `concept_relations`
 * 4. Reciprocal Rank Fusion across all retrievers
 * 5. LLM-as-reranker → top-K
 * 6. answer synthesis with citations (streaming when client opts in)
 * 7. citation faithfulness check
 *
 * Body: `QueryRequest` — `question` is required (<= 2k chars). Optional
 * `concepts` (<= 500) and `conversationHistory` (last 6 turns are kept).
 *
 * Streaming: when the request includes `Accept: text/event-stream` the
 * response is an SSE stream. The stream emits:
 *   - `event: stage`  — pipeline progress: `{ key, status, detail?, conceptTitles? }`
 *   - `event: delta`  — incremental answer text fragments
 *   - `event: done`   — final JSON payload with citations, suggestedQuestions, etc.
 * Otherwise a regular JSON response is returned (backward compatible).
 *
 * Guards: admin token, LLM rate limit, 512KB body cap.
 */
export const POST = withRequestTracing(async (req: Request) => {
  const denied =
    requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  const wantStream = req.headers.get('accept') === 'text/event-stream';
  let stageDurations: StageDurationSnapshot = emptyStageDurations();
  const stageTelemetry = createStageTelemetry((snapshot) => {
    stageDurations = snapshot;
  });

  try {
    const body = await readJsonWithLimit<QueryRequest>(req, MAX_BODY_BYTES);
    const question = body?.question?.trim();
    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 });
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return NextResponse.json({ error: 'question is too long' }, { status: 400 });
    }
    if (body.concepts && !Array.isArray(body.concepts)) {
      return NextResponse.json({ error: 'concepts must be an array' }, { status: 400 });
    }
    if ((body.concepts || []).length > MAX_CONCEPTS) {
      return NextResponse.json({ error: 'Too many concepts' }, { status: 400 });
    }

    const llmConfig = readLlmConfigOverride(req, body);
    const requestConcepts = (body.concepts || []).map(conceptFromRequest);
    const history = body.conversationHistory?.slice(-MAX_HISTORY_MESSAGES);

    function buildPromptInputs(retrieval: RetrievalResult) {
      const concepts = mergeConcepts(requestConcepts, retrieval.finalContext.concepts).slice(
        0,
        MAX_CONCEPTS,
      );
      const wikiDump =
        formatQueryContextForPrompt(
          {
            concepts,
            evidence: retrieval.finalContext.evidence,
            chunks: retrieval.finalContext.chunks,
          },
          {
            conceptBodyChars: Number(process.env.COMPOUND_QUERY_PROMPT_CONCEPT_CHARS || 700),
            evidenceLimit: Number(process.env.COMPOUND_QUERY_PROMPT_EVIDENCE_LIMIT || 10),
            evidenceQuoteChars: Number(process.env.COMPOUND_QUERY_PROMPT_EVIDENCE_CHARS || 240),
            chunkLimit: Number(process.env.COMPOUND_QUERY_PROMPT_CHUNK_LIMIT || 5),
            chunkChars: Number(process.env.COMPOUND_QUERY_PROMPT_CHUNK_CHARS || 450),
          },
        ) || '(Wiki 为空)';

      const historyBlock = history
        ? history
            .map((m) => `${m.role === 'user' ? '用户' : 'Wiki'}: ${m.text.slice(0, 2000)}`)
            .join('\n')
        : '';

      const userPrompt = `# 用户的 Wiki 检索上下文\n\n${wikiDump}\n\n---\n\n${
        historyBlock ? `# 最近对话\n\n${historyBlock}\n\n---\n\n` : ''
      }# 当前问题\n\n${question}\n\n${retrieval.rewrittenQuestion !== question ? `# 改写后的检索 query\n\n${retrieval.rewrittenQuestion}\n\n---\n\n` : ''}请优先基于「相关概念页」回答；当概念页不足时，再参考「证据链」和「原文片段候选」。按 system prompt 定义的 JSON schema 输出，只输出 JSON。`;

      return { concepts, userPrompt };
    }

    // ---- Streaming path ----
    if (wantStream) {
      const model = llmConfig?.model || getModelForTask('query');
      const reasoning = isReasoningModel(model);

      // Shared AbortController linked to the client's request signal.
      // When the client disconnects (req.signal aborts), the controller
      // aborts in-flight LLM/retrieval work and clears the keepalive interval.
      const abortController = new AbortController();
      const onClientAbort = () => {
        const reason =
          req.signal.reason instanceof Error
            ? req.signal.reason
            : new DOMException('Client disconnected', 'AbortError');
        abortController.abort(reason);
      };
      if (req.signal.aborted) onClientAbort();
      else req.signal.addEventListener('abort', onClientAbort, { once: true });

      const encoder = new TextEncoder();
      let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

      const stream = new ReadableStream({
        async start(controller) {
          function sendSSE(event: string, data: unknown) {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
            );
          }

          // Send keepalive comments every 30s to prevent reverse proxy timeouts
          keepaliveInterval = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`:keepalive\n\n`));
            } catch {
              // Controller may already be closed
            }
          }, 30_000);

          try {
            // Run the retrieval pipeline inline so we can forward each
            // step's progress to the client as `event: stage` SSE messages.
            const retrieval = await runRetrievalPipeline({
              question,
              history,
              llmConfig,
              requestConcepts,
              stageTelemetry,
              signal: abortController.signal,
              onStage: (event) => {
                sendSSE('stage', event);
              },
            });

            const { concepts, userPrompt } = buildPromptInputs(retrieval);

            // Synthesis stage covers the LLM answer call.
            stageTelemetry.start('synthesize');
            sendSSE('stage', { key: 'synthesize', status: 'start' });

            const raw = await chat({
              messages: [
                { role: 'system', content: QUERY_SYSTEM_PROMPT },
                { role: 'user', content: userPrompt },
              ],
              responseFormat: reasoning ? undefined : 'json_object',
              temperature: 0.35,
              maxTokens: SYNTHESIS_MAX_TOKENS,
              llmConfig,
              task: 'query',
              promptVersion: QUERY_SYSTEM_PROMPT_VERSION,
              stream: true,
              signal: abortController.signal,
            });

            // chat() with stream:true returns the full concatenated content.
            // We parse the JSON and emit the answer text character-by-character
            // as delta events for a progressive feel, then emit the full metadata
            // in the `done` event.
            const parsed = parseJSON<
              QueryResponse & {
                rewrittenQuestion?: string;
                retrievalMode?: string;
                stageDurations?: StageDurationSnapshot;
                rerankUsed?: string;
                rerankReason?: string;
                retrievedConcepts?: RetrievedConceptSummary[];
                citedConcepts?: RetrievedConceptSummary[];
              }
            >(raw);
            parsed.citedConceptIds = parsed.citedConceptIds || [];
            parsed.answer = parsed.answer || '(无回答)';
            parsed.archivable = Boolean(parsed.archivable);
            parsed.suggestedQuestions = Array.isArray(parsed.suggestedQuestions)
              ? parsed.suggestedQuestions.slice(0, 3)
              : [];

            const validIds = new Set(concepts.map((c) => c.id));
            parsed.citedConceptIds = parsed.citedConceptIds.filter((id) => validIds.has(id));

            // Stream the answer in chunks for progressive rendering
            const answerText = parsed.answer;
            const CHUNK_SIZE = 4;
            for (let i = 0; i < answerText.length; i += CHUNK_SIZE) {
              sendSSE('delta', { text: answerText.slice(i, i + CHUNK_SIZE) });
            }

            // Emit final metadata
            parsed.rewrittenQuestion =
              retrieval.rewriteUsed === 'pass-through' ? undefined : retrieval.rewrittenQuestion;
            parsed.retrievalMode = retrieval.retrievalMode;
            parsed.rerankUsed = retrieval.rerankUsed;
            parsed.rerankReason = retrieval.rerankReason;
            parsed.retrievedConcepts = summarizeConcepts(concepts);
            const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
            parsed.citedConcepts = parsed.citedConceptIds
              .map((id) => conceptById.get(id))
              .filter((concept): concept is Concept => Boolean(concept))
              .map((concept) => ({ id: concept.id, title: concept.title }));
            stageTelemetry.finish('synthesize');

            if (process.env.COMPOUND_FAITHFULNESS !== 'off') {
              const citedConcepts = parsed.citedConceptIds
                .map((id) => repo.getConceptsByIds([id])[0])
                .filter((c): c is Concept => Boolean(c));
              const faithfulness = checkFaithfulness({
                answer: parsed.answer,
                citedConcepts: citedConcepts.map((c) => ({
                  id: c.id,
                  title: c.title,
                  summary: c.summary,
                  body: c.body,
                })),
              });
              parsed.faithfulness = {
                score: faithfulness.score,
                level: faithfulness.level,
              };
              if (faithfulness.level === 'low' && faithfulness.unsupported.length > 0) {
                logger.warn('query.faithfulness_low', {
                  score: faithfulness.score,
                  unsupported: faithfulness.unsupported,
                  answerPreview: parsed.answer.slice(0, 200),
                });
              }
            }

            sendSSE('stage', {
              key: 'synthesize',
              status: 'done',
              detail: `综合完成 · 引用 ${parsed.citedConceptIds.length} 个概念`,
            });

            sendSSE('done', {
              citedConceptIds: parsed.citedConceptIds,
              archivable: parsed.archivable,
              suggestedTitle: parsed.suggestedTitle,
              suggestedSummary: parsed.suggestedSummary,
              suggestedQuestions: parsed.suggestedQuestions,
              rewrittenQuestion: parsed.rewrittenQuestion,
              retrievalMode: parsed.retrievalMode,
              rerankUsed: parsed.rerankUsed,
              rerankReason: parsed.rerankReason,
              retrievedConcepts: parsed.retrievedConcepts,
              citedConcepts: parsed.citedConcepts,
              stageDurations,
              faithfulness: parsed.faithfulness,
            });

            clearInterval(keepaliveInterval);
            controller.close();
          } catch (err) {
            if (keepaliveInterval) clearInterval(keepaliveInterval);
            req.signal.removeEventListener('abort', onClientAbort);
            logger.error('query.failed', {
              error: err instanceof Error ? err.message : String(err),
              stageDurations: stageTelemetry.snapshot(),
            });
            // When cancel() fires first, the ReadableStream controller is
            // already closed/errored — enqueue/close will throw TypeError.
            try {
              sendSSE('error', {
                error: publicQueryErrorMessage(err),
                errorType: classifyQueryError(err),
                stageDurations: stageTelemetry.snapshot(),
                requestId: getRequestContext()?.requestId,
              });
            } catch {
              /* stream already cancelled by client disconnect */
            }
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        },
        cancel() {
          // Client disconnected — abort in-flight LLM/retrieval work and
          // clean up the keepalive interval so resources are released promptly.
          abortController.abort(new DOMException('Client disconnected', 'AbortError'));
          if (keepaliveInterval) clearInterval(keepaliveInterval);
          req.signal.removeEventListener('abort', onClientAbort);
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // ---- Non-streaming path (backward compatible) ----
    const retrieval = await runRetrievalPipeline({
      question,
      history,
      llmConfig,
      requestConcepts,
      stageTelemetry,
      signal: req.signal,
    });
    const { concepts, userPrompt } = buildPromptInputs(retrieval);

    stageTelemetry.start('synthesize');
    const raw = await chat({
      messages: [
        { role: 'system', content: QUERY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.35,
      maxTokens: SYNTHESIS_MAX_TOKENS,
      llmConfig,
      task: 'query',
      promptVersion: QUERY_SYSTEM_PROMPT_VERSION,
      signal: req.signal,
    });

    const parsed = parseJSON<
      QueryResponse & {
        rewrittenQuestion?: string;
        retrievalMode?: string;
        stageDurations?: StageDurationSnapshot;
        rerankUsed?: string;
        rerankReason?: string;
        retrievedConcepts?: RetrievedConceptSummary[];
        citedConcepts?: RetrievedConceptSummary[];
      }
    >(raw);
    parsed.citedConceptIds = parsed.citedConceptIds || [];
    parsed.answer = parsed.answer || '(无回答)';
    parsed.archivable = Boolean(parsed.archivable);
    parsed.suggestedQuestions = Array.isArray(parsed.suggestedQuestions)
      ? parsed.suggestedQuestions.slice(0, 3)
      : [];

    // Ensure citations reference real concept ids
    const validIds = new Set(concepts.map((c) => c.id));
    parsed.citedConceptIds = parsed.citedConceptIds.filter((id) => validIds.has(id));

    if (process.env.COMPOUND_FAITHFULNESS !== 'off') {
      const citedConcepts = parsed.citedConceptIds
        .map((id) => repo.getConceptsByIds([id])[0])
        .filter((c): c is Concept => Boolean(c));
      const faithfulness = checkFaithfulness({
        answer: parsed.answer,
        citedConcepts: citedConcepts.map((c) => ({
          id: c.id,
          title: c.title,
          summary: c.summary,
          body: c.body,
        })),
      });
      parsed.faithfulness = {
        score: faithfulness.score,
        level: faithfulness.level,
      };
      if (faithfulness.level === 'low' && faithfulness.unsupported.length > 0) {
        logger.warn('query.faithfulness_low', {
          score: faithfulness.score,
          unsupported: faithfulness.unsupported,
          answerPreview: parsed.answer.slice(0, 200),
        });
      }
    }

    parsed.rewrittenQuestion =
      retrieval.rewriteUsed === 'pass-through' ? undefined : retrieval.rewrittenQuestion;
    parsed.retrievalMode = retrieval.retrievalMode;
    parsed.rerankUsed = retrieval.rerankUsed;
    parsed.rerankReason = retrieval.rerankReason;
    parsed.retrievedConcepts = summarizeConcepts(concepts);
    const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
    parsed.citedConcepts = parsed.citedConceptIds
      .map((id) => conceptById.get(id))
      .filter((concept): concept is Concept => Boolean(concept))
      .map((concept) => ({ id: concept.id, title: concept.title }));
    stageTelemetry.finish('synthesize');
    parsed.stageDurations = stageDurations;

    return NextResponse.json(parsed);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const error = publicQueryErrorMessage(err);
    logger.error('query.failed', {
      error: err instanceof Error ? err.message : String(err),
      stageDurations: stageTelemetry.snapshot(),
    });
    return NextResponse.json(
      {
        error,
        errorType: classifyQueryError(err),
        stageDurations: stageTelemetry.snapshot(),
        requestId: getRequestContext()?.requestId,
      },
      { status: 500 },
    );
  }
});
