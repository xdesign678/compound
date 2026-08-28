import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createSqliteBackup, sha256File, verifySqliteFile } from './sqlite-backup.mjs';

function readExpectedChecksum(backupPath) {
  const metadataPath = `${backupPath}.json`;
  if (!existsSync(metadataPath)) return null;
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  return typeof metadata.sha256 === 'string' ? metadata.sha256 : null;
}

function readDatasetGeneration(filePath, label) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const metaTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`)
      .get();
    if (!metaTable) return 0;
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'dataset_generation'`).get();
    if (!row) return 0;
    const generation = Number(row.value);
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error(`${label} dataset_generation is invalid`);
    }
    return generation;
  } finally {
    db.close();
  }
}

function writeDatasetGeneration(filePath, generation) {
  const db = new Database(filePath, { fileMustExist: true });
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES ('dataset_generation', ?)`).run(
      String(generation),
    );
    db.exec('COMMIT');
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

function verifyForeignKeys(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    const foreignKeyErrors = db.pragma('foreign_key_check');
    if (foreignKeyErrors.length > 0) {
      throw new Error(`Restored database has ${foreignKeyErrors.length} foreign-key errors`);
    }
  } finally {
    db.close();
  }
}

function verifyRestoredDatabase(filePath) {
  verifySqliteFile(filePath);
  verifyForeignKeys(filePath);
}

function removeSqliteSidecars(filePath) {
  rmSync(`${filePath}-wal`, { force: true });
  rmSync(`${filePath}-shm`, { force: true });
}

export async function restoreSqliteBackup(options) {
  if (!options?.backupPath) throw new Error('backupPath is required');
  const backupPath = path.resolve(options.backupPath);
  if (!existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`);
  verifySqliteFile(backupPath);
  const expectedChecksum = readExpectedChecksum(backupPath);
  if (!expectedChecksum && !options.allowMissingChecksum) {
    throw new Error(
      'Backup checksum metadata is required. Pass --allow-missing-checksum only as break-glass.',
    );
  }
  if (expectedChecksum && sha256File(backupPath) !== expectedChecksum) {
    throw new Error('Backup checksum does not match its metadata');
  }

  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || 'data');
  const targetPath = path.resolve(options.targetPath || path.join(dataDir, 'compound.db'));
  mkdirSync(path.dirname(targetPath), { recursive: true });

  let safetyBackup = null;
  let targetGeneration = 0;
  if (existsSync(targetPath)) {
    if (!options.force) {
      throw new Error('Target database exists. Stop the service and pass --force to restore.');
    }
    targetGeneration = readDatasetGeneration(targetPath, 'Target database');
    safetyBackup = await createSqliteBackup({
      sourcePath: targetPath,
      backupDir:
        options.safetyBackupDir || process.env.COMPOUND_BACKUP_DIR || path.join(dataDir, 'backups'),
    });
  }
  const backupGeneration = readDatasetGeneration(backupPath, 'Backup database');
  const nextGeneration = Math.max(targetGeneration, backupGeneration) + 1;
  if (!Number.isSafeInteger(nextGeneration)) {
    throw new Error('Restored dataset_generation exceeds the safe integer range');
  }

  const temporaryPath = `${targetPath}.restore-${process.pid}`;
  const rollbackPath = `${targetPath}.rollback-${process.pid}`;
  rmSync(temporaryPath, { force: true });
  rmSync(rollbackPath, { force: true });
  removeSqliteSidecars(temporaryPath);
  removeSqliteSidecars(rollbackPath);

  let replacementCreated = false;
  let rollbackCreated = false;
  try {
    copyFileSync(backupPath, temporaryPath);
    writeDatasetGeneration(temporaryPath, nextGeneration);
    verifyRestoredDatabase(temporaryPath);

    if (safetyBackup) {
      copyFileSync(safetyBackup.destination, rollbackPath);
      rollbackCreated = true;
    }
    removeSqliteSidecars(targetPath);
    renameSync(temporaryPath, targetPath);
    replacementCreated = true;
    removeSqliteSidecars(targetPath);
    verifyRestoredDatabase(targetPath);
    rmSync(rollbackPath, { force: true });
    rollbackCreated = false;
  } catch (error) {
    if (replacementCreated) {
      if (rollbackCreated && existsSync(rollbackPath)) {
        removeSqliteSidecars(targetPath);
        renameSync(rollbackPath, targetPath);
        rollbackCreated = false;
      } else {
        rmSync(targetPath, { force: true });
      }
    } else if (rollbackCreated) {
      rmSync(rollbackPath, { force: true });
      rollbackCreated = false;
    }
    throw error;
  } finally {
    rmSync(temporaryPath, { force: true });
    removeSqliteSidecars(temporaryPath);
    removeSqliteSidecars(rollbackPath);
  }

  return {
    targetPath,
    safetyBackup: safetyBackup?.destination ?? null,
    generation: nextGeneration,
  };
}

function parseArgs(argv) {
  const fromIndex = argv.indexOf('--from');
  if (fromIndex < 0 || !argv[fromIndex + 1]) {
    throw new Error(
      'Usage: npm run restore -- --from /path/to/backup.db --force [--allow-missing-checksum]',
    );
  }
  return {
    backupPath: argv[fromIndex + 1],
    force: argv.includes('--force'),
    allowMissingChecksum: argv.includes('--allow-missing-checksum'),
  };
}

async function main() {
  const result = await restoreSqliteBackup(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${result.targetPath}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
