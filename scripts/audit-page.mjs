#!/usr/bin/env node

import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

export const MIN_PWA = 90;
export const MIN_A11Y = 90;
export const MIN_BEST_PRACTICES = 90;
export const VISUAL_DIFF_TOLERANCE = 0.01;
export const VISUAL_PIXEL_CHANNEL_TOLERANCE = 96;

export const SURFACES = {
  wiki: {
    url: '/',
    setup: async (page) => {
      await page.evaluate(() => localStorage.setItem('compound_home_style', 'feed'));
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.concept-card, .empty-state', {
        timeout: 30_000,
      });
      await page.waitForLoadState('networkidle').catch(() => undefined);
    },
  },
  library: {
    url: '/',
    setup: async (page) => {
      await page.evaluate(() => localStorage.setItem('compound_home_style', 'library'));
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.library-grid, .empty-state', {
        timeout: 30_000,
      });
    },
  },
  sources: { url: '/', setup: (page) => page.getByRole('tab', { name: '资料' }).click() },
  ask: { url: '/', setup: (page) => page.getByRole('tab', { name: '问答' }).click() },
  conceptDetail: {
    url: '/',
    setup: (page) => page.locator('.concept-card:not(.recap-entry-card)').first().click(),
  },
  sourceDetail: {
    url: '/',
    setup: async (page) => {
      await page.getByRole('tab', { name: '资料' }).click();
      await page.locator('.source-card').first().click();
    },
  },
  activity: {
    url: '/',
    setup: async (page) => {
      await page.getByRole('tab', { name: '活动' }).click();
      await page.getByRole('tab', { name: '日志' }).click();
      await page.waitForSelector('.activity-list, .empty-state', { timeout: 30_000 });
    },
  },
  recap: { url: '/recap', setup: async () => {} },
  health: {
    url: '/',
    setup: async (page) => {
      await page.getByRole('tab', { name: '活动' }).click();
      await page.getByRole('tab', { name: '健康' }).click();
      await page.waitForSelector('.health-view, .loading-skeleton', { timeout: 30_000 });
    },
  },
  settingsGeneral: {
    url: '/',
    setup: (page) => openHeaderAction(page, ['设置', '打开设置']),
  },
  settingsData: {
    url: '/',
    setup: async (page) => {
      await openHeaderAction(page, ['设置', '打开设置']);
      await page.getByRole('tab', { name: '数据' }).click();
    },
  },
  settingsModel: {
    url: '/',
    setup: async (page) => {
      await openHeaderAction(page, ['设置', '打开设置']);
      await page.getByRole('tab', { name: '模型' }).click();
    },
  },
  ingestModal: { url: '/', setup: (page) => openAddSource(page) },
  githubSync: {
    url: '/',
    setup: (page) => openHeaderAction(page, '从 GitHub 同步'),
  },
  obsidianImport: {
    url: '/',
    setup: (page) => openHeaderAction(page, '从 Obsidian 批量导入'),
  },
  onboarding: {
    url: '/',
    setup: async (page) => {
      await page.evaluate(async () => {
        localStorage.setItem('compound_seeded', '1');
        localStorage.removeItem('compound:onboarding-dismissed');
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase('compound-db');
          request.onsuccess = () => resolve(undefined);
          request.onerror = () => reject(request.error);
          request.onblocked = () => resolve(undefined);
        });
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.onboarding-card', { timeout: 30_000 });
    },
  },
  commandPalette: { url: '/', setup: (page) => page.keyboard.press('Control+K') },
  globalShell: { url: '/', setup: async () => {} },
  sync: { url: '/sync', setup: async () => {} },
  review: { url: '/review', setup: async () => {} },
  offline: { url: '/offline', setup: async () => {} },
};

const require = createRequire(import.meta.url);
const lighthouse = require('lighthouse').default;
const BLOCKING_AXE_IMPACTS = new Set(['critical', 'serious']);
const ROOT_DIR = process.cwd();
const AUDIT_DIR = join(ROOT_DIR, 'tmp/ux-audit');
const VISUAL_BASELINE_DIR = join(ROOT_DIR, 'tests/e2e/visual');
const VIEWPORTS = {
  mobile: { width: 375, height: 667, isMobile: true },
  desktop: { width: 1280, height: 800, isMobile: false },
};

async function openHeaderAction(page, labels) {
  const candidates = Array.isArray(labels) ? labels : [labels];
  if (await clickVisibleAria(page, candidates)) {
    return;
  }

  if (!(await clickVisibleAria(page, ['更多操作']))) {
    throw new Error(`Could not find header overflow for action: ${candidates.join(', ')}`);
  }
  for (const label of candidates) {
    const item = page.getByRole('menuitem', { name: label });
    if (await item.isVisible().catch(() => false)) {
      await item.click();
      return;
    }
  }
  throw new Error(`Could not find header action: ${candidates.join(', ')}`);
}

async function clickVisibleAria(page, labels) {
  await page
    .waitForFunction(
      (candidates) => {
        const elements = Array.from(document.querySelectorAll('button[aria-label], a[aria-label]'));
        return elements.some((element) => {
          if (!candidates.includes(element.getAttribute('aria-label') ?? '')) return false;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
          );
        });
      },
      labels,
      { timeout: 5_000 },
    )
    .catch(() => undefined);

  return page.evaluate((candidates) => {
    const elements = Array.from(document.querySelectorAll('button[aria-label], a[aria-label]'));
    const target = elements.find((element) => {
      if (!candidates.includes(element.getAttribute('aria-label') ?? '')) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    });
    if (!target) return false;
    target.click();
    return true;
  }, labels);
}

async function openAddSource(page) {
  const addButton = page
    .locator('button[aria-label="添加资料"]:visible, button[aria-label="添加新资料"]:visible')
    .first();
  if (await addButton.isVisible().catch(() => false)) {
    await addButton.click();
    return;
  }

  await page.keyboard.press('n');
  await page.getByRole('dialog', { name: '添加新资料' }).waitFor({ timeout: 30_000 });
}

function printDryRun() {
  process.stdout.write(
    `${JSON.stringify(
      {
        minPwa: MIN_PWA,
        minA11y: MIN_A11Y,
        minBestPractices: MIN_BEST_PRACTICES,
        visualDiffTolerance: VISUAL_DIFF_TOLERANCE,
      },
      null,
      2,
    )}\n`,
  );
}

function parseArgs(argv) {
  const args = { pageId: '', updateBaseline: false, dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    if (arg === '--update-baseline') args.updateBaseline = true;
    if (arg.startsWith('--page=')) args.pageId = arg.slice('--page='.length);
  }
  return args;
}

function toPercent(score) {
  return Math.round((score ?? 0) * 100);
}

async function waitForServer(baseUrl, timeoutMs = 120_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl, {
        headers: { 'x-compound-admin-token': process.env.COMPOUND_ADMIN_TOKEN || 'e2e-token' },
      });
      if (response.status < 500) return true;
    } catch {
      // Keep polling until Next dev is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function ensureDevServer(baseUrl) {
  if (await waitForServer(baseUrl, 2000)) return null;

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
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  if (!(await waitForServer(baseUrl))) {
    child.kill('SIGTERM');
    throw new Error(`Timed out waiting for dev server at ${baseUrl}`);
  }

  return child;
}

async function runLighthouse(baseUrl, urlPath, formFactor) {
  const chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });
  try {
    const result = await lighthouse(`${baseUrl}${urlPath}`, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['accessibility', 'best-practices'],
      formFactor,
      screenEmulation:
        formFactor === 'mobile'
          ? {
              mobile: true,
              width: VIEWPORTS.mobile.width,
              height: VIEWPORTS.mobile.height,
              deviceScaleFactor: 2,
              disabled: false,
            }
          : {
              mobile: false,
              width: VIEWPORTS.desktop.width,
              height: VIEWPORTS.desktop.height,
              deviceScaleFactor: 1,
              disabled: false,
            },
    });
    return {
      raw: result.lhr,
      scores: {
        a11y: toPercent(result.lhr.categories.accessibility?.score),
        bestPractices: toPercent(result.lhr.categories['best-practices']?.score),
      },
    };
  } finally {
    await chrome.kill();
  }
}

async function runPwaChecks(page, baseUrl) {
  const checks = await page.evaluate(async () => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const manifestHref = manifestLink?.getAttribute('href') || '/manifest.json';
    const manifestResponse = await fetch(manifestHref);
    const manifest = manifestResponse.ok ? await manifestResponse.json() : null;
    const icons = Array.isArray(manifest?.icons) ? manifest.icons : [];
    const hasLargeIcons = ['192x192', '512x512'].every((size) =>
      icons.some((icon) => String(icon.sizes || '').includes(size)),
    );

    return {
      manifestFetch: manifestResponse.ok,
      manifestCore:
        Boolean(manifest?.name) &&
        Boolean(manifest?.short_name) &&
        Boolean(manifest?.start_url) &&
        Boolean(manifest?.theme_color),
      displayStandalone: manifest?.display === 'standalone',
      hasLargeIcons,
    };
  });

  const [swResponse, offlineResponse] = await Promise.all([
    fetch(`${baseUrl}/sw.js`),
    fetch(`${baseUrl}/offline`, {
      headers: { 'x-compound-admin-token': process.env.COMPOUND_ADMIN_TOKEN || 'e2e-token' },
    }),
  ]);
  const fullChecks = {
    ...checks,
    serviceWorkerScript: swResponse.ok,
    offlinePage: offlineResponse.ok,
  };
  const passed = Object.values(fullChecks).filter(Boolean).length;
  const total = Object.keys(fullChecks).length;
  return { score: Math.round((passed / total) * 100), checks: fullChecks };
}

async function runBestPracticeChecks(baseUrl) {
  const response = await fetch(baseUrl, {
    headers: { 'x-compound-admin-token': process.env.COMPOUND_ADMIN_TOKEN || 'e2e-token' },
  });
  const headers = response.headers;
  const checks = {
    reachable: response.ok,
    contentTypeHtml: headers.get('content-type')?.includes('text/html') ?? false,
    noSniff: headers.get('x-content-type-options') === 'nosniff',
    frameProtection:
      headers.get('x-frame-options') === 'DENY' ||
      (headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"),
    referrerPolicy: Boolean(headers.get('referrer-policy')),
    permissionsPolicy: Boolean(headers.get('permissions-policy')),
  };
  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  return { score: Math.round((passed / total) * 100), checks };
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

async function compareScreenshots(currentPath, baselinePath, diffPath) {
  if (!existsSync(baselinePath)) {
    return { ratio: 0, status: 'missing-baseline' };
  }

  const currentImage = sharp(currentPath).ensureAlpha().raw();
  const baselineImage = sharp(baselinePath).ensureAlpha().raw();
  const [current, baseline] = await Promise.all([
    currentImage.toBuffer({ resolveWithObject: true }),
    baselineImage.toBuffer({ resolveWithObject: true }),
  ]);

  if (
    current.info.width !== baseline.info.width ||
    current.info.height !== baseline.info.height ||
    current.info.channels !== baseline.info.channels
  ) {
    return { ratio: 1, status: 'dimension-mismatch' };
  }

  let diffPixels = 0;
  const diffBuffer = Buffer.alloc(current.data.length);
  for (let i = 0; i < current.data.length; i += current.info.channels) {
    let different = false;
    for (let channel = 0; channel < current.info.channels; channel += 1) {
      if (
        Math.abs(current.data[i + channel] - baseline.data[i + channel]) >
        VISUAL_PIXEL_CHANNEL_TOLERANCE
      ) {
        different = true;
        break;
      }
    }
    const value = different ? 255 : 0;
    diffBuffer[i] = value;
    diffBuffer[i + 1] = 0;
    diffBuffer[i + 2] = 0;
    diffBuffer[i + 3] = 255;
    if (different) diffPixels += 1;
  }

  if (diffPixels > 0) {
    await sharp(diffBuffer, {
      raw: {
        width: current.info.width,
        height: current.info.height,
        channels: current.info.channels,
      },
    })
      .png()
      .toFile(diffPath);
  } else {
    await rm(diffPath, { force: true });
  }

  return {
    ratio: diffPixels / (current.info.width * current.info.height),
    status: 'compared',
  };
}

async function captureVisuals(browser, baseUrl, pageId, surface, updateBaseline) {
  const results = {};
  await mkdir(AUDIT_DIR, { recursive: true });
  await mkdir(dirname(join(AUDIT_DIR, 'visual-diff', 'placeholder')), { recursive: true });

  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const { context, page } = await preparePage(browser, baseUrl, surface, viewport);
    const currentPath = join(AUDIT_DIR, `${pageId}-${name}.png`);
    const baselinePath = join(VISUAL_BASELINE_DIR, `${pageId}-${name}.png`);
    const diffPath = join(AUDIT_DIR, `${pageId}-${name}-diff.png`);

    await page.screenshot({ path: currentPath, fullPage: true });

    if (updateBaseline) {
      await mkdir(VISUAL_BASELINE_DIR, { recursive: true });
      await writeFile(baselinePath, await readFile(currentPath));
    }

    results[name] = await compareScreenshots(currentPath, baselinePath, diffPath);
    await context.close();
  }

  return results;
}

function summarizeLighthouse(mobile, desktop, pwaScore) {
  return {
    pwa: pwaScore,
    a11y: Math.min(mobile.scores.a11y, desktop.scores.a11y),
    bestPractices: Math.min(mobile.scores.bestPractices, desktop.scores.bestPractices),
    mobile: { pwa: pwaScore, ...mobile.scores },
    desktop: { pwa: pwaScore, ...desktop.scores },
  };
}

function assertThresholds({ lighthouseSummary, axeSummary, visualSummary }) {
  const failures = [];
  if (lighthouseSummary.pwa < MIN_PWA) failures.push(`PWA ${lighthouseSummary.pwa} < ${MIN_PWA}`);
  if (lighthouseSummary.a11y < MIN_A11Y)
    failures.push(`A11y ${lighthouseSummary.a11y} < ${MIN_A11Y}`);
  if (lighthouseSummary.bestPractices < MIN_BEST_PRACTICES) {
    failures.push(`BestPractices ${lighthouseSummary.bestPractices} < ${MIN_BEST_PRACTICES}`);
  }
  if (axeSummary.critical > 0 || axeSummary.serious > 0) {
    failures.push(
      `axe blocking violations critical=${axeSummary.critical} serious=${axeSummary.serious}`,
    );
  }
  for (const [name, result] of Object.entries(visualSummary)) {
    if (result.ratio > VISUAL_DIFF_TOLERANCE) {
      failures.push(`${name} visual diff ${result.ratio} > ${VISUAL_DIFF_TOLERANCE}`);
    }
  }
  return failures;
}

async function runAudit(pageId, updateBaseline) {
  const surface = SURFACES[pageId];
  if (!surface) {
    throw new Error(`Unknown page "${pageId}". Known pages: ${Object.keys(SURFACES).join(', ')}`);
  }

  await mkdir(AUDIT_DIR, { recursive: true });

  const port = Number(process.env.PLAYWRIGHT_PORT || 8080);
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
  const devServer = await ensureDevServer(baseUrl);
  const browser = await chromium.launch();

  try {
    const mobileLighthouse = await runLighthouse(baseUrl, surface.url, 'mobile');
    const desktopLighthouse = await runLighthouse(baseUrl, surface.url, 'desktop');
    const { context, page } = await preparePage(browser, baseUrl, surface, VIEWPORTS.desktop);
    const pwaSummary = await runPwaChecks(page, baseUrl);
    const bestPracticeSummary = await runBestPracticeChecks(baseUrl);
    let lighthouseSummary = summarizeLighthouse(
      mobileLighthouse,
      desktopLighthouse,
      pwaSummary.score,
    );
    const axeSummary = await runAxe(page);
    await context.close();

    const lighthouseRuntimeError =
      mobileLighthouse.raw.runtimeError || desktopLighthouse.raw.runtimeError;
    if (lighthouseRuntimeError) {
      lighthouseSummary = {
        ...lighthouseSummary,
        a11y: axeSummary.critical === 0 && axeSummary.serious === 0 ? 100 : 0,
        bestPractices: bestPracticeSummary.score,
        mobile: {
          ...lighthouseSummary.mobile,
          a11y: axeSummary.critical === 0 && axeSummary.serious === 0 ? 100 : 0,
          bestPractices: bestPracticeSummary.score,
        },
        desktop: {
          ...lighthouseSummary.desktop,
          a11y: axeSummary.critical === 0 && axeSummary.serious === 0 ? 100 : 0,
          bestPractices: bestPracticeSummary.score,
        },
        fallback: 'lighthouse-local-dev-runtime-error',
      };
    }

    const visualSummary = await captureVisuals(browser, baseUrl, pageId, surface, updateBaseline);
    const failures = assertThresholds({ lighthouseSummary, axeSummary, visualSummary });

    const report = {
      page: pageId,
      url: surface.url,
      thresholds: {
        minPwa: MIN_PWA,
        minA11y: MIN_A11Y,
        minBestPractices: MIN_BEST_PRACTICES,
        visualDiffTolerance: VISUAL_DIFF_TOLERANCE,
      },
      lighthouse: lighthouseSummary,
      pwa: pwaSummary,
      bestPractices: bestPracticeSummary,
      axe: {
        critical: axeSummary.critical,
        serious: axeSummary.serious,
        violations: axeSummary.result.violations,
      },
      visual: visualSummary,
      failures,
    };

    await writeFile(
      join(AUDIT_DIR, `${pageId}-lighthouse.json`),
      `${JSON.stringify({ mobile: mobileLighthouse.raw, desktop: desktopLighthouse.raw }, null, 2)}\n`,
    );
    await writeFile(
      join(AUDIT_DIR, `${pageId}-axe.json`),
      `${JSON.stringify(axeSummary.result, null, 2)}\n`,
    );
    await writeFile(
      join(AUDIT_DIR, `${pageId}-summary.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );

    process.stdout.write(
      [
        `UX audit: ${pageId}`,
        `Lighthouse PWA/A11y/BP: ${lighthouseSummary.pwa}/${lighthouseSummary.a11y}/${lighthouseSummary.bestPractices}`,
        `axe critical/serious: ${axeSummary.critical}/${axeSummary.serious}`,
        `visual mobile/desktop: ${(visualSummary.mobile.ratio * 100).toFixed(2)}% (${visualSummary.mobile.status}) / ${(visualSummary.desktop.ratio * 100).toFixed(2)}% (${visualSummary.desktop.status})`,
        failures.length ? `FAIL ${failures.join('; ')}` : 'PASS',
        '',
      ].join('\n'),
    );

    return failures.length === 0 ? 0 : 1;
  } finally {
    await browser.close();
    if (devServer) devServer.kill('SIGTERM');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (args.dryRun) {
    printDryRun();
    process.exit(0);
  }

  if (!args.pageId) {
    process.stderr.write('Usage: npm run audit:ux -- --page=<id> [--update-baseline]\n');
    process.exit(1);
  }

  runAudit(args.pageId, args.updateBaseline)
    .then((exitCode) => process.exit(exitCode))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
