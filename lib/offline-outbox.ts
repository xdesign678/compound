import { nanoid } from 'nanoid';
import { getDb } from './db';

export const MAX_OUTBOX_ATTEMPTS = 8;
export const OUTBOX_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

export type OutboxState = 'queued' | 'inflight' | 'succeeded' | 'failed' | 'cancelled';
export type OutboxKind = 'ingest';

export interface OfflineOutboxItem {
  id: string;
  operationId: string;
  kind: OutboxKind;
  payload: unknown;
  payloadHash: string;
  state: OutboxState;
  attempt: number;
  error?: string;
  result?: string;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt?: number;
}

export interface SyncMetaRecord {
  id: 'current';
  datasetId?: string;
  generation?: number;
  cursor?: number;
}

export function hashOutboxPayload(payload: unknown): string {
  const json = JSON.stringify(payload) ?? '';
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function createOutboxItem(input: {
  kind: OutboxKind;
  payload: unknown;
  now?: number;
}): OfflineOutboxItem {
  const now = input.now ?? Date.now();
  return {
    id: `out-${nanoid(10)}`,
    operationId: `op-${nanoid(16)}`,
    kind: input.kind,
    payload: input.payload,
    payloadHash: hashOutboxPayload(input.payload),
    state: 'queued',
    attempt: 0,
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
  };
}

export function nextOutboxAttempt(item: OfflineOutboxItem, now = Date.now()): OfflineOutboxItem {
  const attempt = item.attempt + 1;
  const delay = OUTBOX_BACKOFF_MS[Math.min(attempt - 1, OUTBOX_BACKOFF_MS.length - 1)];
  const exhausted = attempt >= MAX_OUTBOX_ATTEMPTS;
  return {
    ...item,
    attempt,
    state: exhausted ? 'failed' : 'queued',
    updatedAt: now,
    nextAttemptAt: exhausted ? undefined : now + delay,
    error: exhausted ? item.error || '达到最大重试次数' : item.error,
  };
}

export async function persistOutboxItem(item: OfflineOutboxItem): Promise<void> {
  await getDb().offlineOutbox.put(item);
}

export async function updateOutboxItem(
  id: string,
  patch: Partial<OfflineOutboxItem>,
): Promise<void> {
  const db = getDb();
  const current = await db.offlineOutbox.get(id);
  if (!current) return;
  await db.offlineOutbox.put({ ...current, ...patch, updatedAt: Date.now() });
}

export async function listReplayableOutbox(now = Date.now()): Promise<OfflineOutboxItem[]> {
  const rows = await getDb().offlineOutbox.toArray();
  return rows
    .filter(
      (item) =>
        (item.state === 'queued' || item.state === 'inflight') && (item.nextAttemptAt ?? 0) <= now,
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}
