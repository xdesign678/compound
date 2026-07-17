import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

test('UX audit thresholds are exposed by the audit-page scaffold', () => {
  const output = execFileSync(
    'node',
    [join(process.cwd(), 'scripts/audit-page.mjs'), '--dry-run'],
    {
      encoding: 'utf8',
    },
  );
  const thresholds = JSON.parse(output) as {
    minPwa: number;
    minA11y: number;
    minBestPractices: number;
    visualDiffTolerance: number;
  };

  expect(thresholds).toEqual({
    minPwa: 90,
    minA11y: 90,
    minBestPractices: 90,
    visualDiffTolerance: 0.01,
  });
});

test('UX audit fails closed when Lighthouse or a visual baseline is unavailable', () => {
  const output = execFileSync(
    'node',
    [join(process.cwd(), 'scripts/audit-page.mjs'), '--self-test-fail-closed'],
    { encoding: 'utf8' },
  );
  const failures = JSON.parse(output) as string[];

  expect(failures).toContain('Lighthouse runtime error: navigation failed');
  expect(failures).toContain('mobile visual baseline missing-baseline');
});
