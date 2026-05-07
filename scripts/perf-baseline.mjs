#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, 'tmp');
const DATA_DIR = path.join(TMP_DIR, 'perf-test.db');
const OUT_FILE = path.join(TMP_DIR, 'perf-baseline.json');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'compound-perf-baseline');
const ENTRY_FILE = path.join(TMP_DIR, 'perf-baseline.entry.ts');

const entry = `
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

const root = ${JSON.stringify(ROOT)};
const dataDir = ${JSON.stringify(DATA_DIR)};
const outFile = ${JSON.stringify(OUT_FILE)};

process.env.DATA_DIR = dataDir;
process.env.COMPOUND_DISABLE_QUERY_ANALYZER = '1';

type BenchResult = {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
};

type BenchSummary = {
  generated: {
    concepts: number;
    chunks: number;
    sources: number;
    dbPath: string;
  };
  benchmarks: Record<string, BenchResult>;
};

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index] ?? 0;
}

function summarize(values: number[]): BenchResult {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    n: values.length,
    mean: round(sum / Math.max(1, values.length)),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
  };
}

function measure(name: string, iterations: number, fn: (i: number) => void): [string, BenchResult] {
  const timings: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const startedAt = performance.now();
    fn(i);
    timings.push(performance.now() - startedAt);
  }
  return [name, summarize(timings)];
}

function bodyFor(i: number): string {
  const topic = i % 100;
  return [
    '# Topic ' + topic,
    '',
    'This benchmark document explains topic' + topic + ' and sqlite baseline behavior.',
    'It contains retrieval text, relation hints, repair notes, and sync observations.',
    'The repeated terms make searchWikiContext and chunk lookup deterministic.',
  ].join('\\n');
}

async function main() {
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });

  const [{ getServerDb, repo }, { wikiRepo }] = await Promise.all([
    import('../lib/server-db'),
    import('../lib/wiki-db'),
  ]);

  wikiRepo.ensureSchema();
  const db = getServerDb();
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = OFF');

  const now = Date.now();
  const sourceCount = 1000;
  const conceptCount = 10000;
  const chunksPerSource = 50;
  const chunkCount = sourceCount * chunksPerSource;

  const insertSource = db.prepare(\`
    INSERT OR REPLACE INTO sources
      (id, title, type, author, url, raw_content, ingested_at, external_key)
    VALUES
      (@id, @title, 'markdown', NULL, NULL, @raw_content, @ingested_at, @external_key)
  \`);
  const insertConcept = db.prepare(\`
    INSERT OR REPLACE INTO concepts
      (id, title, summary, body, sources, related, categories, category_keys, created_at, updated_at, version)
    VALUES
      (@id, @title, @summary, @body, @sources, @related, '[]', '[]', @created_at, @updated_at, 1)
  \`);
  const insertChunk = db.prepare(\`
    INSERT OR REPLACE INTO source_chunks
      (id, source_id, chunk_index, heading, heading_path, content, token_count, content_hash, created_at, updated_at, contextual_prefix)
    VALUES
      (@id, @source_id, @chunk_index, @heading, @heading_path, @content, @token_count, @content_hash, @created_at, @updated_at, NULL)
  \`);
  const insertChunkFts = db.prepare(\`
    INSERT INTO chunk_fts (chunk_id, source_id, heading, content)
    VALUES (@id, @source_id, @heading, @content)
  \`);

  const seed = db.transaction(() => {
    for (let i = 0; i < sourceCount; i += 1) {
      insertSource.run({
        id: 's-' + i,
        title: 'Benchmark Source ' + i,
        raw_content: bodyFor(i),
        ingested_at: now - i,
        external_key: 'perf:' + i,
      });
    }

    for (let i = 0; i < conceptCount; i += 1) {
      const sourceId = 's-' + (i % sourceCount);
      const related = ['c-' + ((i + 1) % conceptCount), 'c-' + ((i + 17) % conceptCount)];
      insertConcept.run({
        id: 'c-' + i,
        title: 'Benchmark Concept ' + i + ' topic' + (i % 100),
        summary: 'Summary for topic' + (i % 100),
        body: 'Body for benchmark concept ' + i + ' with topic' + (i % 100) + ' retrieval terms.',
        sources: JSON.stringify([sourceId]),
        related: JSON.stringify(related),
        created_at: now - i,
        updated_at: now - i,
      });
    }

    for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex += 1) {
      for (let chunkIndex = 0; chunkIndex < chunksPerSource; chunkIndex += 1) {
        const id = 'ch-' + sourceIndex + '-' + chunkIndex;
        const topic = (sourceIndex + chunkIndex) % 100;
        const content =
          'Chunk ' + chunkIndex + ' for source ' + sourceIndex + ' explains topic' + topic +
          ' with sqlite search, repair, sync, and retrieval baseline text.';
        const row = {
          id,
          source_id: 's-' + sourceIndex,
          chunk_index: chunkIndex,
          heading: 'Topic ' + topic,
          heading_path: JSON.stringify(['Benchmark Source ' + sourceIndex, 'Topic ' + topic]),
          content,
          token_count: 80,
          content_hash: 'hash-' + sourceIndex + '-' + chunkIndex,
          created_at: now,
          updated_at: now,
        };
        insertChunk.run(row);
        insertChunkFts.run(row);
      }
    }
  });

  seed();

  const allConcepts = repo.listConcepts({ summariesOnly: false });
  for (const concept of allConcepts) {
    wikiRepo.indexConcept(concept);
  }
  wikiRepo.syncRelatedConceptRelations(allConcepts.slice(0, 1000), {
    reason: 'perf baseline seed',
    confidence: 0.5,
  });
  wikiRepo.addEvidenceBatch(
    Array.from({ length: 2000 }, (_, i) => ({
      conceptId: 'c-' + i,
      sourceId: 's-' + (i % sourceCount),
      chunkId: 'ch-' + (i % sourceCount) + '-' + (i % chunksPerSource),
      quote: 'Evidence quote for topic' + (i % 100),
      claim: 'Evidence claim for benchmark concept ' + i,
      kind: 'support' as const,
      confidence: 0.6,
    })),
  );

  const sampleConcepts = allConcepts.slice(0, 1000);
  const sampleIds = sampleConcepts.slice(0, 250).map((concept) => concept.id);

  const benchmarks = Object.fromEntries([
    measure('wikiRepo.searchWikiContext', 50, (i) => {
      wikiRepo.searchWikiContext('topic' + (i % 100), { conceptLimit: 24, chunkLimit: 12 });
    }),
    measure('wikiRepo.indexConcept', 1000, (i) => {
      wikiRepo.indexConcept(sampleConcepts[i % sampleConcepts.length]);
    }),
    measure('repo.listConcepts.summariesOnly', 20, () => {
      repo.listConcepts({ summariesOnly: true });
    }),
    measure('wikiRepo.getEvidenceForConcepts', 50, (i) => {
      const offset = (i * 5) % sampleIds.length;
      wikiRepo.getEvidenceForConcepts(sampleIds.slice(offset, offset + 24), 2);
    }),
  ]);

  const summary: BenchSummary = {
    generated: {
      concepts: conceptCount,
      chunks: chunkCount,
      sources: sourceCount,
      dbPath: path.join(dataDir, 'compound.db'),
    },
    benchmarks,
  };

  writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\\n', 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });
`;

if (existsSync(CACHE_DIR)) rmSync(CACHE_DIR, { recursive: true, force: true });
mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });
writeFileSync(ENTRY_FILE, entry, 'utf8');

const tsc = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'tsc',
    '--outDir',
    CACHE_DIR,
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
    ENTRY_FILE,
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

if (tsc.status !== 0) {
  rmSync(ENTRY_FILE, { force: true });
  process.exit(tsc.status ?? 1);
}

const compiled = path.join(CACHE_DIR, 'tmp', 'perf-baseline.entry.js');
const result = spawnSync(process.execPath, [compiled], { cwd: ROOT, stdio: 'inherit' });

rmSync(ENTRY_FILE, { force: true });
process.exit(result.status ?? 0);
