/**
 * In-process readiness flag. Fatal crashes and drain start by flipping this
 * so /api/health/ready fails before the process exits.
 *
 * Server-only.
 */

let processReady = true;
let unreadinessReason: string | null = null;

export function isProcessReady(): boolean {
  return processReady;
}

export function getUnreadinessReason(): string | null {
  return unreadinessReason;
}

export function markProcessUnready(reason: string): void {
  processReady = false;
  unreadinessReason = reason;
}

export function resetProcessReadinessForTests(): void {
  processReady = true;
  unreadinessReason = null;
}
