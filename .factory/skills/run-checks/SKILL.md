---
name: run-checks
description: Run the project's full local quality gate (typecheck, node tests, ESLint, Next.js build) the same way CI does. Use this skill before committing changes, when debugging CI failures, or when verifying a refactor in the Compound Next.js / better-sqlite3 codebase.
---

# Run local checks for Compound

Compound is a Next.js 15 + TypeScript app with a strict CI gate. The repo uses
four independent checks; running them locally in the same order CI uses
catches regressions before push.

## When to use this skill

- Before every commit or push to `main`.
- When CI on `.github/workflows/ci.yml` reports a failure and you want to
  reproduce it locally.
- After upgrading dependencies in `package.json` / `package-lock.json`.
- When the user asks "run the checks", "verify the build", or similar.

## Single command (recommended)

```bash
npm run check
```

`npm run check` is defined in `package.json` and runs, in order:

1. `npm run typecheck` — `tsc -p tsconfig.typecheck.json --noEmit --pretty false`
2. `npm run test` — compiles every `lib/**/*.test.ts` with `tsc` into
   `node_modules/.cache/compound-node-tests` and runs them with
   `node --test` (see `scripts/run-node-tests.mjs`).
3. `npm run build` — `next build`. Use `npm run build:measure` instead when
   you also want to record `tmp/build-metrics.json` (see the
   `measure-build` skill).

If any step fails, stop and fix that step before moving on; later steps
typically depend on earlier ones (for example, types must compile before
tests can be transpiled).

## Individual commands

| Goal | Command |
| ---- | ------- |
| TypeScript only (fast, no emit) | `npm run typecheck` |
| Node-side unit tests | `npm run test` |
| ESLint (Next.js core-web-vitals rules) | `npm run lint` |
| Production build | `npm run build` |
| Build + performance metrics | `npm run build:measure` |
| Danger PR review (CI parity) | `npm run danger` |

ESLint is *not* part of `npm run check`; it is enforced via
`lint-staged` on commit (see `package.json > "lint-staged"`) and in the
`pr-review.yml` workflow. Run `npm run lint` manually when you change
many files at once or when you suspect a Husky hook was bypassed.

## Common failure modes & fixes

- **`tsc` errors only in `npm run test`**: the test runner uses CommonJS
  (`--module commonjs`) instead of the Next.js bundler config. If a test
  file imports a Next.js-only module (`next/server`, `@/app/...`), move
  the logic under test into a plain `lib/*.ts` module and have the
  route/page wrap it.
- **`No node-side tests found.`**: the test runner only picks up files
  matching `lib/*.test.ts`. Place new tests directly under `lib/`, not in
  a `__tests__/` subdirectory.
- **Husky `prepare` script fails on fresh clones**: run
  `git config core.hooksPath .husky` once, or simply `npm ci` again — the
  `prepare` script will install hooks idempotently.
- **`next build` fails on missing env**: production builds do not require
  `LLM_API_KEY` etc., but they do require valid TypeScript and a working
  `next.config.mjs`. If env validation fires at runtime, check
  `lib/server-auth.ts` and `app/api/health/route.ts` for the exact var
  names.

## Pre-push checklist

Run all four locally, in this order:

```bash
npm run typecheck
npm run lint
npm run test
npm run build:measure
```

If all pass, the GitHub `check` workflow will also pass, because CI runs
exactly the same commands on Node 22 (see `.nvmrc` and `ci.yml`).
