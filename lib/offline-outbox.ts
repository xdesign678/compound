import { nanoid } from 'nanoid';
import { getDb } from './db';
import type { SyncQuarantine } from './sync-reconciliation';

export const MAX_OUTBOX_ATTEMPTS = 8;
export const OUTBOX_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
/** Must exceed ingest client (270s) and server (300s) timeouts so a live claim is not stolen. */
export const OUTBOX_CLAIM_LEASE_MS = 8 * 60 * 1000;
export const OUTBOX_SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OUTBOX_MAX_TERMINAL_ROWS = 40;
export const CREDENTIAL_CONTEXT_LOST = 'credential_context_lost';

export type OutboxState = 'queued' | 'inflight' | 'succeeded' | 'failed' | 'cancelled';
export type OutboxKind = 'ingest';
export type OutboxErrorClass =
  | 'retryable'
  | 'permanent'
  | 'auth_locked'
  | 'credential_context_lost';

export interface OutboxCredentialContext {
  provider: string;
  model: string;
  apiUrl: string;
  keyFingerprint: string;
}

export interface OfflineOutboxItem {
  id: string;
  operationId: string;
  kind: OutboxKind;
  payload: unknown;
  payloadHash: string;
  state: OutboxState;
  attempt: number;
  error?: string;
  errorClass?: OutboxErrorClass;
  result?: string;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt?: number;
  credentialContext?: OutboxCredentialContext;
  claimToken?: string;
  claimUntil?: number;
}

export interface SyncMetaRecord {
  id: 'current';
  datasetId?: string;
  generation?: number;
  cursor?: number | null;
  quarantine?: SyncQuarantine | null;
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

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintSecret(value: string | null | undefined): Promise<string> {
  if (!value) return '';
  return sha256Hex(value);
}

export async function buildCredentialContext(input: {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
}): Promise<OutboxCredentialContext> {
  const apiUrl = input.apiUrl?.trim() || '';
  return {
    provider: apiUrl || 'default',
    model: input.model?.trim() || '',
    apiUrl,
    keyFingerprint: await fingerprintSecret(input.apiKey),
  };
}

export function credentialContextMatches(
  stored: OutboxCredentialContext | undefined,
  current: OutboxCredentialContext,
): boolean {
  if (!stored) return false;
  return (
    stored.provider === current.provider &&
    stored.model === current.model &&
    stored.apiUrl === current.apiUrl &&
    stored.keyFingerprint === current.keyFingerprint
  );
}

export function payloadContainsRawSecret(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (typeof record.apiKey === 'string' && record.apiKey.length > 0) return true;
  const nested = record.llmConfig;
  if (nested && typeof nested === 'object') {
    const config = nested as Record<string, unknown>;
    if (typeof config.apiKey === 'string' && config.apiKey.length > 0) return true;
  }
  return false;
}

export function createOutboxItem(input: {
  kind: OutboxKind;
  payload: unknown;
  now?: number;
  credentialContext?: OutboxCredentialContext;
  operationId?: string;
}): OfflineOutboxItem {
  if (payloadContainsRawSecret(input.payload)) {
    throw new Error('outbox payload must not persist raw API keys');
  }
  const now = input.now ?? Date.now();
  return {
    id: `out-${nanoid(10)}`,
    operationId: input.operationId ?? `op-${nanoid(16)}`,
    kind: input.kind,
    payload: input.payload,
    payloadHash: hashOutboxPayload(input.payload),
    state: 'queued',
    attempt: 0,
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    credentialContext: input.credentialContext,
  };
}

export function classifyOutboxError(error: unknown): OutboxErrorClass {
  if (error && typeof error === 'object' && 'errorClass' in error) {
    const tagged = (error as { errorClass?: unknown }).errorClass;
    if (
      tagged === 'permanent' ||
      tagged === 'auth_locked' ||
      tagged === 'credential_context_lost' ||
      tagged === 'retryable'
    ) {
      return tagged;
    }
  }
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : NaN;
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');
  const text = `${code} ${message}`.toLowerCase();

  if (status === 401 || status === 403 || /认证失败|unauthorized|forbidden/.test(text)) {
    return 'auth_locked';
  }
  if (code === CREDENTIAL_CONTEXT_LOST || text.includes(CREDENTIAL_CONTEXT_LOST)) {
    return 'credential_context_lost';
  }
  if (code === 'ingest_operation_in_progress') return 'retryable';
  if (
    status === 409 ||
    code === 'ingest_operation_conflict' ||
    /conflict|validation|invalid operationid|payload/.test(text)
  ) {
    if (/ingest_operation_in_progress/.test(text)) return 'retryable';
    return 'permanent';
  }
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return 'permanent';
  }
  if (
    status >= 500 ||
    status === 408 ||
    status === 429 ||
    /timeout|network|offline|failed to fetch|econnreset|503|502|500/.test(text)
  ) {
    return 'retryable';
  }
  if (/离线|网络/.test(message)) return 'retryable';
  return 'retryable';
}

export function nextOutboxAttempt(item: OfflineOutboxItem, now = Date.now()): OfflineOutboxItem {
  const errorClass = item.errorClass ?? classifyOutboxError(item.error);
  if (
    errorClass === 'permanent' ||
    errorClass === 'auth_locked' ||
    errorClass === 'credential_context_lost'
  ) {
    return {
      ...item,
      state: 'failed',
      errorClass,
      updatedAt: now,
      nextAttemptAt: undefined,
    };
  }
  const attempt = item.attempt + 1;
  const delay = OUTBOX_BACKOFF_MS[Math.min(attempt - 1, OUTBOX_BACKOFF_MS.length - 1)];
  const exhausted = attempt >= MAX_OUTBOX_ATTEMPTS;
  return {
    ...item,
    attempt,
    errorClass,
    state: exhausted ? 'failed' : 'queued',
    updatedAt: now,
    nextAttemptAt: exhausted ? undefined : now + delay,
    error: exhausted ? item.error || '达到最大重试次数' : item.error,
    claimToken: undefined,
  };
}

export interface OutboxRecordStore {
  get(id: string): Promise<OfflineOutboxItem | undefined>;
  put(item: OfflineOutboxItem): Promise<unknown>;
  toArray?: () => Promise<OfflineOutboxItem[]>;
  bulkDelete?: (ids: string[]) => Promise<unknown>;
  transaction?: <T>(mode: 'rw', table: unknown, scope: () => Promise<T>) => Promise<T>;
}

function defaultOutboxStore(): OutboxRecordStore {
  const db = getDb();
  return {
    get: (id) => db.offlineOutbox.get(id),
    put: (item) => db.offlineOutbox.put(item),
    toArray: () => db.offlineOutbox.toArray(),
    bulkDelete: (ids) => db.offlineOutbox.bulkDelete(ids),
    transaction: (mode, _table, scope) => db.transaction(mode, db.offlineOutbox, scope),
  };
}

let outboxStoreOverride: OutboxRecordStore | null = null;

export function setOutboxStoreForTests(store: OutboxRecordStore | null): void {
  outboxStoreOverride = store;
}

function outboxStore(): OutboxRecordStore {
  return outboxStoreOverride ?? defaultOutboxStore();
}

async function withOutboxTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const store = outboxStore();
  if (store.transaction) return store.transaction('rw', store, fn);
  return fn();
}

export async function persistOutboxItem(item: OfflineOutboxItem): Promise<void> {
  if (payloadContainsRawSecret(item.payload)) {
    throw new Error('outbox payload must not persist raw API keys');
  }
  await outboxStore().put(item);
}

export function isOutboxClaimActive(item: OfflineOutboxItem, now = Date.now()): boolean {
  if (item.state !== 'inflight' || !item.claimToken) return false;
  const until = item.claimUntil ?? item.updatedAt + OUTBOX_CLAIM_LEASE_MS;
  return until > now;
}

export async function listReplayableOutbox(now = Date.now()): Promise<OfflineOutboxItem[]> {
  const rows = (await outboxStore().toArray?.()) ?? [];
  return rows
    .filter((item) => {
      if (item.state === 'queued') return (item.nextAttemptAt ?? 0) <= now;
      if (item.state === 'inflight') return !isOutboxClaimActive(item, now);
      return false;
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function claimOutboxItem(
  id: string,
  now = Date.now(),
): Promise<OfflineOutboxItem | null> {
  return withOutboxTransaction(async () => {
    const store = outboxStore();
    const current = await store.get(id);
    if (!current) return null;
    if (current.state === 'succeeded' || current.state === 'cancelled') return null;
    if (isOutboxClaimActive(current, now)) return null;
    if (current.state === 'failed') return null;
    if ((current.nextAttemptAt ?? 0) > now && current.state === 'queued') return null;
    const claimed: OfflineOutboxItem = {
      ...current,
      state: 'inflight',
      claimToken: nanoid(10),
      claimUntil: now + OUTBOX_CLAIM_LEASE_MS,
      updatedAt: now,
    };
    await store.put(claimed);
    return claimed;
  });
}

export async function completeOutboxIfClaimed(
  id: string,
  claimToken: string,
  patch: Partial<OfflineOutboxItem>,
  now = Date.now(),
): Promise<boolean> {
  return withOutboxTransaction(async () => {
    const store = outboxStore();
    const current = await store.get(id);
    if (!current) return false;
    if (current.claimToken !== claimToken) return false;
    if (current.state === 'cancelled' || current.state === 'succeeded') return false;
    const next: OfflineOutboxItem = {
      ...current,
      ...patch,
      id: current.id,
      operationId: current.operationId,
      claimToken: patch.state === 'succeeded' ? current.claimToken : patch.claimToken,
      updatedAt: now,
    };
    if (payloadContainsRawSecret(next.payload)) {
      throw new Error('outbox payload must not persist raw API keys');
    }
    await store.put(next);
    return true;
  });
}

export async function requeueOutboxItem(id: string, now = Date.now()): Promise<boolean> {
  return withOutboxTransaction(async () => {
    const store = outboxStore();
    const current = await store.get(id);
    if (!current) return false;
    if (current.state === 'succeeded' || current.state === 'cancelled') return false;
    if (isOutboxClaimActive(current, now)) return false;
    await store.put({
      ...current,
      state: 'queued',
      nextAttemptAt: now,
      error: undefined,
      claimToken: undefined,
      claimUntil: undefined,
      updatedAt: now,
    });
    return true;
  });
}

export async function cancelOutboxItem(id: string, now = Date.now()): Promise<boolean> {
  return withOutboxTransaction(async () => {
    const store = outboxStore();
    const current = await store.get(id);
    if (!current) return false;
    if (current.state === 'succeeded') return false;
    await store.put({
      ...current,
      state: 'cancelled',
      nextAttemptAt: undefined,
      claimToken: `cancelled-${nanoid(8)}`,
      claimUntil: undefined,
      updatedAt: now,
    });
    return true;
  });
}

export function isTerminalOutboxState(state: OutboxState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled';
}

export async function clearTerminalOutbox(): Promise<string[]> {
  return withOutboxTransaction(async () => {
    const store = outboxStore();
    const rows = (await store.toArray?.()) ?? [];
    const ids = rows.filter((item) => isTerminalOutboxState(item.state)).map((item) => item.id);
    if (ids.length > 0) await store.bulkDelete?.(ids);
    return ids;
  });
}

export async function dismissTerminalOutbox(id: string): Promise<boolean> {
  return withOutboxTransaction(async () => {
    const store = outboxStore();
    const current = await store.get(id);
    if (!current || !isTerminalOutboxState(current.state)) return false;
    await store.bulkDelete?.([id]);
    return true;
  });
}

export async function gcOutbox(now = Date.now()): Promise<void> {
  const store = outboxStore();
  const rows = (await store.toArray?.()) ?? [];
  const expiredSuccess = rows.filter(
    (item) => item.state === 'succeeded' && now - item.updatedAt > OUTBOX_SUCCESS_TTL_MS,
  );
  const terminal = rows
    .filter(
      (item) => item.state === 'succeeded' || item.state === 'failed' || item.state === 'cancelled',
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const overflow = terminal.slice(OUTBOX_MAX_TERMINAL_ROWS);
  const toDelete = new Set([...expiredSuccess, ...overflow].map((item) => item.id));
  if (toDelete.size === 0) return;
  await store.bulkDelete?.([...toDelete]);
}
