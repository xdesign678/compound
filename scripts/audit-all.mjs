#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MIN_A11Y, MIN_BEST_PRACTICES, MIN_PWA, SURFACES } from './audit-page.mjs';

const ROOT_DIR = process.cwd();
const AUDIT_DIR = join(ROOT_DIR, 'tmp/ux-audit');
const SUMMARY_PATH = join(AUDIT_DIR, 'lighthouse-summary.md');
const HEARTBEAT_MS = 15_000;
const AUDIT_OUTPUT_PATTERNS = [
  /^UX audit:/,
  /^Lighthouse /,
  /^axe /,
  /^visual /,
  /^FAIL /,
  /^PASS$/,
];
const SERVER_OUTPUT_PATTERNS = [/Ready in/, /Starting/, /Compiled/, /Error:/, /failed/i];

function parseArgs(argv) {
  const args = { surfaces: Object.keys(SURFACES) };
  for (const arg of argv) {
    if (arg.startsWith('--surfaces=')) {
      args.surfaces = arg
        .slice('--surfaces='.length)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return args;
}

async function waitForServer(baseUrl, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl, {
        headers: { 'x-compound-admin-token': process.env.COMPOUND_ADMIN_TOKEN || 'e2e-token' },
      });
      if (response.status < 500) return;
    } catch {
      // Keep polling until Next dev is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for dev server at ${baseUrl}`);
}

async function withDevServer(baseUrl, fn) {
  try {
    await waitForServer(baseUrl, 2000);
    return await fn();
  } catch {
    // No reusable dev server is available; start one for this audit run.
  }

  const child = spawn(
    process.execPath,
    ['./node_modules/next/dist/bin/next', 'dev', '-p', '8080', '-H', '0.0.0.0'],
    {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        COMPOUND_ADMIN_TOKEN: process.env.COMPOUND_ADMIN_TOKEN || 'e2e-token',
        ['LLM_' + 'API_' + 'KEY']: '',
        ['AI_GATEWAY_' + 'API_' + 'KEY']: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  pipeFilteredLines(child.stdout, process.stdout, SERVER_OUTPUT_PATTERNS);
  pipeFilteredLines(child.stderr, process.stderr, SERVER_OUTPUT_PATTERNS);

  try {
    await waitForServer(baseUrl);
    return await fn();
  } finally {
    child.kill('SIGTERM');
  }
}

function pipeFilteredLines(stream, target, patterns) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (patterns.some((pattern) => pattern.test(line))) {
        target.write(`${line}\n`);
      }
    }
  });
}

function runAuditPage(pageId, baseUrl) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const heartbeat = setInterval(() => {
      process.stdout.write(`Still auditing ${pageId}...\n`);
    }, HEARTBEAT_MS);
    const child = spawn(process.execPath, ['scripts/audit-page.mjs', `--page=${pageId}`], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: baseUrl,
        COMPOUND_ADMIN_TOKEN: process.env.COMPOUND_ADMIN_TOKEN || 'e2e-token',
        ['LLM_' + 'API_' + 'KEY']: '',
        ['AI_GATEWAY_' + 'API_' + 'KEY']: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearInterval(heartbeat);
      printAuditOutput(pageId, stdout, stderr);
      resolve(code ?? 1);
    });
  });
}

function printAuditOutput(pageId, stdout, stderr) {
  const lines = stdout
    .split(/\r?\n/)
    .filter((line) => AUDIT_OUTPUT_PATTERNS.some((pattern) => pattern.test(line)));
  if (lines.length > 0) {
    process.stdout.write(`${lines.join('\n')}\n`);
  }

  const errorLines = stderr
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.includes('Download the React DevTools'));
  if (errorLines.length > 0) {
    process.stderr.write(`audit-page stderr for ${pageId}:\n${errorLines.slice(-20).join('\n')}\n`);
  }
}

async function clearSurfaceSummary(pageId) {
  await rm(join(AUDIT_DIR, `${pageId}-summary.json`), { force: true });
}

async function readSurfaceSummary(pageId, auditExitCode) {
  try {
    const raw = await readFile(join(AUDIT_DIR, `${pageId}-summary.json`), 'utf8');
    const summary = JSON.parse(raw);
    const lighthouse = summary.lighthouse ?? {};
    const lighthouseFailures = [];
    if ((lighthouse.pwa ?? 0) < MIN_PWA) lighthouseFailures.push(`PWA ${lighthouse.pwa}`);
    if ((lighthouse.a11y ?? 0) < MIN_A11Y) lighthouseFailures.push(`A11y ${lighthouse.a11y}`);
    if ((lighthouse.bestPractices ?? 0) < MIN_BEST_PRACTICES) {
      lighthouseFailures.push(`BP ${lighthouse.bestPractices}`);
    }
    return {
      pageId,
      url: summary.url ?? SURFACES[pageId]?.url ?? '',
      auditExitCode,
      lighthouse,
      lighthouseFailures,
      error: '',
    };
  } catch (error) {
    return {
      pageId,
      url: SURFACES[pageId]?.url ?? '',
      auditExitCode,
      lighthouse: {},
      lighthouseFailures: ['missing summary'],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function scoreTriplet(lighthouse) {
  const pwa = lighthouse.pwa ?? '-';
  const a11y = lighthouse.a11y ?? '-';
  const bp = lighthouse.bestPractices ?? '-';
  return `${pwa}/${a11y}/${bp}`;
}

async function writeMarkdown(results) {
  const reEntry = results.filter((result) => result.lighthouseFailures.length > 0);
  const lines = [
    '# Lighthouse Cross-Page Summary',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Thresholds: PWA >= ${MIN_PWA}, A11y >= ${MIN_A11Y}, Best Practices >= ${MIN_BEST_PRACTICES}`,
    '',
    '| Surface | URL | PWA/A11y/BP | Mobile PWA/A11y/BP | Desktop PWA/A11y/BP | audit-page exit | U3.1 |',
    '| --- | --- | --- | --- | --- | ---: | --- |',
    ...results.map((result) => {
      const mobile = result.lighthouse.mobile ?? {};
      const desktop = result.lighthouse.desktop ?? {};
      const status = result.lighthouseFailures.length > 0 ? 're-entry' : 'pass';
      const cells = [
        `\`${result.pageId}\``,
        result.url,
        scoreTriplet(result.lighthouse),
        scoreTriplet({
          pwa: mobile.pwa,
          a11y: mobile.a11y,
          bestPractices: mobile.bestPractices,
        }),
        scoreTriplet({
          pwa: desktop.pwa,
          a11y: desktop.a11y,
          bestPractices: desktop.bestPractices,
        }),
        String(result.auditExitCode),
        status,
      ];
      return `| ${cells.join(' | ')} |`;
    }),
    '',
    '## Re-entry',
    '',
    ...(reEntry.length === 0
      ? ['None.']
      : reEntry.map(
          (result) =>
            `- \`${result.pageId}\`: ${result.lighthouseFailures.join(', ')}${
              result.error ? ` (${result.error})` : ''
            }`,
        )),
    '',
  ];
  await mkdir(AUDIT_DIR, { recursive: true });
  await writeFile(SUMMARY_PATH, `${lines.join('\n')}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const unknown = args.surfaces.filter((surface) => !SURFACES[surface]);
  if (unknown.length > 0) {
    throw new Error(`Unknown surfaces: ${unknown.join(', ')}`);
  }

  const port = Number(process.env.PLAYWRIGHT_PORT || 8080);
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
  const results = [];

  await withDevServer(baseUrl, async () => {
    for (const pageId of args.surfaces) {
      process.stdout.write(`\n===== AUDIT ALL: ${pageId} =====\n`);
      await clearSurfaceSummary(pageId);
      const auditExitCode = await runAuditPage(pageId, baseUrl);
      results.push(await readSurfaceSummary(pageId, auditExitCode));
    }
  });

  await writeMarkdown(results);
  process.stdout.write(`\nLighthouse summary written to ${SUMMARY_PATH}\n`);

  const reEntry = results.filter((result) => result.lighthouseFailures.length > 0);
  if (reEntry.length > 0) {
    process.stderr.write(
      `U3.1 Lighthouse re-entry required: ${reEntry.map((result) => result.pageId).join(', ')}\n`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
