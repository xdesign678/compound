import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const GUARDED_CLIENT_LIBS = [
  'lib/admin-auth-client.ts',
  'lib/api-client.ts',
  'lib/cloud-sync.ts',
  'lib/llm-config.ts',
] as const;

const NATIVE_FETCH_ALLOWLIST = new Set([
  'lib/auth-response-guard.ts',
  'lib/gateway.ts',
  'lib/github-sync.ts',
]);

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolute);
    if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.includes('.test.')) return [];
    return [absolute];
  });
}

function sourceWithoutComments(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function isClientModule(file: string): boolean {
  return /^\s*['"]use client['"];?/m.test(readFileSync(file, 'utf8'));
}

test('private client entrypoints cannot bypass the Compound API response guard', () => {
  const root = process.cwd();
  const files = [
    ...GUARDED_CLIENT_LIBS.map((file) => path.join(root, file)),
    ...collectSourceFiles(path.join(root, 'components')),
    ...collectSourceFiles(path.join(root, 'app')).filter(isClientModule),
  ];
  const bypasses = files
    .filter((file) => /\bfetch\s*\(/.test(sourceWithoutComments(file)))
    .map((file) => path.relative(root, file));

  assert.deepEqual(
    bypasses,
    [],
    'Use fetchCompoundPrivateApi for Compound /api/ calls; keep external fetches in explicit external-service helpers.',
  );
});

test('new library fetches require an explicit Compound guard or external-service boundary', () => {
  const root = process.cwd();
  const bypasses = collectSourceFiles(path.join(root, 'lib'))
    .map((file) => ({ file, relative: path.relative(root, file) }))
    .filter(({ relative }) => !NATIVE_FETCH_ALLOWLIST.has(relative))
    .filter(({ file }) => /\bfetch\s*\(/.test(sourceWithoutComments(file)))
    .map(({ relative }) => relative);

  assert.deepEqual(
    bypasses,
    [],
    'Use fetchCompoundPrivateApi for Compound /api/ calls; external fetch boundaries require explicit review.',
  );
});
