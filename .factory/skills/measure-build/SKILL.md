---
name: measure-build
description: Use scripts/measure-build.mjs (npm run build:measure) to record build duration, .next/cache hit status, and bundle size for Compound. Use this skill when investigating slow CI builds, comparing a refactor's impact on bundle size, or reproducing the metrics that CI uploads as the build-metrics artifact.
---

# Measure a Next.js build

Compound tracks build performance over time. Every CI run executes
`npm run build:measure` and uploads `tmp/build-metrics.json` as a GitHub
Actions artifact (see `.github/workflows/ci.yml`). Run the same script
locally to compare a branch against `main`.

## When to use this skill

- You suspect a recent change made `next build` slower.
- You want to verify a code-splitting or dependency change actually
  reduced the bundle size of `.next/static`.
- A CI run failed at the build step and you want a deterministic local
  reproduction with full timing information.
- The `compound` README or `AGENTS.md` mentions build performance
  tracking and you need to act on it.

## How to run

```bash
npm run build:measure
```

This is a thin wrapper around `node scripts/measure-build.mjs`, which:

1. Snapshots `.next/cache` size before the build.
2. Runs the local `next build` binary (no global install needed).
3. Snapshots `.next/cache` and `.next/static` after the build.
4. Parses the build log for the route count.
5. Writes `tmp/build-metrics.json`, prints a human-readable summary,
   and — when `$GITHUB_STEP_SUMMARY` is set — appends a markdown table
   to the job summary.
6. Exits with the exit code of `next build` (so CI fails iff the build
   fails, while still producing the metrics artifact).

## Inspecting the output

```bash
cat tmp/build-metrics.json | python3 -m json.tool
```

Notable fields:

| Field                                | Meaning                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `durationMs`                         | Wall-clock time of `next build`.                                                     |
| `cacheHit`                           | `true` when `.next/cache` already existed and was non-empty before the build.        |
| `cacheSizeBefore` / `cacheSizeAfter` | Bytes; growth indicates new compiled artefacts.                                      |
| `staticBytes`                        | Size of `.next/static` — the user-facing JS/CSS bundle.                              |
| `routes`                             | Best-effort count parsed from the build log's route table.                           |
| `next` / `node`                      | Dependency versions, useful when comparing two runs.                                 |
| `commit` / `branch`                  | Filled from `GITHUB_SHA` / `GITHUB_REF_NAME` in CI, otherwise read from `.git/HEAD`. |

The file is gitignored (see the `tmp/` rule in `.gitignore`).

## Comparing two runs

To diff the impact of a change:

```bash
git checkout main
npm ci
npm run build:measure
mv tmp/build-metrics.json tmp/build-metrics.main.json

git checkout <your-branch>
npm ci   # if dependencies changed
npm run build:measure
mv tmp/build-metrics.json tmp/build-metrics.feature.json

diff <(jq . tmp/build-metrics.main.json) <(jq . tmp/build-metrics.feature.json)
```

Look for changes in `durationMs` (>10 % is meaningful) and
`staticBytes` (any bundle bloat over a few KB warrants investigation).

## Cache caveats

- A cold local cache produces unrealistically slow builds. To benchmark
  realistically, run the script twice and compare the second run.
- CI builds use `actions/cache@v4` keyed on
  `package-lock.json` + source hashes (see `ci.yml`). A cache miss on
  CI typically explains a 2-3x duration spike — check `cacheHit` in the
  uploaded artifact before blaming code changes.
- Deleting `.next/` is the most reliable way to test a _cold_ build
  locally:
  ```bash
  rm -rf .next && npm run build:measure
  ```
