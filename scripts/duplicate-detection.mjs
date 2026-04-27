/**
 * Duplicate code detection script using Rabin-Karp fingerprinting.
 *
 * Scans source directories for copy-pasted code blocks (minimum 6 tokens,
 * ~5 lines) and reports duplicates with a configurable threshold.
 * Designed to integrate with the existing quality-metrics CI pipeline.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourceRoots = ['app', 'components', 'lib', 'scripts'];
const outDir = path.join(root, 'tmp');
const jsonPath = path.join(outDir, 'duplicate-report.json');
const markdownPath = path.join(outDir, 'duplicate-report.md');

const MIN_TOKENS = Number(process.env.DUP_MIN_TOKENS ?? 50);
const MIN_LINES = Number(process.env.DUP_MIN_LINES ?? 6);
const MAX_THRESHOLD = Number(process.env.DUP_MAX_THRESHOLD ?? 5);

// ── Tokenization ──────────────────────────────────────────────────────────

function tokenize(code, filePath) {
  const lines = code.split('\n');
  const tokens = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }
    // Normalize: collapse whitespace, remove string contents, normalize identifiers
    const normalized = trimmed
      .replace(/"[^"]*"/g, '"STR"')
      .replace(/'[^']*'/g, "'STR'")
      .replace(/`[^`]*`/g, '`STR`')
      .replace(/\b[a-zA-Z_]\w*\b/g, 'ID');
    const parts = normalized.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      tokens.push({ value: part, line: i + 1, file: filePath });
    }
  }

  return tokens;
}

// ── Rabin-Karp fingerprinting ─────────────────────────────────────────────

const BASE = 257;
const MOD = 1_000_000_007;

function computeHash(tokens, start, length) {
  let h = 0;
  for (let i = 0; i < length; i++) {
    h = (h * BASE + tokens[start + i].value.charCodeAt(0)) % MOD;
  }
  return h;
}

function computeRollingHash(prevHash, oldChar, newChar, basePow) {
  let h = (prevHash - (oldChar * basePow) % MOD + MOD) % MOD;
  h = (h * BASE + newChar) % MOD;
  return h;
}

function findDuplicates(allTokens) {
  const windowSize = MIN_TOKENS;
  const seen = new Map(); // hash -> [{ file, line, tokens }]
  const duplicates = [];

  // Group tokens by file for windowed scanning
  const fileTokens = new Map();
  for (const token of allTokens) {
    if (!fileTokens.has(token.file)) fileTokens.set(token.file, []);
    fileTokens.get(token.file).push(token);
  }

  // Pre-compute base^windowSize
  let basePow = 1;
  for (let i = 0; i < windowSize - 1; i++) {
    basePow = (basePow * BASE) % MOD;
  }

  for (const [file, tokens] of fileTokens) {
    if (tokens.length < windowSize) continue;

    let hash = computeHash(tokens, 0, windowSize);
    for (let i = 0; i <= tokens.length - windowSize; i++) {
      if (i > 0) {
        hash = computeRollingHash(
          hash,
          tokens[i - 1].value.charCodeAt(0),
          tokens[i + windowSize - 1].value.charCodeAt(0),
          basePow,
        );
      }

      // Secondary hash to reduce collisions
      const key = `${hash}:${tokens[i].value}:${tokens[i + windowSize - 1].value}`;

      if (seen.has(key)) {
        const existing = seen.get(key);
        // Check it's not from the same file or overlapping region
        const isDifferentFile = existing.every(
          (e) => e.file !== file || Math.abs(e.line - tokens[i].line) > windowSize,
        );
        if (isDifferentFile) {
          // Verify the match to avoid hash collisions
          const ref = existing[0];
          const refTokens = fileTokens.get(ref.file);
          const refStart = refTokens.indexOf(ref);
          if (refStart >= 0) {
            let match = true;
            for (let j = 0; j < windowSize && match; j++) {
              if (refTokens[refStart + j].value !== tokens[i + j].value) match = false;
            }
            if (match) {
              duplicates.push({
                firstFile: ref.file,
                firstLine: ref.line,
                secondFile: file,
                secondLine: tokens[i].line,
                tokens: windowSize,
                lines: tokens[i + windowSize - 1].line - tokens[i].line + 1,
              });
              continue; // don't add this as a new reference
            }
          }
        }
      }

      // Add as a new reference
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push({ file, line: tokens[i].line });
    }
  }

  // Deduplicate overlapping matches (keep highest-token match per file pair)
  return deduplicateOverlaps(duplicates);
}

function deduplicateOverlaps(duplicates) {
  // Sort by tokens descending, then by lines descending
  duplicates.sort((a, b) => b.tokens - a.tokens || b.lines - a.lines);

  const used = new Set();
  const result = [];

  for (const dup of duplicates) {
    const key1 = `${dup.firstFile}:${dup.firstLine}:${dup.firstLine + dup.lines}`;
    const key2 = `${dup.secondFile}:${dup.secondLine}:${dup.secondLine + dup.lines}`;

    // Skip if either region overlaps with an already-reported region
    let overlaps = false;
    for (const usedKey of used) {
      const [f, s, e] = usedKey.split(':').map(Number);
      const usedStr = `${f}`;
      if (
        (usedStr === `${dup.firstFile}` && rangesOverlap(s, e, dup.firstLine, dup.firstLine + dup.lines)) ||
        (usedStr === `${dup.secondFile}` && rangesOverlap(s, e, dup.secondLine, dup.secondLine + dup.lines))
      ) {
        overlaps = true;
        break;
      }
    }

    if (!overlaps) {
      result.push(dup);
      used.add(`${dup.firstFile}:${dup.firstLine}:${dup.firstLine + dup.lines}`);
      used.add(`${dup.secondFile}:${dup.secondLine}:${dup.secondLine + dup.lines}`);
    }
  }

  return result;
}

function rangesOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

// ── File walking ──────────────────────────────────────────────────────────

function walk(dir) {
  if (!exists(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (['node_modules', '.next', 'tmp', 'coverage', '.git', '.claude'].includes(entry)) return [];
      return walk(fullPath);
    }
    if (!/\.(mjs|js|ts|tsx)$/.test(entry)) return [];
    if (/\.test\.(ts|tsx|js)$/.test(entry)) return [];
    if (/\.d\.ts$/.test(entry)) return [];
    return [fullPath];
  });
}

function exists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ── Reporting ─────────────────────────────────────────────────────────────

function renderMarkdown(report) {
  const rows = report.duplicates
    .slice(0, 30)
    .map(
      (d) =>
        `| ${d.firstFile}:${d.firstLine} | ${d.secondFile}:${d.secondLine} | ${d.lines} | ${d.tokens} |`,
    )
    .join('\n');

  return `# Duplicate Code Detection Report

| Metric | Value |
| --- | ---: |
| Files scanned | ${report.filesScanned} |
| Duplicate instances | ${report.duplicates.length} |
| Duplicated lines (total) | ${report.totalDuplicatedLines} |
| Duplicate % of codebase | ${report.duplicatePercentage}% |
| Threshold | <= ${report.threshold}% |

${
  report.duplicates.length === 0
    ? 'No significant duplicate code detected.'
    : `## Duplicates\n\n| Location A | Location B | Lines | Tokens |\n| --- | --- | ---: | ---: |\n${rows}`
}
`;
}

// ── Main ──────────────────────────────────────────────────────────────────

const files = sourceRoots.flatMap((dir) => walk(path.join(root, dir))).sort();
let allTokens = [];
let totalLines = 0;

for (const filePath of files) {
  const code = readFileSync(filePath, 'utf8');
  const relPath = path.relative(root, filePath);
  totalLines += code.split('\n').filter((l) => l.trim().length > 0).length;
  allTokens = allTokens.concat(tokenize(code, relPath));
}

const duplicates = findDuplicates(allTokens);
const totalDuplicatedLines = duplicates.reduce((sum, d) => sum + d.lines, 0);
const duplicatePercentage =
  totalLines === 0 ? 0 : Math.round((totalDuplicatedLines / totalLines) * 10000) / 100;

const report = {
  tool: 'compound duplicate detection',
  scope: sourceRoots,
  minTokens: MIN_TOKENS,
  minLines: MIN_LINES,
  threshold: MAX_THRESHOLD,
  filesScanned: files.length,
  totalSourceLines: totalLines,
  duplicates: duplicates,
  totalDuplicatedLines,
  duplicatePercentage,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(markdownPath, renderMarkdown(report));

if (duplicatePercentage > MAX_THRESHOLD) {
  console.error(
    `Duplicate code gate failed: ${duplicatePercentage}% duplicated code exceeds ${MAX_THRESHOLD}% threshold.`,
  );
  console.error(`Found ${duplicates.length} duplicate instances totaling ${totalDuplicatedLines} lines.`);
  process.exit(1);
}

console.log(
  `Duplicate detection passed: ${duplicates.length} instances, ${duplicatePercentage}% duplicated (threshold ${MAX_THRESHOLD}%).`,
);
