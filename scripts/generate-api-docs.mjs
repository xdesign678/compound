#!/usr/bin/env node
/**
 * Automated API reference generator.
 *
 * Walks every `route.ts` under `app/api/**`, extracts the exported HTTP
 * method handlers, runtime hints, JSDoc/leading comments, and obvious
 * security guards (admin auth, rate limit, content-length), then renders
 * a Markdown reference at `docs/api-reference.md`.
 *
 * Modes:
 *   node scripts/generate-api-docs.mjs              # write the file
 *   node scripts/generate-api-docs.mjs --check      # exit 1 if drift vs. tracked file
 *
 * Designed to run locally, in pre-commit hooks, and in CI so that the API
 * surface is always documented next to the code that defines it.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const apiRoot = path.join(repoRoot, 'app', 'api');
const outDir = path.join(repoRoot, 'docs');
const outPath = path.join(outDir, 'api-reference.md');

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

/**
 * Recursively collect every `route.ts` (or `route.tsx`) under the given dir.
 * @param {string} dir
 * @returns {string[]}
 */
function findRouteFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
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
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile() && /^route\.tsx?$/.test(entry.name)) {
        out.push(next);
      }
    }
  }
  out.sort();
  return out;
}

/**
 * Convert an absolute file path to its public route path.
 * Examples:
 *   app/api/health/route.ts                        -> /api/health
 *   app/api/review/queue/[id]/route.ts             -> /api/review/queue/{id}
 *   app/api/sync/github/webhook/route.ts           -> /api/sync/github/webhook
 */
function fileToRoutePath(file) {
  const rel = path.relative(repoRoot, file).split(path.sep).join('/');
  // Strip leading "app" and trailing "/route.ts(x)"
  let route = rel.replace(/^app/, '').replace(/\/route\.tsx?$/, '');
  // Convert dynamic segments [id] -> {id}, catch-all [...slug] -> {...slug}
  route = route.replace(/\[\.\.\.([^\]]+)\]/g, '{...$1}').replace(/\[([^\]]+)\]/g, '{$1}');
  return route || '/';
}

/**
 * Extract the leading file-level comment (JSDoc or single-line block) if any.
 * Used as the route's high-level description.
 */
function extractFileDescription(source) {
  const stripped = source.replace(/^\uFEFF/, '');
  const match = stripped.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!match) return null;
  return cleanJsdocBlock(match[1]);
}

/**
 * Extract the JSDoc / block comment immediately preceding a given offset.
 */
function extractLeadingComment(source, offset) {
  // Walk backwards skipping whitespace
  let i = offset - 1;
  while (i >= 0 && /\s/.test(source[i])) i -= 1;
  if (i < 1 || source[i] !== '/' || source[i - 1] !== '*') return null;
  // Find matching /*
  const end = i + 1;
  const start = source.lastIndexOf('/*', i);
  if (start === -1) return null;
  const inner = source.slice(start + 2, end - 2);
  return cleanJsdocBlock(inner);
}

function cleanJsdocBlock(inner) {
  const lines = inner
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').replace(/\s+$/, ''))
    .filter(
      (_, idx, arr) =>
        !(idx === 0 && arr[idx] === '') && !(idx === arr.length - 1 && arr[idx] === ''),
    );
  const text = lines.join('\n').trim();
  return text || null;
}

/**
 * Find every exported HTTP method handler in the file and return
 * { method, offset, leadingComment }.
 */
function findHandlers(source) {
  const out = [];
  const seen = new Set();
  for (const method of HTTP_METHODS) {
    // export async function GET(  | export function POST(  | export const PUT = ...
    const patterns = [
      new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\(`, 'g'),
      new RegExp(`export\\s+function\\s+${method}\\s*\\(`, 'g'),
      new RegExp(`export\\s+const\\s+${method}\\s*[:=]`, 'g'),
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(source)) !== null) {
        if (seen.has(method)) continue;
        seen.add(method);
        out.push({
          method,
          offset: m.index,
          leadingComment: extractLeadingComment(source, m.index),
        });
        break;
      }
    }
  }
  out.sort((a, b) => HTTP_METHODS.indexOf(a.method) - HTTP_METHODS.indexOf(b.method));
  return out;
}

function findExportedConstant(source, name) {
  const re = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*([^;\\n]+)`);
  const m = source.match(re);
  if (!m) return null;
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}

function detectGuards(source) {
  return {
    requiresAdmin: /\brequireAdmin\s*\(/.test(source),
    rateLimited: /\b(?:llmRateLimit|rateLimit)\s*\(/.test(source),
    contentLengthGuarded: /\benforceContentLength\s*\(/.test(source),
    webhookSigned: /x-hub-signature-256/i.test(source),
    cronTokenGuarded: /CRON_SECRET/.test(source),
  };
}

function describeGuards(guards) {
  const tags = [];
  if (guards.requiresAdmin) tags.push('admin-token');
  if (guards.webhookSigned) tags.push('webhook-signature');
  if (guards.cronTokenGuarded) tags.push('cron-token');
  if (guards.rateLimited) tags.push('rate-limited');
  if (guards.contentLengthGuarded) tags.push('content-length-guarded');
  return tags;
}

function relPath(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function buildRouteEntry(file) {
  const source = readFileSync(file, 'utf8');
  const routePath = fileToRoutePath(file);
  const description = extractFileDescription(source);
  const handlers = findHandlers(source);
  const runtime = findExportedConstant(source, 'runtime');
  const maxDurationRaw = findExportedConstant(source, 'maxDuration');
  const maxDuration = maxDurationRaw != null ? Number(maxDurationRaw) : null;
  const guards = detectGuards(source);
  return {
    file: relPath(file),
    route: routePath,
    description,
    handlers,
    runtime,
    maxDuration: Number.isFinite(maxDuration) ? maxDuration : maxDurationRaw,
    guards,
  };
}

function groupByPrefix(entries) {
  const groups = new Map();
  for (const entry of entries) {
    // First segment after /api: /api/sync/... -> "sync", /api/health -> "health"
    const parts = entry.route.replace(/^\/+/, '').split('/');
    const group = parts[1] || parts[0] || 'misc';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function anchorFor(route) {
  return route
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/[/]/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderMarkdown(entries) {
  const totalRoutes = entries.length;
  const totalHandlers = entries.reduce((acc, e) => acc + e.handlers.length, 0);
  const groups = groupByPrefix(entries);

  const lines = [];
  lines.push('<!-- AUTO-GENERATED FILE — DO NOT EDIT BY HAND.');
  lines.push('     Run `npm run docs:api` (scripts/generate-api-docs.mjs) to regenerate.');
  lines.push('     Source of truth: app/api/**/route.ts -->');
  lines.push('');
  lines.push('# Compound HTTP API reference');
  lines.push('');
  lines.push(
    'This document is generated automatically from the Next.js Route Handlers under `app/api/**/route.ts`. ' +
      'It enumerates every public HTTP endpoint, the methods it implements, runtime hints, and obvious ' +
      'security guards (admin token, rate limit, payload size, webhook signatures).',
  );
  lines.push('');
  lines.push(`- Routes: **${totalRoutes}**`);
  lines.push(`- Handlers (HTTP methods): **${totalHandlers}**`);
  lines.push(`- Generator: \`scripts/generate-api-docs.mjs\``);
  lines.push('');
  lines.push('## Table of contents');
  lines.push('');
  for (const [group, items] of groups) {
    lines.push(`- **${group}**`);
    for (const e of items) {
      lines.push(`  - [\`${e.route}\`](#${anchorFor(e.route)})`);
    }
  }
  lines.push('');

  for (const [group, items] of groups) {
    lines.push(`## ${group}`);
    lines.push('');
    for (const e of items) {
      lines.push(`### \`${e.route}\``);
      lines.push('');
      lines.push(`Source: [\`${e.file}\`](../${e.file})`);
      lines.push('');
      const methodList =
        e.handlers.length > 0
          ? e.handlers.map((h) => `\`${h.method}\``).join(', ')
          : '_(no exported HTTP handler detected)_';
      const runtime = e.runtime ?? '_default_';
      const maxDuration = e.maxDuration != null ? `${e.maxDuration}` : '_unset_';
      const guardTags = describeGuards(e.guards);
      const guardLine =
        guardTags.length > 0 ? guardTags.map((t) => `\`${t}\``).join(', ') : '_(none detected)_';

      lines.push('| Field | Value |');
      lines.push('| --- | --- |');
      lines.push(`| Methods | ${methodList} |`);
      lines.push(`| Runtime | \`${runtime}\` |`);
      lines.push(`| maxDuration | ${maxDuration} |`);
      lines.push(`| Guards | ${guardLine} |`);
      lines.push('');

      if (e.description) {
        lines.push(e.description);
        lines.push('');
      }

      for (const h of e.handlers) {
        lines.push(`#### ${h.method}`);
        lines.push('');
        if (h.leadingComment) {
          lines.push(h.leadingComment);
        } else {
          lines.push(
            `_No JSDoc comment found above the \`${h.method}\` handler. Add a leading \`/** ... */\` block ` +
              `in \`${e.file}\` to document this endpoint._`,
          );
        }
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(
    '_This file is regenerated on every CI run. If it is ever out of sync with the route handlers, the ' +
      '`docs:api:check` step will fail and surface the drift._',
  );
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has('--check') || args.has('-c');

  const files = findRouteFiles(apiRoot);
  if (files.length === 0) {
    console.error(`[generate-api-docs] No route handlers found under ${relPath(apiRoot)}`);
    process.exit(1);
  }

  const entries = files.map(buildRouteEntry);
  const rendered = await prettier.format(renderMarkdown(entries), { parser: 'markdown' });

  if (checkOnly) {
    if (!existsSync(outPath)) {
      console.error(
        `[generate-api-docs] ${relPath(outPath)} does not exist. Run \`npm run docs:api\` and commit the file.`,
      );
      process.exit(1);
    }
    const existing = readFileSync(outPath, 'utf8');
    if (existing !== rendered) {
      console.error(
        `[generate-api-docs] ${relPath(outPath)} is stale. Run \`npm run docs:api\` and commit the regenerated file.`,
      );
      // Print a tiny diff hint: count differing lines.
      const a = existing.split('\n');
      const b = rendered.split('\n');
      const max = Math.max(a.length, b.length);
      let diffs = 0;
      for (let i = 0; i < max; i += 1) if (a[i] !== b[i]) diffs += 1;
      console.error(`[generate-api-docs] approximate line drift: ${diffs}`);
      process.exit(1);
    }
    console.log(
      `[generate-api-docs] ${relPath(outPath)} is up to date (${entries.length} routes).`,
    );
    return;
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, rendered, 'utf8');
  console.log(
    `[generate-api-docs] Wrote ${relPath(outPath)} (${entries.length} routes, ${entries.reduce(
      (acc, e) => acc + e.handlers.length,
      0,
    )} handlers).`,
  );
}

main().catch((err) => {
  console.error(`[generate-api-docs] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
