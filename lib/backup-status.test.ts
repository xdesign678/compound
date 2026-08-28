import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  BACKUP_STALE_AFTER_MS,
  compareVolumeDevices,
  inspectLocalBackupStatus,
} from './backup-status';

function writeBackup(dir: string, name: string, body: string, createdAt: string, sha?: string) {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, body);
  writeFileSync(
    `${filePath}.json`,
    JSON.stringify({
      version: 1,
      createdAt,
      file: name,
      bytes: Buffer.byteLength(body),
      sha256: sha ?? createHash('sha256').update(body).digest('hex'),
    }),
  );
}

test('inspectLocalBackupStatus reports a fresh checksummed backup', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'compound-backup-status-'));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(root, 'offvolume');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  const createdAt = '2026-08-27T01:00:00.000Z';
  writeBackup(backupDir, 'compound-2026-08-27T01-00-00.db', 'sqlite-bytes', createdAt);

  const status = inspectLocalBackupStatus({
    dataDir,
    backupDir,
    now: Date.parse('2026-08-27T02:00:00.000Z'),
    verifyChecksum: true,
  });

  assert.equal(status.present, true);
  assert.equal(status.stale, false);
  assert.equal(status.checksumPresent, true);
  assert.equal(status.checksumOk, true);
  assert.equal(status.sameVolumeAsDataDir, true);
  assert.equal(status.volumeRelation, 'same');
  assert.equal(status.offsiteConfigured, false);
  assert.equal(status.offsiteVerified, false);
  assert.equal(status.ageSeconds, 3600);
  assert.equal(status.file, 'compound-2026-08-27T01-00-00.db');
});

test('inspectLocalBackupStatus marks missing checksum or old backups stale', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'compound-backup-stale-'));
  const dataDir = path.join(root, 'data');
  const backupDir = path.join(dataDir, 'backups');
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(path.join(backupDir, 'compound-2026-08-20T01-00-00.db'), 'old');

  const status = inspectLocalBackupStatus({
    dataDir,
    backupDir,
    now: Date.parse('2026-08-27T02:00:00.000Z'),
  });

  assert.equal(status.present, true);
  assert.equal(status.checksumPresent, false);
  assert.equal(status.stale, true);
  assert.equal(status.sameVolumeAsDataDir, true);
  assert.equal(status.volumeRelation, 'same');
});

test('inspectLocalBackupStatus treats a missing backup directory as stale', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'compound-backup-missing-'));
  const status = inspectLocalBackupStatus({
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'missing'),
    now: Date.now(),
    offsiteUri: 's3://example/unauthorized',
  });

  assert.equal(status.present, false);
  assert.equal(status.stale, true);
  assert.equal(status.offsiteConfigured, true);
  assert.equal(status.offsiteVerified, false);
  assert.ok(BACKUP_STALE_AFTER_MS > 24 * 60 * 60 * 1000);
  assert.equal(status.volumeRelation, 'same');
});

test('missing backup directory uses the nearest existing parent and is not off-volume', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'compound-backup-volume-'));
  const dataDir = path.join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  const status = inspectLocalBackupStatus({
    dataDir,
    backupDir: path.join(root, 'backups-not-created-yet'),
    now: Date.now(),
  });
  assert.equal(status.present, false);
  assert.notEqual(status.sameVolumeAsDataDir, false);
  assert.equal(status.volumeRelation, 'same');
  const sibling = compareVolumeDevices(dataDir, path.join(root, 'also-missing'));
  assert.equal(sibling.volumeRelation, 'same');
  assert.equal(sibling.sameVolumeAsDataDir, true);
});
