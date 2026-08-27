import { getDb, type CompoundDB } from './db';

const PRIVATE_STORAGE_KEYS = [
  'compound:lastSyncCursor',
  'compound:offline-since',
  'compound:syncMeta',
  'compound:syncQuarantine',
  'compound_active_lint_run',
  'compound_active_repair_run',
  'compound_admin_token',
  'compound_is_sample',
  'compound_last_lint',
  'compound_llm_api_key',
  'compound_llm_api_url',
  'compound_llm_config',
  'compound_llm_model',
  'compound_recent_command_items',
  'compound_recent_imports',
  'compound_review_history',
  'compound_seeded',
  'compound_selection_wiki_runs_v1',
] as const;

const PRIVATE_STORAGE_PREFIXES = ['compound_note_draft_', 'compound:source-draft:'] as const;

function clearStorage(storage: Storage): void {
  for (const key of PRIVATE_STORAGE_KEYS) storage.removeItem(key);

  const prefixedKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && PRIVATE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      prefixedKeys.push(key);
    }
  }
  for (const key of prefixedKeys) storage.removeItem(key);
}

/**
 * Deletes browser-only private knowledge while leaving server data and display
 * preferences untouched. A database argument is accepted for deterministic tests.
 */
export async function clearPrivateOfflineCache(database: CompoundDB = getDb()): Promise<void> {
  const tables = [
    database.sources,
    database.concepts,
    database.activity,
    database.askHistory,
    ...(database.offlineOutbox ? [database.offlineOutbox] : []),
    ...(database.syncMeta ? [database.syncMeta] : []),
  ];
  await database.transaction('rw', tables, async () => {
    await Promise.all([
      database.sources.clear(),
      database.concepts.clear(),
      database.activity.clear(),
      database.askHistory.clear(),
      database.offlineOutbox?.clear(),
      database.syncMeta?.clear(),
    ]);
  });

  if (typeof window === 'undefined') return;
  try {
    clearStorage(window.localStorage);
  } catch {
    // Ignore — storage may be unavailable after IndexedDB was cleared.
  }
  try {
    clearStorage(window.sessionStorage);
  } catch {
    // Ignore — session storage may be unavailable.
  }
}
