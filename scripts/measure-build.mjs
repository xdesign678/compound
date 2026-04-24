import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

/**
 * Measure a `next build` run: capture wall-clock duration, compare the
 * `.next/cache` directory before/after (cache-hit indicator), sample the
 * generated `.next/static` bundle size, count routes from the build log,
 * and write a JSON report to `tmp/build-metrics.json`. When running inside
 * GitHub Actions, also append a summary table to `$GITHUB_STEP_SUMMARY`.
 *
 * Exit code mirrors `next build` so that CI fails exactly when the build
 * fails, while still producing a metrics artifact.
 */

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const nextDir = path.join(repoRoot, '.next');
const cacheDir = path.join(nextDir, 'cache');
const staticDir = path.join(nextDir, 'static');
const tmpDir = path.join(repoRoot, 'tmp');
const reportPath = path.join(tmpDir, 'build-metrics.json');

/** Recursively sum file sizes in a directory. Returns 0 if missing. */
function dirSize(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(next);
        } else if (entry.isFile()) {
          total += statSync(next).size;
        }
      } catch {
        // ignore transient errors (e.g. files vanishing during build)
      }
    }
  }
  return total;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exp;
  return `${value.toFixed(exp === 0 ? 0 : 2)} ${units[exp]}`;
}

function formatMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}m ${rest.toFixed(1)}s`;
}

function readJsonSafe(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function detectNextVersion() {
  const pkg = readJsonSafe(path.join(repoRoot, 'node_modules', 'next', 'package.json'));
  if (pkg?.version) return pkg.version;
  const rootPkg = readJsonSafe(path.join(repoRoot, 'package.json'));
  return rootPkg?.dependencies?.next ?? null;
}

function resolveNextBin() {
  const local = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'next.cmd' : 'next',
  );
  if (existsSync(local)) return { command: local, args: ['build'] };
  // Fall back to npx if the local bin isn't present (shouldn't happen after npm ci).
  return { command: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['--no-install', 'next', 'build'] };
}

function parseRouteCount(log) {
  // Next.js prints a route table with a header line like "Route (app)" or
  // "Route (pages)". Count leafs that follow the typical └── / ├── prefixes.
  // This is best-effort and never fails the build when nothing is matched.
  const routeLinePattern = /^(?:\s*(?:├|└|│|─|\s)+)\s*[○●λƒ◐]\s+\/?[^\s]*/u;
  let count = 0;
  for (const raw of log.split('\n')) {
    if (routeLinePattern.test(raw)) count += 1;
  }
  return count > 0 ? count : null;
}

function currentCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    // Avoid spawning git if we're not in a repo.
    const headFile = path.join(repoRoot, '.git', 'HEAD');
    if (!existsSync(headFile)) return null;
    const head = readFileSync(headFile, 'utf8').trim();
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5);
      const refFile = path.join(repoRoot, '.git', ref);
      if (existsSync(refFile)) return readFileSync(refFile, 'utf8').trim();
      // Packed refs fallback.
      const packed = path.join(repoRoot, '.git', 'packed-refs');
      if (existsSync(packed)) {
        for (const line of readFileSync(packed, 'utf8').split('\n')) {
          if (line.endsWith(` ${ref}`)) return line.split(' ')[0];
        }
      }
      return null;
    }
    return head;
  } catch {
    return null;
  }
}

function currentBranch() {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  try {
    const headFile = path.join(repoRoot, '.git', 'HEAD');
    if (!existsSync(headFile)) return null;
    const head = readFileSync(headFile, 'utf8').trim();
    if (head.startsWith('ref: ')) return head.slice(5).replace(/^refs\/heads\//, '');
    return null;
  } catch {
    return null;
  }
}

async function runNextBuild() {
  const { command, args } = resolveNextBin();
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED ?? '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', (err) => {
      stderr += `\n[measure-build] failed to spawn next: ${err.message}\n`;
      resolve({ code: 127, stdout, stderr });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function writeStepSummary(metrics) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const rows = [
    ['Duration', formatMs(metrics.durationMs)],
    ['Exit code', String(metrics.exitCode)],
    ['Cache hit', metrics.cacheHit ? 'yes' : 'no'],
    ['Cache size (before)', formatBytes(metrics.cacheSizeBefore)],
    ['Cache size (after)', formatBytes(metrics.cacheSizeAfter)],
    ['.next/static size', formatBytes(metrics.staticBytes)],
    ['Routes detected', metrics.routes != null ? String(metrics.routes) : 'n/a'],
    ['Next.js', metrics.next ?? 'n/a'],
    ['Node.js', metrics.node],
    ['Commit', metrics.commit ?? 'n/a'],
    ['Branch', metrics.branch ?? 'n/a'],
  ];
  const md = [
    '### Build performance',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    '',
  ].join('\n');
  try {
    appendFileSync(summaryPath, `${md}\n`);
  } catch (err) {
    console.warn(`[measure-build] failed to write GitHub step summary: ${err.message}`);
  }
}

async function main() {
  mkdirSync(tmpDir, { recursive: true });

  const cacheExistedBefore = existsSync(cacheDir);
  const cacheSizeBefore = dirSize(cacheDir);

  const startedAt = Date.now();
  const startPerf = performance.now();

  const { code, stdout } = await runNextBuild();

  const durationMs = Math.round(performance.now() - startPerf);
  const cacheSizeAfter = dirSize(cacheDir);
  const staticBytes = dirSize(staticDir);
  const routes = parseRouteCount(stdout);

  const metrics = {
    timestamp: new Date(startedAt).toISOString(),
    durationMs,
    node: process.version,
    next: detectNextVersion(),
    cacheHit: cacheExistedBefore && cacheSizeBefore > 0,
    cacheSizeBefore,
    cacheSizeAfter,
    routes,
    staticBytes,
    exitCode: code,
    commit: currentCommit(),
    branch: currentBranch(),
    ci: Boolean(process.env.CI || process.env.GITHUB_ACTIONS),
  };

  try {
    writeFileSync(reportPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn(`[measure-build] failed to write ${reportPath}: ${err.message}`);
  }

  const human = [
    '',
    '── Build performance ─────────────────────────────',
    `  duration         : ${formatMs(metrics.durationMs)}`,
    `  exit code        : ${metrics.exitCode}`,
    `  cache hit        : ${metrics.cacheHit ? 'yes' : 'no'}`,
    `  cache before     : ${formatBytes(metrics.cacheSizeBefore)}`,
    `  cache after      : ${formatBytes(metrics.cacheSizeAfter)}`,
    `  .next/static     : ${formatBytes(metrics.staticBytes)}`,
    `  routes detected  : ${metrics.routes ?? 'n/a'}`,
    `  next / node      : ${metrics.next ?? 'n/a'} / ${metrics.node}`,
    `  report           : ${path.relative(repoRoot, reportPath)}`,
    '──────────────────────────────────────────────────',
    '',
  ].join('\n');
  process.stdout.write(human);

  writeStepSummary(metrics);

  process.exit(code);
}

main().catch((err) => {
  console.error(`[measure-build] unexpected error: ${err?.stack ?? err}`);
  process.exit(1);
});
