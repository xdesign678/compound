import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_KEEP = 14;

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function verifySqliteFile(filePath) {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma('quick_check', { simple: true });
    if (result !== 'ok') throw new Error(`SQLite quick_check failed: ${String(result)}`);
  } finally {
    db.close();
  }
}

export function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function pruneBackups(backupDir, keep) {
  const backups = readdirSync(backupDir)
    .filter((name) => /^compound-\d{4}-.*\.db$/.test(name))
    .map((name) => ({ name, mtime: statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of backups.slice(keep)) {
    rmSync(path.join(backupDir, stale.name), { force: true });
    rmSync(path.join(backupDir, `${stale.name}.json`), { force: true });
  }
}

export async function createSqliteBackup(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || 'data');
  const sourcePath = path.resolve(options.sourcePath || path.join(dataDir, 'compound.db'));
  if (!existsSync(sourcePath)) throw new Error(`SQLite database not found: ${sourcePath}`);

  const backupDir = path.resolve(
    options.backupDir || process.env.COMPOUND_BACKUP_DIR || path.join(dataDir, 'backups'),
  );
  const requestedKeep = Number(options.keep ?? process.env.COMPOUND_BACKUP_KEEP ?? DEFAULT_KEEP);
  const keep = Number.isFinite(requestedKeep)
    ? Math.max(1, Math.trunc(requestedKeep))
    : DEFAULT_KEEP;
  mkdirSync(backupDir, { recursive: true });

  const destination = path.join(backupDir, `compound-${timestampForFile()}.db`);
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destination);
  } finally {
    source.close();
  }

  verifySqliteFile(destination);
  const metadata = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourcePath,
    file: path.basename(destination),
    bytes: statSync(destination).size,
    sha256: sha256File(destination),
  };
  writeFileSync(`${destination}.json`, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600,
  });
  pruneBackups(backupDir, keep);
  return { destination, metadata };
}

async function main() {
  const result = await createSqliteBackup();
  process.stdout.write(`${result.destination}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
