import type { AskMessage } from './types';

/** First-screen and per-page query cap. DOM grows only by this amount per "加载更早". */
export const ASK_HISTORY_PAGE_SIZE = 50;

/** Absolute query/DOM ceiling for an opened Ask conversation window. */
export const ASK_HISTORY_MAX_WINDOW = 500;

/** Dexie compound index for stable (at, id) cursor order. */
export const ASK_HISTORY_INDEX = '[at+id]';

export type AskHistoryCursor = {
  at: number;
  id: string;
};

export type AskHistoryPage = {
  messages: AskMessage[];
  hasMore: boolean;
};

type AskHistoryCollection = {
  reverse: () => AskHistoryCollection;
  limit: (count: number) => AskHistoryCollection;
  toArray: () => Promise<AskMessage[]>;
};

export type AskHistoryQueryable = {
  orderBy: (index: string) => AskHistoryCollection;
  where: (index: string) => {
    below: (key: [number, string]) => AskHistoryCollection;
    aboveOrEqual: (key: [number, string]) => AskHistoryCollection;
  };
};

export function compareAskHistoryCursor(a: AskHistoryCursor, b: AskHistoryCursor): number {
  if (a.at !== b.at) return a.at - b.at;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function askHistoryCursorOf(message: AskHistoryCursor): AskHistoryCursor {
  return { at: message.at, id: message.id };
}

export function askHistoryCursorKey(cursor: AskHistoryCursor): [number, string] {
  return [cursor.at, cursor.id];
}

/**
 * Keep Q/A pairs intact at a page boundary: if older rows still exist and the
 * oldest row in this page is an answer, leave that answer for the next older
 * page instead of showing it without its question.
 */
export function trimLeadingOrphanAnswer(
  messages: AskMessage[],
  hasMoreOlder: boolean,
): AskMessage[] {
  if (!hasMoreOlder || messages.length === 0) return messages;
  if (messages[0].role !== 'ai') return messages;
  return messages.slice(1);
}

export function mergeAskHistoryById(current: AskMessage[], incoming: AskMessage[]): AskMessage[] {
  const byId = new Map<string, AskMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareAskHistoryCursor);
}

function takeOldestPage(newestFirst: AskMessage[], pageSize: number): AskHistoryPage {
  const hasMore = newestFirst.length > pageSize;
  const limitedNewestFirst = hasMore ? newestFirst.slice(0, pageSize) : newestFirst;
  const oldestFirst = limitedNewestFirst.slice().reverse();
  return {
    messages: trimLeadingOrphanAnswer(oldestFirst, hasMore),
    hasMore,
  };
}

/** Latest `pageSize` rows by (at, id). Result is oldest → newest. */
export async function queryLatestAskHistoryPage(
  table: AskHistoryQueryable,
  pageSize: number = ASK_HISTORY_PAGE_SIZE,
): Promise<AskHistoryPage> {
  const newestFirst = await table
    .orderBy(ASK_HISTORY_INDEX)
    .reverse()
    .limit(pageSize + 1)
    .toArray();
  return takeOldestPage(newestFirst, pageSize);
}

/** Previous page strictly below the current earliest cursor. Oldest → newest. */
export async function queryEarlierAskHistoryPage(
  table: AskHistoryQueryable,
  cursor: AskHistoryCursor,
  pageSize: number = ASK_HISTORY_PAGE_SIZE,
): Promise<AskHistoryPage> {
  const newestFirst = await table
    .where(ASK_HISTORY_INDEX)
    .below(askHistoryCursorKey(cursor))
    .reverse()
    .limit(pageSize + 1)
    .toArray();
  return takeOldestPage(newestFirst, pageSize);
}

/**
 * Current window from a pinned earliest cursor through the newest row.
 * Used after the first page so new messages join the window without dropping
 * already-displayed older rows.
 */
export async function queryAskHistoryWindowFrom(
  table: AskHistoryQueryable,
  floor: AskHistoryCursor,
  maxMessages: number = ASK_HISTORY_MAX_WINDOW,
): Promise<AskMessage[]> {
  const newestFirst = await table
    .where(ASK_HISTORY_INDEX)
    .aboveOrEqual(askHistoryCursorKey(floor))
    .reverse()
    .limit(maxMessages + 1)
    .toArray();
  const hasMoreOlder = newestFirst.length > maxMessages;
  const limitedNewestFirst = hasMoreOlder ? newestFirst.slice(0, maxMessages) : newestFirst;
  return trimLeadingOrphanAnswer(limitedNewestFirst.slice().reverse(), hasMoreOlder);
}
