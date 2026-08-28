import test from 'node:test';
import assert from 'node:assert/strict';

import type { AskMessage } from './types';
import {
  ASK_HISTORY_INDEX,
  ASK_HISTORY_MAX_WINDOW,
  ASK_HISTORY_PAGE_SIZE,
  askHistoryCursorOf,
  compareAskHistoryCursor,
  mergeAskHistoryById,
  queryAskHistoryWindowFrom,
  queryEarlierAskHistoryPage,
  queryLatestAskHistoryPage,
  trimLeadingOrphanAnswer,
  type AskHistoryQueryable,
} from './ask-history';

type MemoryAskHistoryTable = AskHistoryQueryable & {
  stats: {
    materialized: number;
    unboundedReads: number;
  };
  insert(message: AskMessage): void;
};

function padId(index: number): string {
  return `m-${String(index).padStart(5, '0')}`;
}

function messageAt(index: number, overrides: Partial<AskMessage> = {}): AskMessage {
  return {
    id: padId(index),
    role: index % 2 === 0 ? 'user' : 'ai',
    text: `${index % 2 === 0 ? '问' : '答'} ${index}`,
    at: 1_700_000_000_000 + index,
    ...overrides,
  };
}

function createMemoryAskHistoryTable(rows: AskMessage[]): MemoryAskHistoryTable {
  const items = [...rows].sort(compareAskHistoryCursor);
  let materialized = 0;
  let unboundedReads = 0;

  function collection(source: AskMessage[], bounded: boolean) {
    let current = source;
    let isBounded = bounded;
    const api = {
      reverse() {
        current = current.slice().reverse();
        return api;
      },
      limit(count: number) {
        current = current.slice(0, count);
        isBounded = true;
        return api;
      },
      async toArray() {
        if (!isBounded) unboundedReads += 1;
        materialized = Math.max(materialized, current.length);
        return current.slice();
      },
    };
    return api;
  }

  return {
    get stats() {
      return { materialized, unboundedReads };
    },
    insert(message: AskMessage) {
      items.push(message);
      items.sort(compareAskHistoryCursor);
    },
    orderBy(index: string) {
      assert.equal(index, ASK_HISTORY_INDEX);
      return collection(items.slice(), false);
    },
    where(index: string) {
      assert.equal(index, ASK_HISTORY_INDEX);
      return {
        below(key: [number, string]) {
          const cursor = { at: key[0], id: key[1] };
          const filtered = items.filter((row) => compareAskHistoryCursor(row, cursor) < 0);
          return collection(filtered, false);
        },
        aboveOrEqual(key: [number, string]) {
          const cursor = { at: key[0], id: key[1] };
          const filtered = items.filter((row) => compareAskHistoryCursor(row, cursor) >= 0);
          return collection(filtered, true);
        },
      };
    },
  };
}

test('10k-row first page materializes at most 51 rows and returns at most 50', async () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => messageAt(index));
  const table = createMemoryAskHistoryTable(rows);

  const page = await queryLatestAskHistoryPage(table);

  assert.equal(page.hasMore, true);
  assert.ok(page.messages.length <= ASK_HISTORY_PAGE_SIZE);
  assert.equal(page.messages.length, ASK_HISTORY_PAGE_SIZE);
  assert.equal(table.stats.unboundedReads, 0);
  assert.ok(table.stats.materialized <= ASK_HISTORY_PAGE_SIZE + 1);
  assert.equal(page.messages[0]?.id, padId(9950));
  assert.equal(page.messages.at(-1)?.id, padId(9999));
  assert.equal(page.messages[0]?.role, 'user');
});

test('stable (at, id) order when timestamps collide', async () => {
  const at = 42;
  const rows: AskMessage[] = ['m-z', 'm-m', 'm-a', 'm-k', 'm-b'].map((id) => ({
    id,
    role: 'user',
    text: id,
    at,
  }));
  const table = createMemoryAskHistoryTable(rows);

  const page = await queryLatestAskHistoryPage(table, 3);

  assert.deepEqual(
    page.messages.map((message) => message.id),
    ['m-k', 'm-m', 'm-z'],
  );

  const earlier = await queryEarlierAskHistoryPage(table, askHistoryCursorOf(page.messages[0]), 3);
  assert.deepEqual(
    earlier.messages.map((message) => message.id),
    ['m-a', 'm-b'],
  );
  assert.equal(earlier.hasMore, false);
});

test('load earlier merges without duplicates and keeps user/ai pairs', async () => {
  const rows = Array.from({ length: 120 }, (_, index) => messageAt(index));
  const table = createMemoryAskHistoryTable(rows);

  const first = await queryLatestAskHistoryPage(table);
  const earlier = await queryEarlierAskHistoryPage(table, askHistoryCursorOf(first.messages[0]));
  const merged = mergeAskHistoryById(first.messages, earlier.messages);
  const ids = merged.map((message) => message.id);

  assert.equal(first.messages.length, 50);
  assert.equal(earlier.messages.length, 50);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(merged.length, 100);
  assert.equal(merged[0]?.id, padId(20));
  assert.equal(merged.at(-1)?.id, padId(119));

  for (let index = 0; index < merged.length; index += 2) {
    assert.equal(merged[index]?.role, 'user');
    assert.equal(merged[index + 1]?.role, 'ai');
  }
});

test('pinned window includes realtime newer messages', async () => {
  const rows = Array.from({ length: 80 }, (_, index) => messageAt(index));
  const table = createMemoryAskHistoryTable(rows);

  const first = await queryLatestAskHistoryPage(table);
  const floor = askHistoryCursorOf(first.messages[0]);
  table.insert(
    messageAt(80, {
      id: 'm-live',
      role: 'user',
      text: '新问题',
      at: 1_700_000_000_000 + 10_000,
    }),
  );

  const window = await queryAskHistoryWindowFrom(table, floor);
  assert.equal(window.length, 51);
  assert.equal(window.at(-1)?.id, 'm-live');
  assert.equal(window[0]?.id, first.messages[0]?.id);
});

test('10k-row opened window stays bounded and preserves the newest messages', async () => {
  const rows = Array.from({ length: 10_000 }, (_, index) => messageAt(index));
  const table = createMemoryAskHistoryTable(rows);
  const floor = askHistoryCursorOf(rows[0]);

  const window = await queryAskHistoryWindowFrom(table, floor);

  assert.ok(window.length <= ASK_HISTORY_MAX_WINDOW);
  assert.ok(window.length >= ASK_HISTORY_MAX_WINDOW - 1);
  assert.equal(window[0]?.id, padId(9_500));
  assert.equal(window.at(-1)?.id, padId(9_999));
  assert.ok(table.stats.materialized <= ASK_HISTORY_MAX_WINDOW + 1);
});

test('button-at-top: last older page reports hasMore false', async () => {
  const rows = Array.from({ length: 70 }, (_, index) => messageAt(index));
  const table = createMemoryAskHistoryTable(rows);

  const first = await queryLatestAskHistoryPage(table);
  assert.equal(first.hasMore, true);

  const earlier = await queryEarlierAskHistoryPage(table, askHistoryCursorOf(first.messages[0]));
  assert.equal(earlier.hasMore, false);
  assert.ok(earlier.messages.length <= ASK_HISTORY_PAGE_SIZE);
  assert.equal(earlier.messages[0]?.id, padId(0));
});

test('trimLeadingOrphanAnswer drops a leading answer only when older rows remain', () => {
  const orphan: AskMessage[] = [
    messageAt(1, { role: 'ai' }),
    messageAt(2, { role: 'user' }),
    messageAt(3, { role: 'ai' }),
  ];
  assert.equal(trimLeadingOrphanAnswer(orphan, true)[0]?.role, 'user');
  assert.equal(trimLeadingOrphanAnswer(orphan, false)[0]?.role, 'ai');
});

test('latest page leaves an orphan answer for the next older page', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => messageAt(index));
  const table = createMemoryAskHistoryTable(rows);
  const page = await queryLatestAskHistoryPage(table);

  assert.equal(page.hasMore, true);
  assert.equal(page.messages[0]?.role, 'user');
  assert.equal(page.messages[0]?.id, padId(2));
  assert.ok(!page.messages.some((message) => message.id === padId(1)));

  const earlier = await queryEarlierAskHistoryPage(table, askHistoryCursorOf(page.messages[0]));
  const merged = mergeAskHistoryById(page.messages, earlier.messages);
  assert.equal(merged[0]?.id, padId(0));
  assert.equal(merged[1]?.id, padId(1));
  assert.equal(merged[0]?.role, 'user');
  assert.equal(merged[1]?.role, 'ai');
});
