#!/usr/bin/env node
/**
 * Technical debt scanner.
 *
 * Walks the source tree (`app`, `components`, `lib`, `scripts`,
 * `runbooks`, `docs`, plus root-level TS/JS) and collects every
 * occurrence of a tech-debt marker (TODO, FIXME, HACK, XXX, BUG,
 * DEPRECATED, REFACTOR). Each finding is classified as either
 * `tracked` (linked to an issue/ticket/URL) or `untracked`.
 *
 * Outputs:
 *   - tmp/tech-debt-report.json
 *   - tmp/tech-debt-report.md
 *
 * Behaviour:
 *   - Default run prints a concise summary and exits 0 (informational).
 *   - With `--check`, exits non-zero if any *untracked* markers exist
 *     or if the total marker count exceeds COMPOUND_MAX_DEBT_MARKERS
 *     (default 50). This is what CI invokes.
 *
 * A marker is considered "tracked" when it is followed by a parenthetical
 * reference, e.g.
 *
 *     // TODO(#123): wire up retry
 *     // FIXME(JIRA-42): off-by-one
 *     // HACK(https://github.com/org/repo/issues/9): workaround
 *
 * The scanner intentionally lives alongside other quality tooling
 * (`quality-metrics.mjs`, `duplicate-detection.mjs`) so the CI summary
 * surfaces tech-debt the same way it surfaces complexity and dup data.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const SOURCE_ROOTS = ['app', 'components', 'lib', 'scripts', 'runbooks', 'docs'];
const ROOT_FILES = [
  'middleware.ts',
  'instrumentation.ts',
  'instrumentation-client.ts',
  'next.config.mjs',
  'sentry.server.config.ts',
  'sentry.edge.config.ts',
  'dangerfile.ts',
];
const SCAN_EXTENSIONS = /\.(mjs|cjs|js|jsx|ts|tsx|md|mdx|yml|yaml)$/;
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'tmp',
  'output',
  'data',
  'coverage',
  '.serena',
  '.factory',
  '.husky',
  '.codex',
  '.verdent',
  '.claude',
  '.playwright-cli',
]);

const MARKER_KINDS = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'DEPRECATED', 'REFACTOR'];
// Match a marker that *looks like an actual debt marker*, i.e. either:
//   - has a parenthetical reference: `TODO(#1)`, `FIXME(JIRA-2)`
//   - is followed by `:`, `-`, or `!`: `TODO:`, `FIXME -`, `HACK!`
// This deliberately ignores prose mentions like `TODO/FIXME` inside strings,
// regex sources (`\b(TODO|FIXME)\b`) or freeform documentation.
const MARKER_RE = new RegExp(
  String.raw`(^|[^A-Za-z0-9_])(${MARKER_KINDS.join('|')})\b(?:\s*\(([^)]+)\))?\s*[:\-!]`,
);
const TRACKED_REF_RE = /(#\d+|[A-Z][A-Z0-9]+-\d+|https?:\/\/|\/issues?\/|\/pull\/)/i;

const MAX_MARKERS = Number(process.env.COMPOUND_MAX_DEBT_MARKERS ?? 50);
const CHECK_MODE = process.argv.includes('--check');
const SELF_PATH = fileURLToPath(import.meta.url);

const findings = [];
for (const dir of SOURCE_ROOTS) {
  walk(path.join(ROOT, dir));
}
for (const file of ROOT_FILES) {
  const full = path.join(ROOT, file);
  if (existsSync(full)) scanFile(full);
}

findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

const summary = summarise(findings);
const report = {
  tool: 'compound tech-debt scanner',
  generatedAt: new Date().toISOString(),
  scope: { roots: SOURCE_ROOTS, rootFiles: ROOT_FILES },
  thresholds: { maxMarkers: MAX_MARKERS, untrackedAllowed: 0 },
  summary,
  findings,
};

const outDir = path.join(ROOT, 'tmp');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'tech-debt-report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(outDir, 'tech-debt-report.md'), renderMarkdown(report));

const untracked = findings.filter((f) => !f.tracked);
const overBudget = findings.length > MAX_MARKERS;

console.log(
  `Tech debt: ${findings.length} marker(s) across ${summary.fileCount} file(s); ` +
    `${untracked.length} untracked, ${findings.length - untracked.length} tracked. ` +
    `Budget ${MAX_MARKERS}.`,
);

if (CHECK_MODE && (untracked.length > 0 || overBudget)) {
  if (untracked.length > 0) {
    console.error('\nUntracked tech-debt markers (link them to an issue, e.g. `TODO(#123)`):');
    for (const f of untracked.slice(0, 50)) {
      console.error(`  ${f.path}:${f.line}  ${f.kind}  ${f.text}`);
    }
    if (untracked.length > 50) {
      console.error(`  ...and ${untracked.length - 50} more`);
    }
  }
  if (overBudget) {
    console.error(
      `\nTech-debt budget exceeded: ${findings.length} markers > ${MAX_MARKERS}. ` +
        `Pay some debt down or raise COMPOUND_MAX_DEBT_MARKERS deliberately.`,
    );
  }
  process.exit(1);
}

function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SCAN_EXTENSIONS.test(entry.name)) continue;
    scanFile(full);
  }
}

function scanFile(absPath) {
  if (absPath === SELF_PATH) return;
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return;
  }
  if (text.startsWith('// AUTO-GENERATED') || text.startsWith('<!-- AUTO-GENERATED -->')) return;

  const rel = path.relative(ROOT, absPath);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(MARKER_RE);
    if (!match) continue;
    const kind = match[2];
    const ref = (match[3] ?? '').trim();
    const tracked = ref.length > 0 && TRACKED_REF_RE.test(ref);
    findings.push({
      path: rel,
      line: i + 1,
      kind,
      reference: ref || null,
      tracked,
      text: line.trim().slice(0, 200),
    });
  }
}

function summarise(items) {
  const byKind = {};
  const byFile = new Map();
  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
    byFile.set(item.path, (byFile.get(item.path) ?? 0) + 1);
  }
  return {
    total: items.length,
    tracked: items.filter((i) => i.tracked).length,
    untracked: items.filter((i) => !i.tracked).length,
    fileCount: byFile.size,
    byKind,
    topFiles: [...byFile.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([file, count]) => ({ file, count })),
  };
}

function renderMarkdown(report) {
  const { summary, findings: items, thresholds } = report;
  const kindRows = Object.entries(summary.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `| ${kind} | ${count} |`)
    .join('\n');
  const fileRows = summary.topFiles.map((f) => `| ${f.file} | ${f.count} |`).join('\n');
  const untrackedRows = items
    .filter((i) => !i.tracked)
    .slice(0, 25)
    .map((i) => `| ${i.path}:${i.line} | ${i.kind} | ${escapeCell(i.text)} |`)
    .join('\n');

  return `# Technical Debt Report

Generated: ${report.generatedAt}

| Metric | Value |
| --- | ---: |
| Total markers | ${summary.total} |
| Tracked (linked to issue) | ${summary.tracked} |
| Untracked | ${summary.untracked} |
| Files with markers | ${summary.fileCount} |
| Marker budget | ${thresholds.maxMarkers} |

## By kind

| Kind | Count |
| --- | ---: |
${kindRows || '| _none_ | 0 |'}

## Top files

| File | Markers |
| --- | ---: |
${fileRows || '| _none_ | 0 |'}

## Untracked markers (first 25)

${
  untrackedRows
    ? `| Location | Kind | Line |\n| --- | --- | --- |\n${untrackedRows}`
    : '_None - every marker is linked to a tracked issue._'
}

> Convention: link every TODO/FIXME/HACK to a tracking issue, e.g. \`TODO(#123): retry\`.
> Run \`npm run debt:check\` locally to verify before pushing.
`;
}

function escapeCell(value) {
  return value.replace(/\|/g, '\\|');
}

function existsSync(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
