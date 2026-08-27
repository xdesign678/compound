import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const publicDir = path.join(process.cwd(), 'public');

test('public/ does not ship internal audit HTML reports', () => {
  const htmlFiles = readdirSync(publicDir).filter((name) => name.endsWith('.html'));
  assert.deepEqual(htmlFiles, [], 'internal audit HTML must live outside public/');
  assert.equal(existsSync(path.join(publicDir, 'reports')), false);
});

test('legacy workbox and swe-worker assets remain until client compatibility is proven', () => {
  assert.equal(existsSync(path.join(publicDir, 'workbox-7144475a.js')), true);
  assert.equal(existsSync(path.join(publicDir, 'swe-worker-development.js')), true);
  assert.equal(existsSync(path.join(publicDir, 'sw.js')), true);
});
