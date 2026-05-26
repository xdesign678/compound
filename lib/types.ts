export type SourceType = 'link' | 'text' | 'file' | 'article' | 'book' | 'pdf' | 'gist';
export type ContentStatus = 'partial' | 'full';

export interface Source {
  id: string;
  title: string;
  type: SourceType;
  author?: string;
  url?: string;
  rawContent: string;
  ingestedAt: number;
  contentStatus?: ContentStatus;
  /**
   * 外部同步来源的唯一标识，用于去重与增量更新。
   * 约定格式：
   *   - `obsidian:{path}|{size}|{mtime}`（本地 Obsidian 导入）
   *   - `github:{owner}/{repo}:{path}@{sha}`（GitHub 同步）
   */
  externalKey?: string;
  lastSyncedCommitSha?: string;
}

export interface CategoryTag {
  primary: string;
  secondary?: string;
}

export interface Concept {
  id: string;
  title: string;
  summary: string;
  body: string;
  sources: string[];
  related: string[];
  createdAt: number;
  updatedAt: number;
  version: number;
  contentStatus?: ContentStatus;
  categories: CategoryTag[];
  categoryKeys: string[];
}

export interface ConceptVersion {
  id: string;
  conceptId: string;
  version: number;
  previousBody?: string;
  nextBody: string;
  sourceIds: string[];
  changeSummary: string;
  createdAt: number;
}

export type ActivityType = 'ingest' | 'query' | 'lint';

export interface ActivityLog {
  id: string;
  type: ActivityType;
  title: string;
  details: string;
  status?: 'running' | 'success' | 'error';
  relatedSourceIds?: string[];
  relatedConceptIds?: string[];
  at: number;
}

export type AskStageKey = 'rewrite' | 'retrieve' | 'graph' | 'rerank' | 'synthesize';

export interface AskMessageStage {
  key: AskStageKey;
  status: 'running' | 'done';
  /** Technical 副标 — short factual sentence ("召回 24 个概念") */
  detail?: string;
  /** Concept titles surfaced during retrieval (for chip display). */
  conceptTitles?: string[];
  startedAt?: number;
  durationMs?: number;
}

export interface AskMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  citedConcepts?: string[];
  faithfulness?: {
    score: number;
    level: 'low' | 'mid' | 'high';
  };
  savedAsConceptId?: string;
  suggestedTitle?: string;
  suggestedSummary?: string;
  suggestedQuestions?: string[];
  /** Captured RAG pipeline stages, when available. */
  stages?: AskMessageStage[];
  at: number;
}

export interface LlmConfig {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  askModel?: string;
  wikiModel?: string;
}

export interface IngestRequest {
  source: {
    title: string;
    type: SourceType;
    author?: string;
    url?: string;
    rawContent: string;
    externalKey?: string;
  };
  existingConcepts?: Array<{ id: string; title: string; summary: string }>;
  existingCategories?: string[];
  llmConfig?: LlmConfig;
}

export interface IngestResponse {
  newConcepts: Array<{
    title: string;
    summary: string;
    body: string;
    relatedConceptIds: string[];
    categories?: CategoryTag[];
  }>;
  updatedConcepts: Array<{
    id: string;
    newBody: string;
    newSummary?: string;
    addRelatedIds?: string[];
  }>;
  activitySummary: string;
}

export interface PersistedIngestResponse {
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
    relations?: number;
  };
}

export interface SelectionWikiRequest {
  selection: string;
  /** 用户当前所在概念页 id；新概念会与之建立 related 关联。 */
  sourceConceptId?: string;
  /** 当前概念页标题，作为额外上下文。 */
  contextTitle?: string;
  llmConfig?: LlmConfig;
}

export interface SelectionWikiResponse {
  status: 'created' | 'duplicate';
  conceptId: string;
  /** 受影响（新建 / 双向链接更新）的全部概念，便于客户端镜像写入 Dexie。 */
  concepts: Concept[];
  activity: ActivityLog;
}

export type SelectionWikiRunStatus = 'running' | 'done' | 'failed';
export type SelectionWikiRunPhase =
  | 'queued'
  | 'loading_context'
  | 'generating'
  | 'persisting'
  | 'done';

export interface SelectionWikiRunStartResponse {
  runId: string;
  status: Extract<SelectionWikiRunStatus, 'running'>;
  phase: SelectionWikiRunPhase;
  selectionPreview: string;
  startedAt: number;
}

export interface SelectionWikiRunStatusResponse {
  runId: string;
  status: SelectionWikiRunStatus;
  phase: SelectionWikiRunPhase;
  selectionPreview: string;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  result: SelectionWikiResponse | null;
}

export interface QueryRequest {
  question: string;
  concepts: Array<{ id: string; title: string; summary: string; body?: string }>;
  conversationHistory?: Array<{ role: 'user' | 'ai'; text: string }>;
  llmConfig?: LlmConfig;
}

export interface QueryResponse {
  answer: string;
  citedConceptIds: string[];
  citedConcepts?: Array<{ id: string; title: string }>;
  retrievedConcepts?: Array<{ id: string; title: string }>;
  archivable: boolean;
  faithfulness?: {
    score: number;
    level: 'low' | 'mid' | 'high';
  };
  suggestedTitle?: string;
  suggestedSummary?: string;
  /** Follow-up questions the user might be interested in. */
  suggestedQuestions?: string[];
  /**
   * The history-aware rewrite the retriever used (only set when it differs
   * from the original question). Surfaced for UX/diagnostics only — clients
   * don't need to consume it.
   */
  rewrittenQuestion?: string;
  /**
   * "remote-emb": real embedding endpoint live. "fts-only": no embedding
   * configured, retrieval is BM25 + graph only. Surfaced in health probe.
   */
  retrievalMode?: 'remote-emb' | 'fts-only' | 'local-hash';
  rerankUsed?: 'llm' | 'fallback';
  rerankReason?: string;
  stageDurations?: Partial<Record<AskStageKey, number>>;
}

export interface LintRequest {
  concepts: Array<{ id: string; title: string; summary: string; related: string[] }>;
  llmConfig?: LlmConfig;
}

export interface LintResponse {
  findings: Array<{
    type: 'contradiction' | 'orphan' | 'missing-link' | 'duplicate';
    message: string;
    conceptIds: string[];
  }>;
}

export interface CategorizeRequest {
  concepts: Array<{ id: string; title: string; summary: string; body: string }>;
  existingCategories: string[];
  llmConfig?: LlmConfig;
}

export interface CategorizeResponse {
  results: Array<{
    id: string;
    categories: CategoryTag[];
  }>;
}

// ---- Category Wiki (二级标签综合 Wiki) ----

export interface CategoryWiki {
  id: string;
  primaryCategory: string;
  secondaryCategory: string;
  bodyMd: string;
  tocJson: string;
  conceptIds: string[];
  conceptIdsHash: string;
  model?: string;
  promptVersion?: string;
  generatedAt: number;
  stale: boolean;
}

export type CategoryWikiRunStatus = 'running' | 'done' | 'failed';
export type CategoryWikiRunPhase =
  | 'queued'
  | 'loading_context'
  | 'generating'
  | 'persisting'
  | 'done';

export interface CategoryWikiRunStartResponse {
  runId: string;
  status: Extract<CategoryWikiRunStatus, 'running'>;
  phase: CategoryWikiRunPhase;
  startedAt: number;
}

export interface CategoryWikiRunStatusResponse {
  runId: string;
  status: CategoryWikiRunStatus;
  phase: CategoryWikiRunPhase;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface CategoryWikiRunSummary {
  runId: string;
  primary: string;
  secondary: string;
  status: CategoryWikiRunStatus;
  phase: CategoryWikiRunPhase;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface CategoryWikiRequest {
  primary: string;
  secondary: string;
  llmConfig?: LlmConfig;
}
