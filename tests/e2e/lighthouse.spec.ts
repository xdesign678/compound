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
