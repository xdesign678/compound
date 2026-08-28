import { getDb, type CompoundDB } from './db';
import type { SyncMetaRecord } from './offline-outbox';
import type { ActivityLog, AskMessage, Concept, Source } from './types';

export interface LocalRecoveryExport {
  format: 'compound-local-recovery';
  version: 1;
  exportedAt: number;
  sources: Source[];
  concepts: Concept[];
  activity: ActivityLog[];
  askHistory: AskMessage[];
  syncMeta: SyncMetaRecord | null;
}

export interface LocalRecoveryDatabase {
  sources: Pick<CompoundDB['sources'], 'toArray'>;
  concepts: Pick<CompoundDB['concepts'], 'toArray'>;
  activity: Pick<CompoundDB['activity'], 'toArray'>;
  askHistory: Pick<CompoundDB['askHistory'], 'toArray'>;
  syncMeta: Pick<CompoundDB['syncMeta'], 'get'>;
}

async function readLocalRecoverySnapshot(
  database: LocalRecoveryDatabase,
  exportedAt: number,
): Promise<LocalRecoveryExport> {
  const [sources, concepts, activity, askHistory, syncMeta] = await Promise.all([
    database.sources.toArray(),
    database.concepts.toArray(),
    database.activity.toArray(),
    database.askHistory.toArray(),
    database.syncMeta.get('current'),
  ]);

  return {
    format: 'compound-local-recovery',
    version: 1,
    exportedAt,
    sources,
    concepts,
    activity,
    askHistory,
    syncMeta: syncMeta ?? null,
  };
}

function supportsReadTransaction(database: LocalRecoveryDatabase): database is CompoundDB {
  return 'transaction' in database && typeof database.transaction === 'function';
}

/** Reads only this browser's Dexie recovery state; it never calls a server API. */
export async function exportLocalRecoverySnapshot(
  database: LocalRecoveryDatabase = getDb(),
  exportedAt = Date.now(),
): Promise<LocalRecoveryExport> {
  if (!supportsReadTransaction(database)) {
    return readLocalRecoverySnapshot(database, exportedAt);
  }
  return database.transaction(
    'r',
    [
      database.sources,
      database.concepts,
      database.activity,
      database.askHistory,
      database.syncMeta,
    ],
    () => readLocalRecoverySnapshot(database, exportedAt),
  );
}

export function serializeLocalRecoveryExport(snapshot: LocalRecoveryExport): string {
  return JSON.stringify(snapshot, null, 2);
}

export function buildLocalRecoveryExportFilename(date = new Date()): string {
  const timestamp = date.toISOString().replace(/[:.]/g, '-');
  return `compound-local-recovery-${timestamp}.json`;
}
