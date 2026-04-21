import Dexie, { type Table } from 'dexie';
import { normalizeCategoryState } from './category-normalization';
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
    // v3: index externalKey on sources for fast dedup lookups (GitHub / Obsidian sync)
    this.version(3).stores({
      sources: 'id, ingestedAt, type, externalKey',
      concepts: 'id, updatedAt, createdAt, *sources, *related',
      activity: 'id, at, type',
      askHistory: 'id, at',
    });
    // v4: add *categoryKeys MultiEntry index for category filtering
    this.version(4).stores({
      sources: 'id, ingestedAt, type, externalKey',
      concepts: 'id, updatedAt, createdAt, *sources, *related, *categoryKeys',
      activity: 'id, at, type',
      askHistory: 'id, at',
    }).upgrade(tx => {
      // Backfill existing concepts with empty categories
      return tx.table('concepts').toCollection().modify(concept => {
        if (!concept.categories) concept.categories = [];
        if (!concept.categoryKeys) concept.categoryKeys = [];
      });
    });
    this.version(5).stores({
      sources: 'id, ingestedAt, type, externalKey',
      concepts: 'id, updatedAt, createdAt, *sources, *related, *categoryKeys',
      activity: 'id, at, type',
      askHistory: 'id, at',
    }).upgrade(tx => {
      return tx.table('concepts').toCollection().modify(concept => {
        const normalized = normalizeCategoryState({
          categories: concept.categories || [],
          categoryKeys: concept.categoryKeys || [],
        });
        concept.categories = normalized.categories;
        concept.categoryKeys = normalized.categoryKeys;
      });
    });
    this.version(6).stores({
      sources: 'id, ingestedAt, type, externalKey',
      concepts: 'id, updatedAt, createdAt, *sources, *related, *categoryKeys',
      activity: 'id, at, type, [type+at]',
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
