export const DEFAULT_LLM_MODEL = 'deepseek/deepseek-v4-flash';

export type ModelPurpose = 'wiki' | 'ask';

const ASK_MODEL_TASKS = new Set(['query', 'query-rewrite', 'rerank']);

const WIKI_MODEL_TASKS = new Set([
  'ingest',
  'selection-wiki',
  'contextualize-chunk',
  'source_summarize',
  'relation_extract',
  'categorize',
  'lint',
  'repair_merge',
  'repair_orphan',
  'repair_conflict',
]);

export function modelPurposeForTask(task?: string): ModelPurpose {
  if (task && ASK_MODEL_TASKS.has(task)) return 'ask';
  if (task && WIKI_MODEL_TASKS.has(task)) return 'wiki';
  return 'wiki';
}
