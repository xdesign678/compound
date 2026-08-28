/**
 * In-process readiness flag. Fatal crashes and drain start by flipping this
 * so /api/health/ready fails before the process exits.
 *
 * Stored on globalThis so Next.js chunk reloads share the same flag.
 * Server-only.
 */

const PROCESS_READINESS_KEY = '__compound_process_readiness__';

interface ProcessReadinessState {
  ready: boolean;
  reason: string | null;
}

export type DatasetIdentityAnchorStatus = 'not_configured' | 'verified';

function readinessState(): ProcessReadinessState {
  const holder = globalThis as typeof globalThis & {
    [PROCESS_READINESS_KEY]?: ProcessReadinessState;
  };
  if (!holder[PROCESS_READINESS_KEY]) {
    holder[PROCESS_READINESS_KEY] = { ready: true, reason: null };
  }
  return holder[PROCESS_READINESS_KEY];
}

export function isProcessReady(): boolean {
  return readinessState().ready;
}

export function getUnreadinessReason(): string | null {
  return readinessState().reason;
}

export function datasetIdentityAnchorConfigured(expectedDatasetId: string | undefined): boolean {
  return Boolean(expectedDatasetId?.trim());
}

export function checkDatasetIdentityAnchor(
  expectedDatasetId: string | undefined,
  actualDatasetId: string | null,
): DatasetIdentityAnchorStatus {
  const expected = expectedDatasetId?.trim();
  if (!expected) return 'not_configured';
  if (!actualDatasetId) {
    throw new Error('dataset identity anchor expected but dataset identity is missing');
  }
  if (actualDatasetId !== expected) {
    throw new Error('dataset identity anchor mismatch');
  }
  return 'verified';
}

export function markProcessUnready(reason: string): void {
  const state = readinessState();
  state.ready = false;
  state.reason = reason;
}

export function resetProcessReadinessForTests(): void {
  const state = readinessState();
  state.ready = true;
  state.reason = null;
}
