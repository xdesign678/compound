#!/usr/bin/env node

export const MIN_PWA = 90;
export const MIN_A11Y = 90;
export const MIN_BEST_PRACTICES = 90;
export const VISUAL_DIFF_TOLERANCE = 0.01;

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

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--dry-run')) {
    printDryRun();
    process.exit(0);
  }

  process.stderr.write('audit-page scaffold ready; full --page support lands in U0.2.\n');
  process.exit(0);
}
