import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { restoreSqliteBackup } from './sqlite-restore.mjs';

function createDatabase(filePath, options = {}) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  try {
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE marker (value TEXT NOT NULL);
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES parent(id)
      );
    `);
    db.prepare(`INSERT INTO marker(value) VALUES (?)`).run(options.marker ?? 'marker');
    if (options.generation !== undefined) {
      db.prepare(`INSERT INTO meta(key, value) VALUES ('dataset_generation', ?)`).run(
        String(options.generation),
      );
    }
    if (options.foreignKeyError) {
      db.pragma('foreign_keys = OFF');
      db.prepare(`INSERT INTO child(id, parent_id) VALUES (1, 999)`).run();
    }
  } finally {
    db.close();
  }
}

function writeChecksumMetadata(filePath, checksum = sha256File(filePath)) {
  writeFileSync(`${filePath}.json`, `${JSON.stringify({ sha256: checksum })}\n`);
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readGeneration(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'dataset_generation'`).get();
    return Number(row?.value);
  } finally {
    db.close();
  }
}

function readMarker(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`SELECT value FROM marker`).get()?.value;
  } finally {
    db.close();
  }
}

async function withTemporaryDirectory(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'compound-sqlite-restore-test-'));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('restore advances generation above both target and backup', async (context) => {
  const cases = [
    { name: 'newer target', targetGeneration: 10, backupGeneration: 3, expected: 11 },
    { name: 'newer backup', targetGeneration: 2, backupGeneration: 8, expected: 9 },
    { name: 'missing target', targetGeneration: null, backupGeneration: 4, expected: 5 },
  ];

  for (const restoreCase of cases) {
    await context.test(restoreCase.name, async () => {
      await withTemporaryDirectory(async (root) => {
        const backupPath = path.join(root, 'backup.db');
        const targetPath = path.join(root, 'data', 'compound.db');
        createDatabase(backupPath, {
          generation: restoreCase.backupGeneration,
          marker: 'from-backup',
        });
        writeChecksumMetadata(backupPath);
        if (restoreCase.targetGeneration !== null) {
          createDatabase(targetPath, {
            generation: restoreCase.targetGeneration,
            marker: 'from-target',
          });
        }

        await restoreSqliteBackup({
          backupPath,
          targetPath,
          force: restoreCase.targetGeneration !== null,
          safetyBackupDir: path.join(root, 'safety-backups'),
        });

        assert.equal(readGeneration(targetPath), restoreCase.expected);
        assert.equal(readMarker(targetPath), 'from-backup');
      });
    });
  }
});

test('checksum failure leaves the target database unchanged', async () => {
  await withTemporaryDirectory(async (root) => {
    const backupPath = path.join(root, 'backup.db');
    const targetPath = path.join(root, 'data', 'compound.db');
    createDatabase(backupPath, { generation: 8, marker: 'from-backup' });
    writeChecksumMetadata(backupPath, 'invalid-checksum');
    createDatabase(targetPath, { generation: 10, marker: 'from-target' });

    await assert.rejects(
      restoreSqliteBackup({ backupPath, targetPath, force: true }),
      /checksum does not match/,
    );
    assert.equal(readGeneration(targetPath), 10);
    assert.equal(readMarker(targetPath), 'from-target');
  });
});

test('foreign-key failure leaves the target database unchanged', async () => {
  await withTemporaryDirectory(async (root) => {
    const backupPath = path.join(root, 'backup.db');
    const targetPath = path.join(root, 'data', 'compound.db');
    createDatabase(backupPath, {
      generation: 8,
      marker: 'from-backup',
      foreignKeyError: true,
    });
    writeChecksumMetadata(backupPath);
    createDatabase(targetPath, { generation: 10, marker: 'from-target' });

    await assert.rejects(
      restoreSqliteBackup({
        backupPath,
        targetPath,
        force: true,
        safetyBackupDir: path.join(root, 'safety-backups'),
      }),
      /foreign-key errors/,
    );
    assert.equal(readGeneration(targetPath), 10);
    assert.equal(readMarker(targetPath), 'from-target');
  });
});

test('successful replacement removes stale SQLite sidecars from the target path', async () => {
  await withTemporaryDirectory(async (root) => {
    const backupPath = path.join(root, 'backup.db');
    const targetPath = path.join(root, 'data', 'compound.db');
    createDatabase(backupPath, { generation: 4, marker: 'from-backup' });
    writeChecksumMetadata(backupPath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(`${targetPath}-wal`, 'stale wal');
    writeFileSync(`${targetPath}-shm`, 'stale shm');

    await restoreSqliteBackup({ backupPath, targetPath });

    assert.equal(readGeneration(targetPath), 5);
    assert.equal(existsSync(`${targetPath}-wal`), false);
    assert.equal(existsSync(`${targetPath}-shm`), false);
  });
});
