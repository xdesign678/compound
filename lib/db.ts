import Dexie, { type Table } from 'dexie';
import type { Source, Concept, ActivityLog, AskMessage } from './types';

export class CompoundDB extends Dexie {
  sources!: Table<Source, string>;
  concepts!: Table<Concept, string>;
  activity!: Table<ActivityLog, string>;
  askHistory!: Table<AskMessage, string>;

  constructor() {
    super('compound-db');
    this.version(1).stores({
      sources: 'id, ingestedAt, type',
      concepts: 'id, updatedAt, createdAt',
      activity: 'id, at, type',
      askHistory: 'id, at',
    });
    // v2: add MultiEntry indexes for sources/related arrays on concepts
    this.version(2).stores({
      sources: 'id, ingestedAt, type',
      concepts: 'id, updatedAt, createdAt, *sources, *related',
      activity: 'id, at, type',
      askHistory: 'id, at',
    });
  }
}

let dbInstance: CompoundDB | null = null;

export function getDb(): CompoundDB {
  if (typeof window === 'undefined') {
    throw new Error('DB only available in browser');
  }
  if (!dbInstance) {
    dbInstance = new CompoundDB();
  }
  return dbInstance;
}
