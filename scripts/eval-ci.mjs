#!/usr/bin/env node
/**
 * Deterministic CI eval sidecar — zero network, zero real models.
 *
 * Loads the de-identified fixture at eval/fixtures/ci-corpus.json, checks
 * citation resolvability, source/chunk/evidence connectivity, and the SSE
 * `done` contract. Hit@k / MRR / keyword recall are report-only.
 *
 * Direct:
 *   node scripts/eval-ci.mjs
 *   node scripts/eval-ci.mjs --corpus eval/fixtures/ci-corpus.json
 *   node scripts/eval-ci.mjs --json
 *
 * Main-thread wiring (do not add in this sidecar batch):
 *   package.json  "eval:ci": "node scripts/eval-ci.mjs"
 *   .github/workflows/ci.yml  run: npm run eval:ci
 *
 * Exit 0 = hard gates pass
 * Exit 1 = parse/run error or hard-gate failure
 */
import path from 'node:path';
import process from 'node:process';

import { formatReport, publicReport, runEvalCiFromFile } from '../eval/ci/harness.mjs';

const DEFAULT_CORPUS = 'eval/fixtures/ci-corpus.json';
const BLOCKED_BASENAMES = new Set(['golden-set.json']);

const args = parseArgs(process.argv.slice(2));
const corpusPath = path.resolve(process.cwd(), args.corpus || DEFAULT_CORPUS);

if (BLOCKED_BASENAMES.has(path.basename(corpusPath))) {
  process.stderr.write(
    '[eval:ci] refused: production-matching golden sets are out of scope for this runner\n',
  );
  process.exit(1);
}

const result = runEvalCiFromFile(corpusPath);
process.stdout.write(formatReport(result));
if (args.json) {
  process.stdout.write(`${JSON.stringify(publicReport(result), null, 2)}\n`);
}
process.exit(result.exitCode);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') {
      out.json = true;
      continue;
    }
    if (token === '--corpus' || token.startsWith('--corpus=')) {
      const value = token === '--corpus' ? argv[i + 1] : token.slice('--corpus='.length);
      if (!value) {
        process.stderr.write('[eval:ci] --corpus requires a path\n');
        process.exit(1);
      }
      if (token === '--corpus') i += 1;
      out.corpus = value;
      continue;
    }
    if (token === '--help' || token === '-h') {
      process.stdout.write(
        'Usage: node scripts/eval-ci.mjs [--corpus eval/fixtures/ci-corpus.json] [--json]\n',
      );
      process.exit(0);
    }
    process.stderr.write(`[eval:ci] unknown argument: ${token}\n`);
    process.exit(1);
  }
  return out;
}
