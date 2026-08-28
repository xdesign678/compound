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

test('tracked docs/internal-audits does not ship internal HTML or screenshots', () => {
  const auditDir = path.join(process.cwd(), 'docs/internal-audits');
  if (!existsSync(auditDir)) return;
  const collected: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) visit(full);
      else collected.push(name.name);
    }
  };
  visit(auditDir);
  assert.equal(
    collected.filter((name) => name.endsWith('.html') || name.endsWith('.png')).length,
    0,
    'internal audit HTML/screenshots must live in ignored .swarm archives',
  );
});

test('legacy workbox and swe-worker assets remain until client compatibility is proven', () => {
  assert.equal(existsSync(path.join(publicDir, 'workbox-7144475a.js')), true);
  assert.equal(existsSync(path.join(publicDir, 'swe-worker-development.js')), true);
  assert.equal(existsSync(path.join(publicDir, 'sw.js')), true);
});
