import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  checkDatasetIdentityAnchor,
  datasetIdentityAnchorConfigured,
  getUnreadinessReason,
  isProcessReady,
  type DatasetIdentityAnchorStatus,
} from '@/lib/process-readiness';
import { getServerDb, repo } from '@/lib/server-db';
import { logger } from '@/lib/logging';

export const runtime = 'nodejs';

function assertLocalStoreHealthy(
  expectedDatasetId: string | undefined,
): DatasetIdentityAnchorStatus {
  const dataDir = path.resolve(process.env.DATA_DIR?.trim() || path.join(process.cwd(), 'data'));
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  accessSync(dataDir, constants.W_OK | constants.R_OK);

  const db = getServerDb();
  const identity = repo.getDatasetIdentity();
  if (!identity.datasetId) throw new Error('dataset identity missing');
  const identityAnchor = checkDatasetIdentityAnchor(expectedDatasetId, identity.datasetId);
  repo.getLatestSyncCursor();

  const requiredTables = ['sources', 'concepts', 'activity', 'ask_history', 'meta'];
  for (const name of requiredTables) {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) as { name?: string } | undefined;
    if (!row?.name) throw new Error(`schema missing ${name}`);
  }

  const meta = db.prepare(`SELECT value FROM meta WHERE key = ?`).get('dataset_id') as
    | { value?: string }
    | undefined;
  if (!meta?.value) throw new Error('dataset meta unreadable');
  db.prepare(`UPDATE meta SET value = value WHERE key = ?`).run('dataset_id');
  return identityAnchor;
}

/**
 * GET /api/health/ready
 * Readiness probe. Public body is `{ status, probe, identityAnchor }`, where
 * `identityAnchor` is `verified`, `unverified`, or `not_configured`. Detailed
 * failure reasons are written to internal structured logs, not the response.
 *
 * Checks process liveness, SQLite readability, critical schema/meta, and that
 * DATA_DIR is writable. When COMPOUND_EXPECTED_DATASET_ID is configured, the
 * mounted dataset must match it. A missing backup directory is not a ready
 * failure. `not_configured` does not verify persistent-volume identity.
 */
export async function GET() {
  const expectedDatasetId = process.env.COMPOUND_EXPECTED_DATASET_ID;
  const failedIdentityAnchor = datasetIdentityAnchorConfigured(expectedDatasetId)
    ? 'unverified'
    : 'not_configured';

  if (!isProcessReady()) {
    logger.error('health.ready_process_unready', {
      reason: getUnreadinessReason(),
    });
    return NextResponse.json(
      { status: 'not_ready', probe: 'ready', identityAnchor: failedIdentityAnchor },
      { status: 503 },
    );
  }

  try {
    const identityAnchor = assertLocalStoreHealthy(expectedDatasetId);
    return NextResponse.json({ status: 'ok', probe: 'ready', identityAnchor });
  } catch (error) {
    logger.error('health.ready_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { status: 'not_ready', probe: 'ready', identityAnchor: failedIdentityAnchor },
      { status: 503 },
    );
  }
}
