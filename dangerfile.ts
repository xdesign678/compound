/**
 * Danger JS configuration for automated PR review.
 *
 * This file is executed by `danger ci` in the PR Review GitHub Actions workflow.
 * It inspects the pull request metadata and diff, then posts review comments
 * (messages, warnings, failures) back onto the pull request so contributors get
 * fast, actionable feedback without waiting for a human reviewer.
 *
 * See https://danger.systems/js/ for the full API.
 */

import { danger, fail, warn, message, markdown } from 'danger';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** PRs bigger than this are flagged as "please split". */
const BIG_PR_LINE_THRESHOLD = 600;

/** Individual files larger than this trigger a "huge file" warning. */
const LARGE_FILE_LINE_THRESHOLD = 500;

/** Minimum PR title length to discourage drive-by titles like "fix". */
const MIN_TITLE_LENGTH = 10;

/** Conventional Commit prefixes we recognise in PR titles. */
const CONVENTIONAL_PREFIXES = [
  'feat',
  'fix',
  'chore',
  'docs',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'style',
  'revert',
];

/** Directories considered to contain production source code. */
const SOURCE_DIRS = ['app/', 'components/', 'lib/', 'middleware.ts'];

/** Patterns that identify test files. */
const TEST_FILE_PATTERN = /\.test\.[cm]?[tj]sx?$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pr = danger.github?.pr;
const modified = danger.git.modified_files ?? [];
const created = danger.git.created_files ?? [];
const deleted = danger.git.deleted_files ?? [];
const touched = [...modified, ...created];

function isSourceFile(path: string): boolean {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return false;
  if (TEST_FILE_PATTERN.test(path)) return false;
  return SOURCE_DIRS.some((dir) => path === dir || path.startsWith(dir));
}

function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERN.test(path);
}

// ---------------------------------------------------------------------------
// PR metadata checks
// ---------------------------------------------------------------------------

if (pr) {
  // Empty description
  const body = (pr.body ?? '').trim();
  if (body.length === 0) {
    warn(
      'This PR has no description. Please add a short summary of **what** changed and **why** so reviewers have context.',
    );
  } else if (body.length < 30) {
    warn(
      `The PR description is quite short (${body.length} chars). Consider expanding it with context, motivation, or a test plan.`,
    );
  }

  // Title length
  const title = (pr.title ?? '').trim();
  if (title.length < MIN_TITLE_LENGTH) {
    warn(
      `The PR title "${title}" is very short. Prefer a descriptive, imperative title (e.g., "fix: prevent duplicate sync runs").`,
    );
  }

  // Conventional commit style
  const conventionalRegex = new RegExp(
    `^(${CONVENTIONAL_PREFIXES.join('|')})(\\([^)]+\\))?!?:\\s+.+`,
    'i',
  );
  if (title.length > 0 && !conventionalRegex.test(title)) {
    warn(
      `The PR title does not match the Conventional Commits pattern (e.g., \`feat: ...\`, \`fix(scope): ...\`). Recognised prefixes: ${CONVENTIONAL_PREFIXES.join(
        ', ',
      )}.`,
    );
  }

  // WIP / Draft heuristics
  if (/\b(wip|do not merge|dnm)\b/i.test(title)) {
    warn('Title indicates work-in-progress. Convert to a Draft PR or remove the WIP marker before requesting review.');
  }
}

// ---------------------------------------------------------------------------
// PR size checks
// ---------------------------------------------------------------------------

const additions = pr?.additions ?? 0;
const deletions = pr?.deletions ?? 0;
const totalChanges = additions + deletions;

if (totalChanges > BIG_PR_LINE_THRESHOLD) {
  warn(
    `:warning: This PR changes **${totalChanges}** lines (${additions} additions, ${deletions} deletions), which is above the ${BIG_PR_LINE_THRESHOLD}-line threshold. Consider splitting it into smaller, focused PRs for easier review.`,
  );
}

// ---------------------------------------------------------------------------
// package.json / lockfile consistency
// ---------------------------------------------------------------------------

const packageJsonChanged = touched.includes('package.json');
const lockfileChanged = touched.includes('package-lock.json');

if (packageJsonChanged && !lockfileChanged) {
  fail(
    '`package.json` was modified but `package-lock.json` was not updated. Please run `npm install` and commit the updated lockfile.',
  );
}
if (!packageJsonChanged && lockfileChanged) {
  warn(
    '`package-lock.json` changed without any change to `package.json`. Double-check this is intentional (e.g., `npm install` with no dep change).',
  );
}

// ---------------------------------------------------------------------------
// Tests coverage heuristic
// ---------------------------------------------------------------------------

const changedSourceFiles = touched.filter(isSourceFile);
const changedTestFiles = touched.filter(isTestFile);

if (changedSourceFiles.length > 0 && changedTestFiles.length === 0) {
  warn(
    `This PR touches source files (${changedSourceFiles.length}) but does not update any tests. ` +
      `Consider adding or updating tests under \`lib/*.test.ts\` to cover the new behaviour.\n\n` +
      `Changed source files:\n${changedSourceFiles.map((f) => `- \`${f}\``).join('\n')}`,
  );
}

// ---------------------------------------------------------------------------
// Diff-level checks (console.log, TODO/FIXME, large files)
// ---------------------------------------------------------------------------

async function runDiffChecks(): Promise<void> {
  const consoleLogOffenders: string[] = [];
  const todoOffenders: string[] = [];
  const largeFiles: string[] = [];

  for (const file of touched) {
    // Ignore non-text / generated files for diff scans.
    if (/\.(png|jpg|jpeg|gif|svg|ico|webp|lockb?|snap)$/i.test(file)) continue;
    if (file === 'package-lock.json') continue;
    if (file === 'dangerfile.ts') continue;

    let diff;
    try {
      diff = await danger.git.diffForFile(file);
    } catch {
      continue;
    }
    if (!diff) continue;

    const added = diff.added ?? '';

    // console.log introductions (skip test files; they sometimes use console for debugging)
    if (!isTestFile(file) && /^\+.*\bconsole\.(log|debug)\s*\(/m.test('+' + added.replace(/\n/g, '\n+'))) {
      consoleLogOffenders.push(file);
    }

    // TODO/FIXME introductions
    if (/\b(TODO|FIXME|XXX|HACK)\b/.test(added)) {
      todoOffenders.push(file);
    }

    // Large-file heuristic: report when the *current* file is very long
    // and received additions in this PR.
    try {
      const structured = await danger.git.structuredDiffForFile(file);
      const totalAddedLines = (structured?.chunks ?? []).reduce(
        (n, chunk) => n + chunk.changes.filter((c) => c.type === 'add').length,
        0,
      );
      if (totalAddedLines >= LARGE_FILE_LINE_THRESHOLD) {
        largeFiles.push(`${file} (+${totalAddedLines} lines)`);
      }
    } catch {
      // structuredDiffForFile can fail on binary files; safe to ignore.
    }
  }

  if (consoleLogOffenders.length > 0) {
    warn(
      `Found new \`console.log\`/\`console.debug\` calls. Please remove debug logging or switch to a structured logger before merging:\n${consoleLogOffenders
        .map((f) => `- \`${f}\``)
        .join('\n')}`,
    );
  }

  if (todoOffenders.length > 0) {
    warn(
      `This PR introduces \`TODO\`/\`FIXME\`/\`HACK\` comments. Please link an issue or resolve them before merge:\n${todoOffenders
        .map((f) => `- \`${f}\``)
        .join('\n')}`,
    );
  }

  if (largeFiles.length > 0) {
    warn(
      `The following files gained **${LARGE_FILE_LINE_THRESHOLD}+** lines in this PR. Consider splitting them into smaller modules:\n${largeFiles
        .map((f) => `- \`${f}\``)
        .join('\n')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Documentation visibility
// ---------------------------------------------------------------------------

const docsTouched = touched.filter((f) => /^(README\.md|AGENTS\.md|SECURITY\.md|docs\/.+)$/.test(f));
if (docsTouched.length > 0) {
  message(
    `:books: Documentation updated in this PR: ${docsTouched.map((f) => `\`${f}\``).join(', ')}. Thanks for keeping docs in sync!`,
  );
}

// ---------------------------------------------------------------------------
// CI / workflow visibility
// ---------------------------------------------------------------------------

const workflowsTouched = touched.filter((f) => f.startsWith('.github/workflows/'));
if (workflowsTouched.length > 0) {
  message(
    `:gear: GitHub Actions workflows were changed (${workflowsTouched
      .map((f) => `\`${f}\``)
      .join(
        ', ',
      )}). Double-check required secrets and permissions, and verify the workflow runs green on this PR.`,
  );
}

// ---------------------------------------------------------------------------
// Deleted files visibility
// ---------------------------------------------------------------------------

if (deleted.length > 0) {
  message(
    `:wastebasket: This PR deletes ${deleted.length} file(s):\n${deleted.map((f) => `- \`${f}\``).join('\n')}`,
  );
}

// ---------------------------------------------------------------------------
// Positive acknowledgement
// ---------------------------------------------------------------------------

function emitClean(): void {
  if (totalChanges > 0 && totalChanges <= BIG_PR_LINE_THRESHOLD && changedSourceFiles.length === 0) {
    message(':sparkles: Thanks for the contribution! The PR looks small and focused.');
  } else if (changedSourceFiles.length > 0 && changedTestFiles.length > 0) {
    message(':white_check_mark: Source changes are accompanied by test updates — thank you!');
  }
}

// ---------------------------------------------------------------------------
// Kick off the async checks
// ---------------------------------------------------------------------------

// Danger awaits the default export of a dangerfile when it's a Promise,
// so we run the async checks via a top-level expression.
runDiffChecks()
  .catch((err) => {
    warn(`Danger diff inspection failed: ${err instanceof Error ? err.message : String(err)}`);
  })
  .finally(() => {
    emitClean();
    markdown(
      [
        '<details>',
        '<summary>ℹ️ About this automated review</summary>',
        '',
        'This review is generated by [Danger JS](https://danger.systems/js/) via the `PR Review` workflow.',
        'It checks PR metadata, size, tests coverage heuristics, lockfile consistency, large files,',
        'stray `console.log` calls, and new `TODO`/`FIXME` markers.',
        '',
        'To tune the rules, edit [`dangerfile.ts`](../blob/HEAD/dangerfile.ts).',
        '</details>',
      ].join('\n'),
    );
  });
