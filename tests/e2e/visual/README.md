# UX Visual Baselines

This directory stores mobile and desktop PNG baselines used by `npm run audit:ux`.

## Update Flow

```bash
npm run audit:ux -- --page=<id> --update-baseline
```

The audit runner writes current screenshots to `tmp/ux-audit/`, compares them against the PNG files in this directory, and only updates tracked baselines when `--update-baseline` is passed.

Diff output is intentionally ignored under `tests/e2e/visual/diff/`, `tests/e2e/visual/__diff_output__/`, and `tmp/ux-audit/`.
