import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAndApplySnapshotPages } from './cloud-sync';
import type { SyncMetaRecord } from './offline-outbox';
import type { ActivityLog, AskMessage, Concept, Source } from './types';
import type { CompoundDB } from './db';

function memoryTable<T extends { id: string }>(initial: T[] = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  let writes = 0;
  let deletes = 0;
  return {
    rows,
    get writes() {
      return writes;
    },
    get deletes() {
      return deletes;
    },
    async bulkGet(ids: string[]) {
      return ids.map((id) => rows.get(id));
    },
    async bulkPut(items: T[]) {
      writes += items.length;
      for (const item of items) rows.set(item.id, { ...item });
    },
    async bulkDelete(ids: string[]) {
      deletes += ids.length;
      for (const id of ids) rows.delete(id);
    },
    async count() {
      return rows.size;
    },
    toCollection() {
      return {
        primaryKeys: async () => [...rows.keys()],
      };
    },
  };
}

function memoryDb(seed?: {
  sources?: Source[];
  concepts?: Concept[];
  activity?: ActivityLog[];
  ask?: AskMessage[];
  meta?: SyncMetaRecord;
}) {
  const sources = memoryTable(seed?.sources ?? []);
  const concepts = memoryTable(seed?.concepts ?? []);
  const activity = memoryTable(seed?.activity ?? []);
  const askHistory = memoryTable(seed?.ask ?? []);
  const syncMetaRows = new Map<string, SyncMetaRecord>();
  if (seed?.meta) syncMetaRows.set('current', { ...seed.meta });
  const db = {
    sources,
    concepts,
    activity,
    askHistory,
    syncMeta: {
      async get(id: string) {
        return syncMetaRows.get(id);
      },
      async put(record: SyncMetaRecord) {
        syncMetaRows.set(record.id, { ...record });
      },
    },
    async transaction(_mode: string, _tables: unknown[], scope: () => Promise<void>) {
      await scope();
    },
  };
  return { db: db as unknown as CompoundDB, sources, concepts, activity, askHistory, syncMetaRows };
}

function page(input: {
  datasetId?: string;
  generation?: number;
  upperCursor?: number;
  offset?: number;
  sources?: Source[];
  concepts?: Concept[];
  activity?: ActivityLog[];
  ask?: AskMessage[];
  deleted?: string[];
  deletedByTable?: Partial<Record<'sources' | 'concepts' | 'activity' | 'ask', string[]>>;
  mode?: 'full' | 'delta';
  hasMore?: boolean;
  totalSources?: number;
  totalConcepts?: number;
  totalActivity?: number;
  totalAsk?: number;
  limit?: number;
}) {
  const sources = input.sources ?? [];
  const concepts = input.concepts ?? [];
  const activity = input.activity ?? [];
  const ask = input.ask ?? [];
  const limit = input.limit ?? 1;
  const offset = input.offset ?? 0;
  const totalSources = input.totalSources ?? sources.length;
  const totalConcepts = input.totalConcepts ?? concepts.length;
  const totalActivity = input.totalActivity ?? activity.length;
  const totalAsk = input.totalAsk ?? ask.length;
  const nextOffset = offset + limit;
  const computedHasMore =
    nextOffset < totalSources ||
    nextOffset < totalConcepts ||
    nextOffset < totalActivity ||
    nextOffset < totalAsk;
  return {
    fetchedAt: 10,
    mode: input.mode ?? 'full',
    pagination: {
      limit,
      offset,
      totalSources,
      totalConcepts,
      totalActivity,
      totalAsk,
    },
    counts: {
      sources: sources.length,
      concepts: concepts.length,
      activity: activity.length,
      ask: ask.length,
    },
    sources,
    concepts,
    activity,
    ask,
    sync: {
      cursor: input.upperCursor ?? 9,
      upperCursor: input.upperCursor ?? 9,
      hasMore: input.hasMore ?? computedHasMore,
      deleted: {
        sources: input.deletedByTable?.sources ?? input.deleted ?? [],
        concepts: input.deletedByTable?.concepts ?? [],
        activity: input.deletedByTable?.activity ?? [],
        ask: input.deletedByTable?.ask ?? [],
      },
    },
    dataset: { datasetId: input.datasetId ?? 'ds-prod', generation: input.generation ?? 1 },
  };
}

const localSource: Source = {
  id: 'local-s',
  title: 'local',
  type: 'text',
  rawContent: 'keep me',
  ingestedAt: 1,
};

const localConcept: Concept = {
  id: 'local-c',
  title: 'local concept',
  summary: 'summary',
  body: 'body',
  sources: [],
  related: [],
  createdAt: 1,
  updatedAt: 1,
  version: 1,
  categories: [],
  categoryKeys: [],
};

const localActivity: ActivityLog = {
  id: 'local-a',
  type: 'ingest',
  title: 'local activity',
  details: 'keep activity',
  at: 1,
};

const localAsk: AskMessage = {
  id: 'local-q',
  role: 'user',
  text: 'keep ask',
  at: 1,
};

function fourTableDb(cursor: number) {
  return memoryDb({
    sources: [localSource],
    concepts: [localConcept],
    activity: [localActivity],
    ask: [localAsk],
    meta: { id: 'current', cursor, datasetId: 'ds-prod', generation: 1 },
  });
}

function assertFourTablesUnchanged(seeded: ReturnType<typeof memoryDb>, label: string) {
  const tableCases = [
    { name: 'sources', table: seeded.sources, expected: localSource },
    { name: 'concepts', table: seeded.concepts, expected: localConcept },
    { name: 'activity', table: seeded.activity, expected: localActivity },
    { name: 'ask', table: seeded.askHistory, expected: localAsk },
  ];
  for (const tableCase of tableCases) {
    assert.equal(tableCase.table.writes, 0, `${label}: ${tableCase.name} writes`);
    assert.equal(tableCase.table.deletes, 0, `${label}: ${tableCase.name} deletes`);
    assert.deepEqual(
      tableCase.table.rows.get(tableCase.expected.id),
      tableCase.expected,
      `${label}: ${tableCase.name} local row`,
    );
  }
}

test('mixed-identity pages write zero knowledge rows, zero tombstones, and do not advance cursor', async () => {
  const seeded = fourTableDb(40);
  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', cursor: 40, datasetId: 'ds-prod', generation: 1 },
    forceFull: true,
    pages: [
      page({
        offset: 0,
        hasMore: true,
        sources: [{ ...localSource, id: 'remote-a', title: 'A', ingestedAt: 2 }],
      }),
      page({
        offset: 1,
        datasetId: 'ds-other',
        sources: [{ ...localSource, id: 'remote-b', title: 'B', ingestedAt: 2 }],
      }),
    ],
  });

  assert.equal(result.result.destructiveReconcileBlocked, true);
  assert.equal(result.result.reconcileMode, 'isolated');
  assert.equal(result.result.applied.sources, 0);
  assertFourTablesUnchanged(seeded, 'mixed identity envelope');
  assert.equal(seeded.sources.rows.has('remote-a'), false);
  assert.equal(seeded.syncMetaRows.get('current')?.cursor, 40);
  assert.equal(seeded.syncMetaRows.get('current')?.quarantine?.reason, 'envelope_mismatch');
});

test('delta pages that disagree on upperCursor never apply tombstones', async () => {
  const seeded = fourTableDb(4);
  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: false,
    pages: [
      {
        ...page({
          mode: 'delta',
          upperCursor: 9,
          deleted: ['local-s'],
          sources: [],
          totalSources: 0,
        }),
        pagination: undefined,
        sync: {
          cursor: 5,
          upperCursor: 9,
          hasMore: true,
          deleted: { sources: ['local-s'], concepts: [], activity: [], ask: [] },
        },
      },
      {
        ...page({ mode: 'delta', upperCursor: 3, sources: [], totalSources: 0 }),
        pagination: undefined,
        sync: {
          cursor: 9,
          upperCursor: 3,
          hasMore: false,
          deleted: { sources: ['local-s'], concepts: [], activity: [], ask: [] },
        },
      },
    ],
  });

  assert.equal(result.result.destructiveReconcileBlocked, true);
  assertFourTablesUnchanged(seeded, 'delta upper cursor mismatch');
});

test('matching identity full deletes stale server rows and preserves browser-only history', async () => {
  const keepActivity: ActivityLog = {
    id: 'keep-a',
    type: 'ingest',
    title: 'keep',
    details: '',
    at: 8,
  };
  const keepAsk: AskMessage = { id: 'keep-q', role: 'user', text: 'keep', at: 8 };
  const keepConcept = { ...localConcept, id: 'keep-c', updatedAt: 8 };
  const { db, sources, concepts, activity, askHistory, syncMetaRows } = memoryDb({
    sources: [localSource, { ...localSource, id: 'keep' }],
    concepts: [localConcept, keepConcept],
    activity: [{ id: 'local-a', type: 'ingest', title: 'stale', details: '', at: 1 }, keepActivity],
    ask: [{ id: 'local-q', role: 'user', text: 'stale', at: 1 }, keepAsk],
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
  });
  const keep: Source = { ...localSource, id: 'keep', title: 'keep', ingestedAt: 8 };
  const result = await validateAndApplySnapshotPages({
    db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: true,
    pages: [
      page({
        offset: 0,
        hasMore: false,
        totalSources: 1,
        totalConcepts: 1,
        totalActivity: 1,
        totalAsk: 1,
        sources: [keep],
        concepts: [keepConcept],
        activity: [keepActivity],
        ask: [keepAsk],
      }),
    ],
  });

  assert.equal(result.result.destructiveReconcileBlocked, false);
  assert.equal(result.result.reconcileMode, 'destructive_full');
  assert.equal(sources.rows.has('local-s'), false);
  assert.equal(sources.rows.has('keep'), true);
  assert.equal(concepts.rows.has('local-c'), false);
  assert.equal(concepts.rows.has('keep-c'), true);
  assert.equal(activity.rows.has('local-a'), true);
  assert.equal(activity.rows.has('keep-a'), true);
  assert.equal(askHistory.rows.has('local-q'), true);
  assert.equal(askHistory.rows.has('keep-q'), true);
  assert.equal(syncMetaRows.get('current')?.cursor, 9);
});

test('matching identity without a cursor isolates non-empty local knowledge', async () => {
  const seeded = memoryDb({
    sources: [localSource],
    concepts: [localConcept],
    activity: [localActivity],
    ask: [localAsk],
    meta: { id: 'current', datasetId: 'ds-prod', generation: 1 },
  });
  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', datasetId: 'ds-prod', generation: 1 },
    forceFull: true,
    pages: [
      page({
        sources: [{ ...localSource, title: 'remote overwrite', ingestedAt: 99 }],
        concepts: [{ ...localConcept, title: 'remote overwrite', updatedAt: 99 }],
        activity: [{ ...localActivity, title: 'remote overwrite', at: 99 }],
        ask: [{ ...localAsk, text: 'remote overwrite', at: 99 }],
        totalSources: 1,
        totalConcepts: 1,
        totalActivity: 1,
        totalAsk: 1,
        hasMore: false,
      }),
    ],
  });

  assert.equal(result.result.destructiveReconcileBlocked, true);
  assert.equal(result.result.quarantine?.reason, 'missing_cursor');
  assertFourTablesUnchanged(seeded, 'missing cursor');
  assert.equal(seeded.syncMetaRows.get('current')?.cursor, undefined);
});

test('empty local plus complete identity binds and advances cursor on a non-empty full', async () => {
  const { db, sources, syncMetaRows } = memoryDb({
    meta: { id: 'current' },
  });
  const remote: Source = { ...localSource, id: 'remote-s', title: 'remote', ingestedAt: 8 };
  const result = await validateAndApplySnapshotPages({
    db,
    meta: { id: 'current' },
    forceFull: true,
    pages: [page({ sources: [remote], totalSources: 1, hasMore: false })],
  });

  assert.equal(result.result.destructiveReconcileBlocked, false);
  assert.equal(sources.writes, 1);
  assert.equal(sources.rows.has('remote-s'), true);
  assert.equal(syncMetaRows.get('current')?.datasetId, 'ds-prod');
  assert.equal(syncMetaRows.get('current')?.generation, 1);
  assert.equal(syncMetaRows.get('current')?.cursor, 9);
});

test('unbound local with only activity/ask stays isolated with zero knowledge writes', async () => {
  const { db, sources, activity, syncMetaRows } = memoryDb({
    activity: [{ id: 'a-local', type: 'ingest', title: 'local log', details: '', at: 1 }],
    meta: { id: 'current' },
  });
  const remote: Source = { ...localSource, id: 'remote-s', title: 'remote', ingestedAt: 8 };
  const result = await validateAndApplySnapshotPages({
    db,
    meta: { id: 'current' },
    forceFull: true,
    pages: [page({ sources: [remote], totalSources: 1, hasMore: false })],
  });

  assert.equal(result.result.destructiveReconcileBlocked, true);
  assert.equal(result.result.quarantine?.reason, 'first_bind_nonempty');
  assert.equal(sources.writes, 0);
  assert.equal(sources.deletes, 0);
  assert.equal(sources.rows.has('remote-s'), false);
  assert.equal(activity.rows.has('a-local'), true);
  assert.equal(syncMetaRows.get('current')?.cursor, undefined);
});

test('identity mismatch and cursor rollback isolate with zero knowledge writes', async () => {
  const remoteOverwriteRows = {
    sources: [
      { ...localSource, title: 'remote source', rawContent: 'pollute source', ingestedAt: 99 },
    ],
    concepts: [
      {
        ...localConcept,
        title: 'remote concept',
        summary: 'pollute concept',
        body: 'pollute concept body',
        updatedAt: 99,
      },
    ],
    activity: [{ ...localActivity, title: 'remote activity', details: 'pollute activity', at: 99 }],
    ask: [{ ...localAsk, text: 'pollute ask', at: 99 }],
  };
  const mismatchDb = fourTableDb(4);
  const mismatch = await validateAndApplySnapshotPages({
    db: mismatchDb.db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: true,
    pages: [
      page({
        datasetId: 'ds-other',
        generation: 1,
        ...remoteOverwriteRows,
        totalSources: 1,
        totalConcepts: 1,
        totalActivity: 1,
        totalAsk: 1,
        hasMore: false,
      }),
    ],
  });
  assert.equal(mismatch.result.destructiveReconcileBlocked, true);
  assertFourTablesUnchanged(mismatchDb, 'identity mismatch');
  assert.equal(mismatchDb.syncMetaRows.get('current')?.cursor, 4);

  const rollbackDb = fourTableDb(900);
  const rollback = await validateAndApplySnapshotPages({
    db: rollbackDb.db,
    meta: { id: 'current', cursor: 900, datasetId: 'ds-prod', generation: 1 },
    forceFull: true,
    pages: [
      page({
        upperCursor: 12,
        ...remoteOverwriteRows,
        totalSources: 1,
        totalConcepts: 1,
        totalActivity: 1,
        totalAsk: 1,
        hasMore: false,
      }),
    ],
  });
  assert.equal(rollback.result.destructiveReconcileBlocked, true);
  assert.equal(rollback.result.quarantine?.reason, 'cursor_rollback');
  assertFourTablesUnchanged(rollbackDb, 'cursor rollback');
  assert.equal(rollbackDb.syncMetaRows.get('current')?.cursor, 900);
});

test('second full page activity and ask rows are applied', async () => {
  const { db, activity, askHistory } = memoryDb({
    meta: { id: 'current', cursor: 1, datasetId: 'ds-prod', generation: 1 },
  });
  const result = await validateAndApplySnapshotPages({
    db,
    meta: { id: 'current', cursor: 1, datasetId: 'ds-prod', generation: 1 },
    forceFull: true,
    pages: [
      page({
        offset: 0,
        limit: 1,
        totalActivity: 2,
        totalAsk: 2,
        totalSources: 0,
        hasMore: true,
        activity: [{ id: 'a-1', type: 'ingest', title: 'one', details: '', at: 1 }],
        ask: [{ id: 'q-1', role: 'user', text: 'q1', at: 1 }],
      }),
      page({
        offset: 1,
        limit: 1,
        totalActivity: 2,
        totalAsk: 2,
        totalSources: 0,
        hasMore: false,
        activity: [{ id: 'a-2', type: 'ingest', title: 'two', details: '', at: 2 }],
        ask: [{ id: 'q-2', role: 'user', text: 'q2', at: 2 }],
      }),
    ],
  });
  assert.equal(result.result.destructiveReconcileBlocked, false);
  assert.equal(activity.rows.has('a-1'), true);
  assert.equal(activity.rows.has('a-2'), true);
  assert.equal(askHistory.rows.has('q-1'), true);
  assert.equal(askHistory.rows.has('q-2'), true);
});

test('truncated snapshot pages write zero knowledge rows', async () => {
  const seeded = fourTableDb(4);
  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: true,
    truncated: true,
    pages: [
      page({
        sources: [{ ...localSource, id: 'remote-s', ingestedAt: 9 }],
        totalSources: 400,
        hasMore: true,
      }),
    ],
  });
  assert.equal(result.result.destructiveReconcileBlocked, true);
  assertFourTablesUnchanged(seeded, 'truncated snapshot');
  assert.equal(seeded.syncMetaRows.get('current')?.cursor, 4);
});

test('full payload missing a row in any table is quarantined before all knowledge writes', async () => {
  const tableCases = ['sources', 'concepts', 'activity', 'ask'] as const;
  for (const tableName of tableCases) {
    const seeded = memoryDb({
      sources: [localSource],
      meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    });
    const complete = page({
      sources: [{ ...localSource, id: 'remote-s' }],
      concepts: [{ ...localConcept, id: 'remote-c' }],
      activity: [{ id: 'remote-a', type: 'ingest', title: 'remote', details: '', at: 2 }],
      ask: [{ id: 'remote-q', role: 'user', text: 'remote', at: 2 }],
      totalSources: 1,
      totalConcepts: 1,
      totalActivity: 1,
      totalAsk: 1,
      hasMore: false,
    });
    complete[tableName] = [];
    const result = await validateAndApplySnapshotPages({
      db: seeded.db,
      meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
      forceFull: true,
      pages: [complete],
    });

    assert.equal(result.result.quarantine?.reason, 'payload_count_mismatch', tableName);
    for (const table of [seeded.sources, seeded.concepts, seeded.activity, seeded.askHistory]) {
      assert.equal(table.writes, 0, tableName);
      assert.equal(table.deletes, 0, tableName);
    }
    assert.equal(seeded.syncMetaRows.get('current')?.cursor, 4, tableName);
  }
});

test('duplicate full entity id across pages is quarantined before all knowledge writes', async () => {
  const duplicateCases = [
    {
      tableName: 'sources',
      payload: { sources: [{ ...localSource, id: 'duplicate-s', ingestedAt: 9 }], totalSources: 2 },
    },
    {
      tableName: 'concepts',
      payload: {
        concepts: [{ ...localConcept, id: 'duplicate-c', updatedAt: 9 }],
        totalConcepts: 2,
      },
    },
    {
      tableName: 'activity',
      payload: {
        activity: [{ id: 'duplicate-a', type: 'ingest', title: 'duplicate', details: '', at: 9 }],
        totalActivity: 2,
      },
    },
    {
      tableName: 'ask',
      payload: {
        ask: [{ id: 'duplicate-q', role: 'user', text: 'duplicate', at: 9 }],
        totalAsk: 2,
      },
    },
  ] satisfies Array<{
    tableName: 'sources' | 'concepts' | 'activity' | 'ask';
    payload: Parameters<typeof page>[0];
  }>;

  for (const duplicateCase of duplicateCases) {
    const seeded = fourTableDb(4);
    const result = await validateAndApplySnapshotPages({
      db: seeded.db,
      meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
      forceFull: true,
      pages: [
        page({ offset: 0, limit: 1, hasMore: true, ...duplicateCase.payload }),
        page({ offset: 1, limit: 1, hasMore: false, ...duplicateCase.payload }),
      ],
    });

    assert.equal(result.result.quarantine?.reason, 'duplicate_entity_id', duplicateCase.tableName);
    assertFourTablesUnchanged(seeded, `duplicate ${duplicateCase.tableName}`);
    assert.equal(seeded.syncMetaRows.get('current')?.cursor, 4, duplicateCase.tableName);
  }
});

test('delta first cursor at or below initial with mutations is quarantined', async () => {
  const seeded = memoryDb({
    sources: [localSource],
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
  });
  const invalid = page({
    mode: 'delta',
    upperCursor: 4,
    sources: [{ ...localSource, id: 'pollution', ingestedAt: 9 }],
    deleted: ['local-s'],
    hasMore: false,
  });
  invalid.pagination = undefined as never;
  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: false,
    pages: [invalid],
  });

  assert.equal(result.result.quarantine?.reason, 'envelope_mismatch');
  assert.equal(seeded.sources.writes, 0);
  assert.equal(seeded.sources.deletes, 0);
  assert.equal(seeded.sources.rows.has('local-s'), true);
  assert.equal(seeded.sources.rows.has('pollution'), false);
  assert.equal(seeded.syncMetaRows.get('current')?.cursor, 4);
});

test('well-formed delta with a mismatched identity is isolated before four-table writes', async () => {
  const seeded = fourTableDb(4);
  const delta = page({
    mode: 'delta',
    datasetId: 'ds-other',
    upperCursor: 9,
    hasMore: false,
  });
  delta.pagination = undefined as never;

  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: false,
    pages: [delta],
  });

  assert.equal(result.result.quarantine?.reason, 'identity_mismatch');
  assertFourTablesUnchanged(seeded, 'delta identity mismatch');
  assert.equal(seeded.syncMetaRows.get('current')?.cursor, 4);
});

test('delta without four deleted arrays is quarantined before four-table writes', async () => {
  const seeded = fourTableDb(4);
  const delta = page({ mode: 'delta', upperCursor: 9, hasMore: false });
  delta.pagination = undefined as never;
  delta.sync.deleted = undefined as never;

  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: false,
    pages: [delta],
  });

  assert.equal(result.result.quarantine?.reason, 'envelope_mismatch');
  assertFourTablesUnchanged(seeded, 'delta missing deleted arrays');
  assert.equal(seeded.syncMetaRows.get('current')?.cursor, 4);
});

test('single empty delta at the unchanged server cursor is valid', async () => {
  const seeded = memoryDb({
    sources: [localSource],
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
  });
  const unchanged = page({
    mode: 'delta',
    upperCursor: 4,
    sources: [],
    totalSources: 0,
    hasMore: false,
  });
  unchanged.pagination = undefined as never;
  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: false,
    pages: [unchanged],
  });

  assert.equal(result.result.destructiveReconcileBlocked, false);
  assert.equal(result.result.reconcileMode, 'delta');
  assert.equal(seeded.sources.writes, 0);
  assert.equal(seeded.sources.deletes, 0);
  assert.equal(seeded.sources.rows.has('local-s'), true);
  assert.equal(seeded.syncMetaRows.get('current')?.cursor, 4);
});

test('trusted delta applies explicit tombstones across all four tables', async () => {
  const seeded = fourTableDb(4);
  const delta = page({
    mode: 'delta',
    upperCursor: 9,
    hasMore: false,
    deletedByTable: {
      sources: [localSource.id],
      concepts: [localConcept.id],
      activity: [localActivity.id],
      ask: [localAsk.id],
    },
  });
  delta.pagination = undefined as never;

  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: false,
    pages: [delta],
  });

  assert.equal(result.result.destructiveReconcileBlocked, false);
  assert.equal(result.result.reconcileMode, 'delta');
  assert.equal(seeded.sources.rows.has(localSource.id), false);
  assert.equal(seeded.concepts.rows.has(localConcept.id), false);
  assert.equal(seeded.activity.rows.has(localActivity.id), false);
  assert.equal(seeded.askHistory.rows.has(localAsk.id), false);
  assert.equal(seeded.syncMetaRows.get('current')?.cursor, 9);
});

test('multi-page delta replays an earlier upsert before a later tombstone', async () => {
  const seeded = fourTableDb(4);
  const remote: Source = {
    ...localSource,
    id: 'ordered-source',
    title: 'upsert before delete',
    ingestedAt: 8,
  };
  const upsertPage = page({
    mode: 'delta',
    upperCursor: 9,
    hasMore: true,
    sources: [remote],
  });
  upsertPage.pagination = undefined as never;
  upsertPage.sync.cursor = 6;
  const deletePage = page({
    mode: 'delta',
    upperCursor: 9,
    hasMore: false,
    deleted: [remote.id],
  });
  deletePage.pagination = undefined as never;

  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: false,
    pages: [upsertPage, deletePage],
  });

  assert.equal(result.result.destructiveReconcileBlocked, false);
  assert.equal(seeded.sources.rows.has(remote.id), false);
  assert.equal(seeded.syncMetaRows.get('current')?.cursor, 9);
});

test('multi-page delta replays an earlier tombstone before a later upsert', async () => {
  const remote: Source = {
    ...localSource,
    id: 'ordered-source',
    title: 'delete before upsert',
    ingestedAt: 8,
  };
  const seeded = memoryDb({
    sources: [remote],
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
  });
  const deletePage = page({
    mode: 'delta',
    upperCursor: 9,
    hasMore: true,
    deleted: [remote.id],
  });
  deletePage.pagination = undefined as never;
  deletePage.sync.cursor = 6;
  const upsertPage = page({
    mode: 'delta',
    upperCursor: 9,
    hasMore: false,
    sources: [remote],
  });
  upsertPage.pagination = undefined as never;

  const result = await validateAndApplySnapshotPages({
    db: seeded.db,
    meta: { id: 'current', cursor: 4, datasetId: 'ds-prod', generation: 1 },
    forceFull: false,
    pages: [deletePage, upsertPage],
  });

  assert.equal(result.result.destructiveReconcileBlocked, false);
  assert.equal(seeded.sources.rows.get(remote.id)?.title, 'delete before upsert');
  assert.equal(seeded.syncMetaRows.get('current')?.cursor, 9);
});
