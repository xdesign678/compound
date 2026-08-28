/**
 * Local SQLite backup observability. Reports age, checksum metadata and whether
 * the backup directory sits on the same volume as DATA_DIR. Does not perform
 * offsite copy or restore drills.
 *
 * Server-only.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const BACKUP_STALE_AFTER_MS = 26 * 60 * 60 * 1000;
const BACKUP_NAME = /^compound-\d{4}-.*\.db$/;

export type VolumeRelation = 'same' | 'different' | 'unknown';

export interface BackupStatus {
  present: boolean;
  latestCreatedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  checksumPresent: boolean;
  checksumOk: boolean | null;
  bytes: number | null;
  file: string | null;
  sameVolumeAsDataDir: boolean | null;
  volumeRelation: VolumeRelation;
  offsiteConfigured: boolean;
  offsiteVerified: false;
}

export type PublicBackupStatus = Omit<BackupStatus, 'bytes' | 'file'>;

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function resolveExistingPathDevice(targetPath: string): {
  path: string;
  dev: number | null;
  unknown: boolean;
} {
  let current = path.resolve(targetPath);
  while (true) {
    try {
      return { path: current, dev: statSync(current).dev, unknown: false };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return { path: current, dev: null, unknown: true };
      current = parent;
    }
  }
}

export function compareVolumeDevices(
  dataDir: string,
  backupDir: string,
): { sameVolumeAsDataDir: boolean | null; volumeRelation: VolumeRelation } {
  const data = resolveExistingPathDevice(dataDir);
  const backup = resolveExistingPathDevice(backupDir);
  if (data.unknown || backup.unknown || data.dev == null || backup.dev == null) {
    return { sameVolumeAsDataDir: null, volumeRelation: 'unknown' };
  }
  if (data.dev === backup.dev) {
    return { sameVolumeAsDataDir: true, volumeRelation: 'same' };
  }
  return { sameVolumeAsDataDir: false, volumeRelation: 'different' };
}

function emptyStatus(input: {
  sameVolumeAsDataDir: boolean | null;
  volumeRelation: VolumeRelation;
  offsiteConfigured: boolean;
}): BackupStatus {
  return {
    present: false,
    latestCreatedAt: null,
    ageSeconds: null,
    stale: true,
    checksumPresent: false,
    checksumOk: null,
    bytes: null,
    file: null,
    sameVolumeAsDataDir: input.sameVolumeAsDataDir,
    volumeRelation: input.volumeRelation,
    offsiteConfigured: input.offsiteConfigured,
    offsiteVerified: false,
  };
}

export function inspectLocalBackupStatus(
  options: {
    dataDir?: string;
    backupDir?: string;
    now?: number;
    verifyChecksum?: boolean;
    offsiteUri?: string | null;
  } = {},
): BackupStatus {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || 'data');
  const backupDir = path.resolve(
    options.backupDir || process.env.COMPOUND_BACKUP_DIR || path.join(dataDir, 'backups'),
  );
  const now = options.now ?? Date.now();
  const offsiteConfigured = Boolean(
    (options.offsiteUri ?? process.env.COMPOUND_BACKUP_OFFSITE_URI ?? '').trim(),
  );
  const volume = compareVolumeDevices(dataDir, backupDir);
  const empty = emptyStatus({
    sameVolumeAsDataDir: volume.sameVolumeAsDataDir,
    volumeRelation: volume.volumeRelation,
    offsiteConfigured,
  });
  if (!existsSync(backupDir)) return empty;

  const backups = readdirSync(backupDir)
    .filter((name) => BACKUP_NAME.test(name))
    .map((name) => {
      const filePath = path.join(backupDir, name);
      return { name, filePath, mtime: statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const latest = backups[0];
  if (!latest) return empty;

  let createdAtMs = latest.mtime;
  let checksumPresent = false;
  let expectedSha: string | null = null;
  const metaPath = `${latest.filePath}.json`;
  if (existsSync(metaPath)) {
    try {
      const metadata = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        createdAt?: string;
        sha256?: string;
      };
      if (typeof metadata.createdAt === 'string') {
        const parsed = Date.parse(metadata.createdAt);
        if (Number.isFinite(parsed)) createdAtMs = parsed;
      }
      if (typeof metadata.sha256 === 'string' && metadata.sha256.length > 0) {
        checksumPresent = true;
        expectedSha = metadata.sha256;
      }
    } catch {
      checksumPresent = false;
    }
  }

  let checksumOk: boolean | null = null;
  if (options.verifyChecksum && expectedSha) {
    checksumOk = sha256File(latest.filePath) === expectedSha;
  }

  const ageMs = Math.max(0, now - createdAtMs);
  return {
    present: true,
    latestCreatedAt: new Date(createdAtMs).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    stale: ageMs > BACKUP_STALE_AFTER_MS || !checksumPresent,
    checksumPresent,
    checksumOk,
    bytes: statSync(latest.filePath).size,
    file: latest.name,
    sameVolumeAsDataDir: volume.sameVolumeAsDataDir,
    volumeRelation: volume.volumeRelation,
    offsiteConfigured,
    offsiteVerified: false,
  };
}

export function toPublicBackupStatus(status: BackupStatus): PublicBackupStatus {
  return {
    present: status.present,
    latestCreatedAt: status.latestCreatedAt,
    ageSeconds: status.ageSeconds,
    stale: status.stale,
    checksumPresent: status.checksumPresent,
    checksumOk: status.checksumOk,
    sameVolumeAsDataDir: status.sameVolumeAsDataDir,
    volumeRelation: status.volumeRelation,
    offsiteConfigured: status.offsiteConfigured,
    offsiteVerified: status.offsiteVerified,
  };
}
