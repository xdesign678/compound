import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteBackup } from './sqlite-backup.mjs';
import { restoreSqliteBackup } from './sqlite-restore.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'compound-backup-drill-'));
try {
  const sourceDir = path.join(root, 'source');
  const restoredDir = path.join(root, 'restored');
  const sourcePath = path.join(sourceDir, 'compound.db');
  mkdirSync(sourceDir, { recursive: true });
  const db = new Database(sourcePath);
  db.exec(`
    CREATE TABLE drill_marker(id TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO drill_marker(id, value) VALUES ('marker', 'backup-restore-ok');
  `);
  db.close();

  const backup = await createSqliteBackup({ dataDir: sourceDir, keep: 2 });
  const restored = await restoreSqliteBackup({
    backupPath: backup.destination,
    dataDir: restoredDir,
  });
  const check = new Database(restored.targetPath, { readonly: true, fileMustExist: true });
  const row = check.prepare(`SELECT value FROM drill_marker WHERE id = 'marker'`).get();
  check.close();
  if (row?.value !== 'backup-restore-ok') throw new Error('Restored marker does not match');
  process.stdout.write('SQLite backup/restore drill passed\n');
} finally {
  rmSync(root, { recursive: true, force: true });
}
