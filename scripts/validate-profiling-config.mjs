#!/usr/bin/env node
/**
 * Keep the profiling entrypoints discoverable and usable for agents.
 *
 * This does not run a profiler; it verifies that package scripts, docs and
 * ignored output paths stay in sync so the profiling workflow does not rot.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const errors = [];
const packageJson = readJson(path.join(repoRoot, 'package.json'));
const packageLock = readJson(path.join(repoRoot, 'package-lock.json'));
const gitignore = readText(path.join(repoRoot, '.gitignore'));
const profilingDocPath = path.join(repoRoot, 'docs', 'profiling.md');
const profilingDoc = existsSync(profilingDocPath) ? readText(profilingDocPath) : '';

const scripts = packageJson.scripts ?? {};
const devDependencies = packageJson.devDependencies ?? {};
const rootLockDeps = packageLock.packages?.['']?.devDependencies ?? {};

expect(Boolean(devDependencies.clinic), 'package.json must include clinic in devDependencies.');
expect(Boolean(rootLockDeps.clinic), 'package-lock.json must lock the root clinic devDependency.');
expectScriptIncludes('profile:build', ['--cpu-prof', '--cpu-prof-dir=tmp/profiles/build']);
expectScriptIncludes('profile:server', ['clinic flame', 'next start', 'tmp/profiles/server']);
expectScriptIncludes('profile:heap:build', ['--heap-prof', '--heap-prof-dir=tmp/profiles/heap']);
expectScriptIncludes('validate:profiling', ['scripts/validate-profiling-config.mjs']);
expect(
  scripts.check?.includes('npm run validate:profiling'),
  'package.json check script must run validate:profiling.',
);
expect(gitignoreCovers(gitignore, 'tmp/profiles'), '.gitignore must ignore tmp/profiles/.');
expect(existsSync(profilingDocPath), 'docs/profiling.md must document profiling workflows.');
for (const command of [
  'npm run profile:build',
  'npm run profile:server',
  'npm run profile:heap:build',
]) {
  expect(profilingDoc.includes(command), `docs/profiling.md must mention \`${command}\`.`);
}
expect(
  /Clinic\.js|clinic/i.test(profilingDoc) && /heap profile|heap-prof/i.test(profilingDoc),
  'docs/profiling.md must explain both Clinic.js flame graphs and heap profiles.',
);

if (errors.length > 0) {
  console.error('Profiling configuration validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Profiling configuration is complete.');

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch (err) {
    errors.push(`${path.relative(repoRoot, file)} is not valid JSON: ${err.message}`);
    return {};
  }
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    errors.push(`Failed to read ${path.relative(repoRoot, file)}: ${err.message}`);
    return '';
  }
}

function expect(condition, message) {
  if (!condition) errors.push(message);
}

function expectScriptIncludes(name, parts) {
  const script = scripts[name];
  expect(Boolean(script), `package.json must define "${name}".`);
  if (!script) return;
  for (const part of parts) {
    expect(script.includes(part), `package.json "${name}" must include "${part}".`);
  }
}

function gitignoreCovers(gitignoreText, candidate) {
  const normalized = candidate.replace(/^\/+/, '').replace(/\/+$/, '');
  for (const rawLine of gitignoreText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const pattern = line.replace(/^\/+/, '').replace(/\/+$/, '');
    if (pattern === normalized) return true;
    if (normalized.startsWith(`${pattern}/`)) return true;
  }
  return false;
}
