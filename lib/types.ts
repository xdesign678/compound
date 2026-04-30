import { toNormalizedCategoryKeys } from './category-normalization';

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

export interface AskMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  citedConcepts?: string[];
  savedAsConceptId?: string;
  suggestedTitle?: string;
  suggestedSummary?: string;
  suggestedQuestions?: string[];
  at: number;
}

export interface LlmConfig {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
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

export interface QueryRequest {
  question: string;
  concepts: Array<{ id: string; title: string; summary: string; body?: string }>;
  conversationHistory?: Array<{ role: 'user' | 'ai'; text: string }>;
  llmConfig?: LlmConfig;
}

export interface QueryResponse {
  answer: string;
  citedConceptIds: string[];
  archivable: boolean;
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

/** Derive flat categoryKeys from structured categories for Dexie MultiEntry index. */
export function toCategoryKeys(categories: CategoryTag[]): string[] {
  return toNormalizedCategoryKeys(categories);
}
