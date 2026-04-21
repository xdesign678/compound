import { toNormalizedCategoryKeys } from './category-normalization';

export type SourceType = 'link' | 'text' | 'file' | 'article' | 'book' | 'pdf' | 'gist';

export interface Source {
  id: string;
  title: string;
  type: SourceType;
  author?: string;
  url?: string;
  rawContent: string;
  ingestedAt: number;
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
  categories: CategoryTag[];
  categoryKeys: string[];
}

export type ActivityType = 'ingest' | 'query' | 'lint';

export interface ActivityLog {
  id: string;
  type: ActivityType;
  title: string;
  details: string;
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
  };
  existingConcepts: Array<{ id: string; title: string; summary: string }>;
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
