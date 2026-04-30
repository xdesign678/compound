#!/usr/bin/env node
/**
 * One-shot backfill: walk every source_chunks row that lacks
 * `contextual_prefix` and call the contextualizer to fill it in.
 *
 * Usage:
 *   node scripts/backfill-contextual-chunks.mjs [--limit 100] [--source-id s-xxx]
 *
 * Defaults:
 *   - limit  : 200 chunks per run (raise via --limit or COMPOUND_BACKFILL_LIMIT)
 *   - sleep  : 250ms between calls to avoid rate-limits
 *
 * Requires the same env as the main app (LLM_API_KEY etc.).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const argMap = new Map();
for (let i = 0; i < args.length; i += 1) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
    argMap.set(key, value);
    if (value !== 'true') i += 1;
  }
}

const root = process.cwd();
const outDir = path.join(root, 'node_modules', '.cache', 'compound-backfill');
const tsEntry = path.join(root, 'scripts', 'backfill-contextual-chunks.entry.ts');

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

const sourceFilter = argMap.get('source-id');
const limit = Number(argMap.get('limit') || process.env.COMPOUND_BACKFILL_LIMIT || 200);
const sleepMs = Number(argMap.get('sleep') || 250);

const entry = `
import { wikiRepo } from '../lib/wiki-db';
import { contextualizeChunk } from '../lib/contextual-chunk';
import { getServerDb } from '../lib/server-db';
import { repo } from '../lib/server-db';

async function main() {
  wikiRepo.ensureSchema();
  const db = getServerDb();
  const sourceFilter = ${JSON.stringify(sourceFilter || null)};
  const limit = ${limit};
  const sleepMs = ${sleepMs};

  const chunkRows = (sourceFilter
    ? db.prepare(\`SELECT id, source_id, content FROM source_chunks
                  WHERE source_id = ? AND (contextual_prefix IS NULL OR contextual_prefix = '')
                  ORDER BY chunk_index ASC LIMIT ?\`).all(sourceFilter, limit)
    : db.prepare(\`SELECT id, source_id, content FROM source_chunks
                  WHERE contextual_prefix IS NULL OR contextual_prefix = ''
                  ORDER BY updated_at DESC LIMIT ?\`).all(limit)) as Array<{
    id: string; source_id: string; content: string;
  }>;
  console.log(\`[backfill] candidates: \${chunkRows.length}\`);

  const sourceCache = new Map<string, { title: string; rawContent: string } | null>();
  function getSource(id: string) {
    if (sourceCache.has(id)) return sourceCache.get(id);
    const s = repo.getSource(id);
    sourceCache.set(id, s ? { title: s.title, rawContent: s.rawContent } : null);
    return sourceCache.get(id);
  }

  const updates: Array<{ chunkId: string; prefix: string }> = [];
  for (let i = 0; i < chunkRows.length; i += 1) {
    const row = chunkRows[i];
    const src = getSource(row.source_id);
    if (!src) {
      console.log(\`[backfill] skip \${row.id}: missing source\`);
      continue;
    }
    try {
      const prefix = await contextualizeChunk({
        fullDocument: src.rawContent,
        documentTitle: src.title,
        chunk: row.content,
      });
      if (prefix) {
        updates.push({ chunkId: row.id, prefix });
        console.log(\`[backfill] \${i + 1}/\${chunkRows.length} \${row.id} <- \${prefix.slice(0, 60)}\`);
      } else {
        console.log(\`[backfill] \${i + 1}/\${chunkRows.length} \${row.id} <- (empty)\`);
      }
    } catch (error) {
      console.error(\`[backfill] error \${row.id}:\`, error);
    }
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  }

  if (updates.length > 0) {
    wikiRepo.applyContextualPrefixes(updates);
    console.log(\`[backfill] wrote \${updates.length} prefixes\`);
  } else {
    console.log('[backfill] no updates to write');
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
`;

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(tsEntry, entry, 'utf8');

const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const tsc = spawnSync(
  npxBin,
  [
    'tsc',
    '--outDir',
    outDir,
    '--rootDir',
    '.',
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--target',
    'es2022',
    '--lib',
    'es2022,dom',
    '--esModuleInterop',
    '--skipLibCheck',
    tsEntry,
  ],
  { cwd: root, stdio: 'inherit' },
);

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

const compiled = path.join(outDir, 'scripts', 'backfill-contextual-chunks.entry.js');
const result = spawnSync(process.execPath, [compiled], { cwd: root, stdio: 'inherit' });

rmSync(tsEntry, { force: true });
process.exit(result.status ?? 0);
