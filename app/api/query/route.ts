import { NextResponse } from 'next/server';
import { chat, parseJSON } from '@/lib/gateway';
import { QUERY_SYSTEM_PROMPT } from '@/lib/prompts';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import { enforceContentLength, readLlmConfigOverride } from '@/lib/request-guards';
import {
  formatQueryContextForPrompt,
  wikiRepo,
  type QueryContext,
  type SourceChunk,
  type ConceptEvidence,
} from '@/lib/wiki-db';
import { getEmbeddingMode, hybridSearchWikiContext } from '@/lib/embedding';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';
import { rewriteQuery } from '@/lib/retrieval/query-rewrite';
import { reciprocalRankFusion } from '@/lib/retrieval/rrf';
import { graphExpand } from '@/lib/retrieval/graph-expand';
import { llmRerank, type RerankCandidate } from '@/lib/retrieval/llm-rerank';
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
  finalContext: QueryContext;
}

async function runRetrievalPipeline(opts: {
  question: string;
  history?: Array<{ role: 'user' | 'ai'; text: string }>;
  llmConfig?: LlmConfig;
  requestConcepts: Concept[];
}): Promise<RetrievalResult> {
  // Step 1: history-aware query rewrite
  const { rewritten, used: rewriteUsed } = await rewriteQuery({
    question: opts.question,
    history: opts.history,
    llmConfig: opts.llmConfig,
  });
  const effectiveQuery = rewritten || opts.question;

  // Step 2: hybrid retrieval (FTS + vector when configured)
  const serverContext = await getServerContext(effectiveQuery);
  const embeddingMode = getEmbeddingMode();
  const retrievalMode: RetrievalResult['retrievalMode'] =
    embeddingMode === 'remote' ? 'remote-emb' : 'fts-only';

  // Step 3: graph 1-hop expansion off the seed concepts
  const seedConceptIds = serverContext.concepts.slice(0, 8).map((c) => c.id);
  const graph = graphExpand(seedConceptIds, 5);
  const graphConceptIds = new Set(graph.concepts.map((c) => c.id));

  // Step 4: RRF fusion across (a) FTS-ordered concepts (b) request mentions
  // (c) graph-expanded neighbors. Chunks fuse separately.
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
  const rerank = await llmRerank({
    query: effectiveQuery,
    candidates,
    topK: FINAL_TOP_K,
    llmConfig: opts.llmConfig,
  });

  const conceptsById = new Map(concepts.map((c) => [c.id, c]));
  const chunksById = new Map(chunks.map((c) => [c.id, c]));
  const partitioned = partitionRanked(rerank.ranked, conceptsById, chunksById);

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
 * 6. answer synthesis with citations
 * 7. citation faithfulness check
 *
 * Body: `QueryRequest` — `question` is required (<= 2k chars). Optional
 * `concepts` (<= 500) and `conversationHistory` (last 6 turns are kept).
 *
 * Guards: admin token, LLM rate limit, 512KB body cap.
 */
export const POST = withRequestTracing(async (req: Request) => {
  const denied =
    requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = (await req.json()) as QueryRequest;
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

    const retrieval = await runRetrievalPipeline({
      question,
      history,
      llmConfig,
      requestConcepts,
    });

    const concepts = mergeConcepts(requestConcepts, retrieval.finalContext.concepts).slice(
      0,
      MAX_CONCEPTS,
    );
    const wikiDump =
      formatQueryContextForPrompt({
        concepts,
        evidence: retrieval.finalContext.evidence,
        chunks: retrieval.finalContext.chunks,
      }) || '(Wiki 为空)';

    const historyBlock = history
      ? history
          .map((m) => `${m.role === 'user' ? '用户' : 'Wiki'}: ${m.text.slice(0, 2000)}`)
          .join('\n')
      : '';

    const userPrompt = `# 用户的 Wiki 检索上下文\n\n${wikiDump}\n\n---\n\n${
      historyBlock ? `# 最近对话\n\n${historyBlock}\n\n---\n\n` : ''
    }# 当前问题\n\n${question}\n\n${retrieval.rewrittenQuestion !== question ? `# 改写后的检索 query\n\n${retrieval.rewrittenQuestion}\n\n---\n\n` : ''}请优先基于「相关概念页」回答；当概念页不足时，再参考「证据链」和「原文片段候选」。按 system prompt 定义的 JSON schema 输出，只输出 JSON。`;

    const raw = await chat({
      messages: [
        { role: 'system', content: QUERY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.35,
      maxTokens: 2200,
      llmConfig,
      task: 'query',
    });

    const parsed = parseJSON<
      QueryResponse & { rewrittenQuestion?: string; retrievalMode?: string }
    >(raw);
    parsed.citedConceptIds = parsed.citedConceptIds || [];
    parsed.answer = parsed.answer || '(无回答)';
    parsed.archivable = Boolean(parsed.archivable);

    // Ensure citations reference real concept ids
    const validIds = new Set(concepts.map((c) => c.id));
    parsed.citedConceptIds = parsed.citedConceptIds.filter((id) => validIds.has(id));

    // Faithfulness check: warn (in logs only) when [CX] markers don't have
    // token-level support in the cited bodies. Doesn't reject the answer —
    // user-visible UX would be too disruptive — but produces an actionable
    // signal for runbooks.
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
      if (faithfulness.score < 0.5 && faithfulness.unsupported.length > 0) {
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

    return NextResponse.json(parsed);
  } catch (err) {
    logger.error('query.failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      {
        error: 'Query processing failed. Please check your API configuration.',
        requestId: getRequestContext()?.requestId,
      },
      { status: 500 },
    );
  }
});
