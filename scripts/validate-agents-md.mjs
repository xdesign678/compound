#!/usr/bin/env node
/**
 * Validate AGENTS.md against the actual state of the repository.
 *
 * The goal is to catch AGENTS.md drift early: when commands, scripts, paths
 * or CI behaviour referenced in AGENTS.md silently fall out of sync with the
 * codebase, this validator should fail loudly.
 *
 * Validation strategy
 * -------------------
 * 1. Parse all backtick `code spans` from AGENTS.md.
 * 2. For every span that looks like `npm run <script>`, assert that
 *    `<script>` exists in package.json's `scripts`.
 * 3. For every span that looks like a file path (relative to repo root),
 *    assert that either the file exists on disk OR the path matches an
 *    entry in `.gitignore` (i.e. it's intentionally not committed).
 * 4. Check structural invariants that AGENTS.md describes:
 *      - `npm run build:measure` resolves to `node scripts/measure-build.mjs`.
 *      - `.github/workflows/ci.yml` caches `.next/cache` with
 *        `actions/cache@v4`, keyed off `package-lock.json`.
 *      - `.github/workflows/ci.yml` uploads a `build-metrics` artifact
 *        and runs `npm run build:measure`.
 *      - `tmp/build-metrics.json` is ignored via `.gitignore`.
 *      - The git commands quoted in AGENTS.md (`git rev-parse`,
 *        `git checkout`, `git commit`, `git push`) are real subcommands.
 *
 * Run with:  node scripts/validate-agents-md.mjs
 * Or via:    npm run validate:agents-md
 *
 * Exit code 0 on success, 1 on validation failure.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const AGENTS_MD = path.join(repoRoot, 'AGENTS.md');
const PACKAGE_JSON = path.join(repoRoot, 'package.json');
const GITIGNORE = path.join(repoRoot, '.gitignore');
const CI_WORKFLOW = path.join(repoRoot, '.github', 'workflows', 'ci.yml');

const errors = [];
const notes = [];

function fail(msg) {
  errors.push(msg);
}

function note(msg) {
  notes.push(msg);
}

function readFileOrFail(p, label) {
  if (!existsSync(p)) {
    fail(`Missing required file: ${label} (${path.relative(repoRoot, p)})`);
    return null;
  }
  try {
    return readFileSync(p, 'utf8');
  } catch (err) {
    fail(`Failed to read ${label}: ${err.message}`);
    return null;
  }
}

const agentsMd = readFileOrFail(AGENTS_MD, 'AGENTS.md');
const packageJsonRaw = readFileOrFail(PACKAGE_JSON, 'package.json');
const gitignore = readFileOrFail(GITIGNORE, '.gitignore') ?? '';
const ciWorkflow = readFileOrFail(CI_WORKFLOW, '.github/workflows/ci.yml') ?? '';

if (!agentsMd || !packageJsonRaw) {
  reportAndExit();
}

let pkg;
try {
  pkg = JSON.parse(packageJsonRaw);
} catch (err) {
  fail(`package.json is not valid JSON: ${err.message}`);
  reportAndExit();
}

const scripts = pkg.scripts ?? {};

/** Extract all `backtick` code spans from a markdown document. */
function extractCodeSpans(md) {
  // Skip fenced code blocks first so their content isn't mistaken for inline spans.
  const withoutFences = md.replace(/```[\s\S]*?```/g, '');
  const spans = [];
  const re = /`([^`\n]+)`/g;
  let m;
  while ((m = re.exec(withoutFences)) !== null) {
    spans.push(m[1].trim());
  }
  return spans;
}

const codeSpans = extractCodeSpans(agentsMd);

if (codeSpans.length === 0) {
  fail(
    'AGENTS.md has no inline code spans; expected at least the build/git commands to be quoted.',
  );
}

// 1. Validate `npm run <script>` references.
const npmRunSpans = codeSpans.filter((s) => /^npm run [\w:.-]+$/.test(s));
if (npmRunSpans.length === 0) {
  note('No `npm run ...` commands found in AGENTS.md (this may be fine).');
}
for (const span of npmRunSpans) {
  const scriptName = span.replace(/^npm run /, '');
  if (!Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
    fail(
      `AGENTS.md references \`${span}\`, but package.json has no "${scriptName}" script. ` +
        'Either update AGENTS.md or restore the script in package.json.',
    );
  }
}

// 2. Validate file/path references mentioned in code spans.
//    A code span is treated as a path if it contains a `/`, `.` (extension)
//    or starts with `.` (dotfile / dotdir) and does NOT look like a shell
//    command, URL, or version specifier.
function looksLikeShellCommand(span) {
  return /\s/.test(span) && !span.startsWith('.') && !span.startsWith('/');
}

function looksLikeUrl(span) {
  return /^[a-z]+:\/\//i.test(span);
}

function isPathCandidate(span) {
  if (looksLikeShellCommand(span)) return false;
  if (looksLikeUrl(span)) return false;
  if (/\s/.test(span)) return false; // prose snippets like `/** ... */`, not paths
  if (span.includes('@')) return false; // e.g. actions/cache@v4
  if (/^[\w-]+$/.test(span)) return false; // bare identifiers like `main`
  if (!span.includes('/') && !span.startsWith('.')) {
    return existsSync(path.join(repoRoot, span));
  }
  return span.includes('/') || /\.[a-zA-Z0-9]+$/.test(span);
}

function globishPathExists(candidate) {
  const normalized = candidate.replace(/^\.\//, '').replace(/^\/+/, '');
  if (!/[*?[\]]/.test(normalized)) {
    return existsSync(path.join(repoRoot, normalized));
  }
  const stablePrefix = normalized.split(/[*?[\]]/)[0].replace(/\/+$/, '');
  return stablePrefix.length === 0 || existsSync(path.join(repoRoot, stablePrefix));
}

function gitignoreCovers(gitignoreText, candidate) {
  // Very small subset matcher: exact match or prefix-directory match.
  const normalized = candidate.replace(/^\.\//, '').replace(/^\/+/, '');
  for (const rawLine of gitignoreText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const pattern = line.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!pattern) continue;
    if (pattern === normalized) return true;
    if (normalized.startsWith(`${pattern}/`)) return true;
    // Wildcards: support a single trailing `/*` or leading `*.ext`.
    if (pattern.startsWith('*.')) {
      if (normalized.endsWith(pattern.slice(1))) return true;
    }
  }
  return false;
}

const PATH_ALLOWLIST = new Set([
  // Conceptual directories produced at runtime; not committed but expected.
  '.next/cache',
  '.next/static',
]);

for (const span of codeSpans) {
  if (!isPathCandidate(span)) continue;
  if (PATH_ALLOWLIST.has(span)) continue;
  if (globishPathExists(span)) continue;
  if (gitignoreCovers(gitignore, span)) continue;
  fail(
    `AGENTS.md references path \`${span}\`, but it does not exist in the repo and is not covered by .gitignore. ` +
      'Update AGENTS.md or restore the file/path.',
  );
}

// 3. Structural invariants tied to AGENTS.md content.

// 3a. build:measure must invoke scripts/measure-build.mjs.
if (
  codeSpans.some((s) => s === 'npm run build:measure' || s === 'node scripts/measure-build.mjs')
) {
  const buildMeasure = scripts['build:measure'];
  if (!buildMeasure) {
    fail(
      'AGENTS.md describes `npm run build:measure`, but package.json has no `build:measure` script.',
    );
  } else if (!/scripts\/measure-build\.mjs/.test(buildMeasure)) {
    fail(
      `package.json "build:measure" should run scripts/measure-build.mjs, but currently runs: ${buildMeasure}`,
    );
  }
  if (!existsSync(path.join(repoRoot, 'scripts', 'measure-build.mjs'))) {
    fail('AGENTS.md references scripts/measure-build.mjs, but the file is missing.');
  }
}

// 3b. CI workflow expectations from AGENTS.md.
if (/\bGitHub Actions\b/i.test(agentsMd) || /actions\/cache@v4/.test(agentsMd)) {
  if (!ciWorkflow) {
    fail('AGENTS.md describes a GitHub Actions workflow, but .github/workflows/ci.yml is missing.');
  } else {
    if (!/actions\/cache@v4/.test(ciWorkflow)) {
      fail('AGENTS.md mentions `actions/cache@v4`, but ci.yml does not use it.');
    }
    if (!/\.next\/cache/.test(ciWorkflow)) {
      fail(
        'AGENTS.md describes caching `.next/cache` in CI, but ci.yml does not reference that path.',
      );
    }
    if (!/package-lock\.json/.test(ciWorkflow)) {
      fail(
        'AGENTS.md says the cache key includes `package-lock.json`, but ci.yml does not reference it.',
      );
    }
    if (/build-metrics/.test(agentsMd) && !/name:\s*build-metrics/.test(ciWorkflow)) {
      fail('AGENTS.md describes a `build-metrics` artifact, but ci.yml does not upload it.');
    }
    if (/build:measure/.test(agentsMd) && !/build:measure/.test(ciWorkflow)) {
      fail('AGENTS.md says CI runs `npm run build:measure`, but ci.yml does not invoke it.');
    }
  }
}

// 3c. tmp/build-metrics.json should be gitignored, as AGENTS.md claims.
if (/tmp\/build-metrics\.json/.test(agentsMd)) {
  if (!gitignoreCovers(gitignore, 'tmp/build-metrics.json')) {
    fail(
      'AGENTS.md states tmp/build-metrics.json is gitignored, but it is not listed in .gitignore.',
    );
  }
}

// 3d. Sanity-check the git invocations quoted in AGENTS.md.
const KNOWN_GIT_SUBCOMMANDS = new Set([
  'rev-parse',
  'checkout',
  'commit',
  'push',
  'status',
  'log',
  'diff',
  'fetch',
  'pull',
  'add',
  'merge',
  'rebase',
  'branch',
  'tag',
  'symbolic-ref',
  'rev-list',
]);
for (const span of codeSpans) {
  const m = /^git\s+([\w-]+)/.exec(span);
  if (!m) continue;
  const sub = m[1];
  if (!KNOWN_GIT_SUBCOMMANDS.has(sub)) {
    fail(`AGENTS.md uses an unknown git subcommand: \`git ${sub}\``);
  }
}

reportAndExit();

function reportAndExit() {
  for (const n of notes) console.log(`note: ${n}`);
  if (errors.length > 0) {
    console.error('');
    console.error('AGENTS.md validation FAILED:');
    for (const e of errors) console.error(`  - ${e}`);
    console.error('');
    console.error('Update AGENTS.md or the codebase so they stay in sync, then re-run:');
    console.error('  npm run validate:agents-md');
    process.exit(1);
  }
  console.log(`AGENTS.md validation OK (${codeSpans.length} code spans checked).`);
  process.exit(0);
}
