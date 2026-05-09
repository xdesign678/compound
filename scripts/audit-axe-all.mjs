#!/usr/bin/env node

import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SURFACES } from './audit-page.mjs';

const ROOT_DIR = process.cwd();
const AUDIT_DIR = join(ROOT_DIR, 'tmp/ux-audit');
const SUMMARY_PATH = join(AUDIT_DIR, 'axe-summary.md');
const JSON_SUMMARY_PATH = join(AUDIT_DIR, 'axe-summary.json');
const BLOCKING_AXE_IMPACTS = new Set(['critical', 'serious']);
const SERVER_OUTPUT_PATTERNS = [/Ready in/, /Starting/, /Compiled/, /Error:/, /failed/i];
const VIEWPORTS = {
  mobile: { width: 375, height: 667, isMobile: true },
  desktop: { width: 1280, height: 800, isMobile: false },
};

function parseArgs(argv) {
  const args = { surfaces: Object.keys(SURFACES), dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
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

function printDryRun(surfaces) {
  process.stdout.write(
    `${JSON.stringify(
      {
        surfaces,
        viewports: Object.keys(VIEWPORTS),
        axeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        blockingImpacts: Array.from(BLOCKING_AXE_IMPACTS),
      },
      null,
      2,
    )}\n`,
  );
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
  pipeFilteredLines(child.stdout, process.stdout);
  pipeFilteredLines(child.stderr, process.stderr);

  try {
    await waitForServer(baseUrl);
    return await fn();
  } finally {
    child.kill('SIGTERM');
  }
}

function pipeFilteredLines(stream, target) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (SERVER_OUTPUT_PATTERNS.some((pattern) => pattern.test(line))) {
        target.write(`${line}\n`);
      }
    }
  });
}

async function preparePage(browser, baseUrl, surface, viewport) {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    extraHTTPHeaders: {
      'x-compound-admin-token': process.env.COMPOUND_ADMIN_TOKEN || 'e2e-token',
    },
  });
  const page = await context.newPage();
  await page.goto(surface.url, { waitUntil: 'networkidle' });
  await surface.setup(page);
  await page
    .waitForSelector('.loading-skeleton', { state: 'detached', timeout: 30_000 })
    .catch(() => undefined);
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('16px "Inter"'),
      document.fonts.load('16px "Lora"'),
      document.fonts.load('16px "Noto Serif SC"', '知识库结构性缺陷'),
    ]);
    await document.fonts.ready;
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  return { context, page };
}

async function runAxe(page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = result.violations.filter((violation) =>
    BLOCKING_AXE_IMPACTS.has(violation.impact ?? ''),
  );
  return {
    result,
    critical: blocking.filter((violation) => violation.impact === 'critical').length,
    serious: blocking.filter((violation) => violation.impact === 'serious').length,
  };
}

async function auditSurface(browser, baseUrl, pageId, surface) {
  const viewports = {};
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    process.stdout.write(`axe ${pageId} ${viewportName}...\n`);
    let context;
    try {
      const prepared = await preparePage(browser, baseUrl, surface, viewport);
      context = prepared.context;
      const axe = await runAxe(prepared.page);
      viewports[viewportName] = {
        critical: axe.critical,
        serious: axe.serious,
        violations: axe.result.violations,
        error: '',
      };
      await writeFile(
        join(AUDIT_DIR, `${pageId}-axe-${viewportName}.json`),
        `${JSON.stringify(axe.result, null, 2)}\n`,
      );
    } catch (error) {
      viewports[viewportName] = {
        critical: 0,
        serious: 0,
        violations: [],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await context?.close();
    }
  }
  return { pageId, url: surface.url, viewports };
}

function countBlocking(result) {
  return Object.values(result.viewports).reduce(
    (total, viewport) => ({
      critical: total.critical + viewport.critical,
      serious: total.serious + viewport.serious,
      errors: total.errors + (viewport.error ? 1 : 0),
    }),
    { critical: 0, serious: 0, errors: 0 },
  );
}

function formatViewport(viewport) {
  if (viewport.error) return `error: ${viewport.error}`;
  return `${viewport.critical}/${viewport.serious}`;
}

async function writeSummaries(results) {
  const reEntry = results.filter((result) => {
    const totals = countBlocking(result);
    return totals.critical > 0 || totals.serious > 0 || totals.errors > 0;
  });
  const lines = [
    '# Axe Cross-Page Summary',
    '',
    `Generated: ${new Date().toISOString()}`,
    'Thresholds: critical = 0, serious = 0',
    'Tags: wcag2a, wcag2aa, wcag21a, wcag21aa',
    '',
    '| Surface | URL | Mobile critical/serious | Desktop critical/serious | U3.2 |',
    '| --- | --- | ---: | ---: | --- |',
    ...results.map((result) => {
      const totals = countBlocking(result);
      const status =
        totals.critical > 0 || totals.serious > 0 || totals.errors > 0 ? 're-entry' : 'pass';
      return `| \`${result.pageId}\` | ${result.url} | ${formatViewport(result.viewports.mobile)} | ${formatViewport(result.viewports.desktop)} | ${status} |`;
    }),
    '',
    '## Re-entry',
    '',
    ...(reEntry.length === 0
      ? ['None.']
      : reEntry.map((result) => {
          const totals = countBlocking(result);
          return `- \`${result.pageId}\`: critical ${totals.critical}, serious ${totals.serious}, setup errors ${totals.errors}`;
        })),
    '',
  ];

  await writeFile(SUMMARY_PATH, `${lines.join('\n')}\n`);
  await writeFile(
    JSON_SUMMARY_PATH,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const unknown = args.surfaces.filter((surface) => !SURFACES[surface]);
  if (unknown.length > 0) {
    throw new Error(`Unknown surfaces: ${unknown.join(', ')}`);
  }
  if (args.dryRun) {
    printDryRun(args.surfaces);
    return;
  }

  await mkdir(AUDIT_DIR, { recursive: true });
  const port = Number(process.env.PLAYWRIGHT_PORT || 8080);
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
  const results = [];

  await withDevServer(baseUrl, async () => {
    const browser = await chromium.launch();
    try {
      for (const pageId of args.surfaces) {
        results.push(await auditSurface(browser, baseUrl, pageId, SURFACES[pageId]));
      }
    } finally {
      await browser.close();
    }
  });

  await writeSummaries(results);
  process.stdout.write(`\nAxe summary written to ${SUMMARY_PATH}\n`);

  const reEntry = results.filter((result) => {
    const totals = countBlocking(result);
    return totals.critical > 0 || totals.serious > 0 || totals.errors > 0;
  });
  if (reEntry.length > 0) {
    process.stderr.write(
      `U3.2 axe re-entry required: ${reEntry.map((result) => result.pageId).join(', ')}\n`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
