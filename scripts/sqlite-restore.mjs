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

export async function restoreSqliteBackup(options) {
  if (!options?.backupPath) throw new Error('backupPath is required');
  const backupPath = path.resolve(options.backupPath);
  if (!existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`);
  verifySqliteFile(backupPath);
  const expectedChecksum = readExpectedChecksum(backupPath);
  if (expectedChecksum && sha256File(backupPath) !== expectedChecksum) {
    throw new Error('Backup checksum does not match its metadata');
  }

  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || 'data');
  const targetPath = path.resolve(options.targetPath || path.join(dataDir, 'compound.db'));
  mkdirSync(path.dirname(targetPath), { recursive: true });

  let safetyBackup = null;
  if (existsSync(targetPath)) {
    if (!options.force) {
      throw new Error('Target database exists. Stop the service and pass --force to restore.');
    }
    safetyBackup = await createSqliteBackup({
      sourcePath: targetPath,
      backupDir:
        options.safetyBackupDir || process.env.COMPOUND_BACKUP_DIR || path.join(dataDir, 'backups'),
    });
  }

  const temporaryPath = `${targetPath}.restore-${process.pid}`;
  const rollbackPath = `${targetPath}.rollback-${process.pid}`;
  rmSync(temporaryPath, { force: true });
  rmSync(rollbackPath, { force: true });
  copyFileSync(backupPath, temporaryPath);
  verifySqliteFile(temporaryPath);

  try {
    if (existsSync(targetPath)) renameSync(targetPath, rollbackPath);
    renameSync(temporaryPath, targetPath);
    verifySqliteFile(targetPath);
    const db = new Database(targetPath, { readonly: true, fileMustExist: true });
    try {
      db.pragma('foreign_keys = ON');
      const foreignKeyErrors = db.pragma('foreign_key_check');
      if (foreignKeyErrors.length > 0) {
        throw new Error(`Restored database has ${foreignKeyErrors.length} foreign-key errors`);
      }
    } finally {
      db.close();
    }
    rmSync(rollbackPath, { force: true });
  } catch (error) {
    rmSync(targetPath, { force: true });
    if (existsSync(rollbackPath)) renameSync(rollbackPath, targetPath);
    throw error;
  } finally {
    rmSync(temporaryPath, { force: true });
  }

  return { targetPath, safetyBackup: safetyBackup?.destination ?? null };
}

function parseArgs(argv) {
  const fromIndex = argv.indexOf('--from');
  if (fromIndex < 0 || !argv[fromIndex + 1]) {
    throw new Error('Usage: npm run restore -- --from /path/to/backup.db --force');
  }
  return {
    backupPath: argv[fromIndex + 1],
    force: argv.includes('--force'),
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
