#!/usr/bin/env node
/**
 * Q&A evaluation runner — RAGAS-lite for /api/query.
 *
 * Loads `eval/golden-set.json`, fires each question at a running Compound
 * server, computes hit@k / MRR / keyword recall / latency, prints a table,
 * persists results to `tmp/eval/latest.json`, and diffs against
 * `tmp/eval/baseline.json` when present.
 *
 * Usage:
 *   # 1. Start the server in another terminal:
 *   #      npm run dev
 *   # 2. Then run:
 *   COMPOUND_ADMIN_TOKEN=secret npm run eval
 *
 * Flags:
 *   --base-url URL         (default: http://localhost:8080)
 *   --token TOKEN          (alternatively COMPOUND_ADMIN_TOKEN env)
 *   --golden PATH          (default: eval/golden-set.json)
 *   --update-baseline      Save current run as the new baseline
 *   --concurrency N        (default: 1 — be gentle on the LLM)
 *   --filter CATEGORY      Only run items whose category matches
 *   --verbose              Dump per-item answer to stdout
 *
 * Exit codes:
 *   0  = pass (no severe regressions vs baseline)
 *   2  = baseline regressions detected
 *   1  = runtime error (network, parse, etc.)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));

const baseUrl = (args['base-url'] || process.env.COMPOUND_EVAL_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const adminToken = args.token || process.env.COMPOUND_ADMIN_TOKEN || '';
const goldenPath = path.resolve(root, args.golden || 'eval/golden-set.json');
const concurrency = Math.max(1, Number(args.concurrency || 1));
const filter = args.filter || null;
const verbose = Boolean(args.verbose);
const updateBaseline = Boolean(args['update-baseline']);

if (!existsSync(goldenPath)) {
  console.error(`[eval] golden set not found at ${goldenPath}`);
  process.exit(1);
}

const goldenRaw = JSON.parse(readFileSync(goldenPath, 'utf8'));
const allItems = Array.isArray(goldenRaw.items) ? goldenRaw.items : [];
const items = filter ? allItems.filter((it) => it.category === filter) : allItems;

if (items.length === 0) {
  console.error(`[eval] no golden items to run (filter=${filter ?? 'none'})`);
  process.exit(1);
}

console.log(`[eval] running ${items.length} item(s) against ${baseUrl}`);

// Compile lib/eval/metrics.ts once so the runner can import the pure scoring fns.
const cacheDir = path.join(root, 'node_modules', '.cache', 'compound-eval');
rmSync(cacheDir, { recursive: true, force: true });
mkdirSync(cacheDir, { recursive: true });

const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const tsc = spawnSync(
  npxBin,
  [
    'tsc',
    '--outDir', cacheDir,
    '--rootDir', '.',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--target', 'es2022',
    '--lib', 'es2022,dom',
    '--esModuleInterop',
    '--skipLibCheck',
    'lib/eval/metrics.ts',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (tsc.status !== 0) {
  console.error('[eval] tsc failed compiling lib/eval/metrics.ts');
  process.exit(1);
}

const metricsModule = await import(
  path.join(cacheDir, 'lib', 'eval', 'metrics.js')
);
const { scoreItem, aggregate, diffAggregates } = metricsModule;

const scores = [];
const cursorItems = [...items];
async function worker() {
  while (cursorItems.length > 0) {
    const item = cursorItems.shift();
    if (!item) break;
    const score = await runOne(item);
    scores.push(score);
    printOneLine(score);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const agg = aggregate(scores);
const tmpDir = path.join(root, 'tmp', 'eval');
mkdirSync(tmpDir, { recursive: true });
const latestPath = path.join(tmpDir, 'latest.json');
const baselinePath = path.join(tmpDir, 'baseline.json');

const latest = {
  baseUrl,
  goldenPath: path.relative(root, goldenPath),
  ranAt: new Date().toISOString(),
  aggregate: agg,
  items: scores,
};
writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
console.log(`\n[eval] wrote ${path.relative(root, latestPath)}`);

let exitCode = 0;
const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, 'utf8'))
  : null;

printSummary(agg, items.length, scores);

if (baseline?.aggregate) {
  const diffs = diffAggregates(baseline.aggregate, agg);
  printDiff(diffs);
  const regressions = diffs.filter((d) => d.direction === 'bad');
  if (regressions.length > 0 && !updateBaseline) {
    console.log(`\n[eval] ${regressions.length} regression(s) vs baseline.`);
    exitCode = 2;
  }
} else {
  console.log('\n[eval] no baseline yet — run with --update-baseline to record one.');
}

if (updateBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify(latest, null, 2)}\n`);
  console.log(`[eval] saved current run as baseline → ${path.relative(root, baselinePath)}`);
  exitCode = 0;
}

process.exit(exitCode);

// --------------------------------------------------------------------------

async function runOne(item) {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(adminToken ? { 'x-compound-admin-token': adminToken } : {}),
      },
      body: JSON.stringify({
        question: item.question,
        concepts: [],
        conversationHistory: item.history || [],
      }),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return scoreItem(item, {
        question: item.question,
        citedConceptIds: [],
        answer: '',
        latencyMs,
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      }, []);
    }
    const data = await res.json();
    const cited = Array.isArray(data.citedConceptIds) ? data.citedConceptIds : [];
    // We don't have stable titles from /api/query; matching is id-only.
    // Title-based expectations need the user to fetch concept titles
    // separately — pass empty titles and rely on id matching.
    const candidates = cited.map((id) => ({ id, title: '' }));
    const result = {
      question: item.question,
      citedConceptIds: cited,
      retrievedConceptIds: cited,
      answer: typeof data.answer === 'string' ? data.answer : '',
      latencyMs,
      retrievalMode: data.retrievalMode,
      rewrittenQuestion: data.rewrittenQuestion,
    };
    if (verbose) {
      console.log(`\n--- ${item.id} ---\nQ: ${item.question}\nA: ${result.answer.slice(0, 600)}\n`);
    }
    // Title-based hit needs concept titles; fetch them best-effort. The
    // server doesn't return them, so we approximate by treating
    // expectedConceptTitles as keywords against the answer for now.
    const augmented = { ...item };
    if (item.expectedConceptTitles && item.expectedConceptTitles.length > 0) {
      augmented.expectedKeywords = [
        ...(item.expectedKeywords || []),
        ...item.expectedConceptTitles,
      ];
    }
    return scoreItem(augmented, result, candidates);
  } catch (error) {
    return scoreItem(item, {
      question: item.question,
      citedConceptIds: [],
      answer: '',
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }, []);
  }
}

function printOneLine(score) {
  const status = score.error ? 'ERR' : 'OK ';
  const hit = score.hitSkipped ? '  -' : `${score.hitAt8 ? '✓' : '✗'} `;
  const kw = score.keywordSkipped ? '  -' : `${(score.keywordRecall * 100).toFixed(0)}%`;
  const tag = score.category ? `[${score.category}]` : '';
  const err = score.error ? ` :: ${score.error.slice(0, 120)}` : '';
  console.log(
    `[${status}] ${score.id.padEnd(20)} ${tag.padEnd(14)} hit@8=${hit} kw=${kw.padStart(4)}  ${score.latencyMs}ms${err}`,
  );
}

function printSummary(agg, total, scores) {
  const fmt = (n) => (typeof n === 'number' ? n.toFixed(3) : n);
  console.log('\n=== Aggregate ===');
  console.log(`  items         : ${total} (errored ${agg.errored})`);
  console.log(`  hit@1         : ${fmt(agg.hitAt1)}`);
  console.log(`  hit@3         : ${fmt(agg.hitAt3)}`);
  console.log(`  hit@8         : ${fmt(agg.hitAt8)}`);
  console.log(`  MRR           : ${fmt(agg.mrr)}`);
  console.log(`  keyword recall: ${fmt(agg.keywordRecall)}`);
  console.log(`  avg latency   : ${Math.round(agg.latency.avg)} ms`);
  console.log(`  p95 latency   : ${Math.round(agg.latency.p95)} ms`);
  const byCategory = new Map();
  for (const s of scores) {
    const key = s.category || '(uncategorized)';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(s);
  }
  if (byCategory.size > 1) {
    console.log('\n=== By category ===');
    for (const [cat, items] of byCategory) {
      const sub = aggregate(items);
      console.log(
        `  ${cat.padEnd(14)} hit@8=${fmt(sub.hitAt8)} mrr=${fmt(sub.mrr)} n=${items.length}`,
      );
    }
  }
}

function printDiff(diffs) {
  if (!diffs || diffs.length === 0) return;
  console.log('\n=== vs baseline ===');
  for (const d of diffs) {
    const arrow = d.direction === 'good' ? '↑' : d.direction === 'bad' ? '↓' : '·';
    const sign = d.delta >= 0 ? '+' : '';
    console.log(
      `  ${arrow} ${d.metric.padEnd(18)} ${d.before.toFixed(3)} → ${d.after.toFixed(3)} (${sign}${d.delta.toFixed(3)})`,
    );
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}
