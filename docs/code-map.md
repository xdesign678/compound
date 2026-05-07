# Compound Code Map

Generated at: 2026-05-07T05:22:14.017Z

Files scanned: 229
Local import edges: 562

## Areas

| Area       | Files | Outgoing imports | Incoming imports |
| ---------- | ----: | ---------------: | ---------------: |
| app        |    46 |              193 |                0 |
| components |    53 |              174 |               77 |
| lib        |   117 |              192 |              485 |
| scripts    |    13 |                3 |                0 |

## Most Referenced Files

| File                            | Imported by | Imports |
| ------------------------------- | ----------: | ------: |
| `lib/types.ts`                  |          47 |       0 |
| `lib/server-auth.ts`            |          38 |       0 |
| `lib/store.ts`                  |          34 |       5 |
| `lib/logging.ts`                |          29 |       0 |
| `lib/server-db.ts`              |          23 |       3 |
| `components/Icons.tsx`          |          22 |       1 |
| `lib/request-context.ts`        |          17 |       2 |
| `lib/db.ts`                     |          16 |       3 |
| `lib/wiki-db.ts`                |          16 |       4 |
| `lib/format.ts`                 |          14 |       0 |
| `lib/rate-limit.ts`             |          12 |       1 |
| `lib/request-guards.ts`         |          12 |       1 |
| `components/sync/types.ts`      |          11 |       0 |
| `lib/server-logger.ts`          |          11 |       1 |
| `lib/prompts.ts`                |          10 |       0 |
| `lib/api-client.ts`             |           9 |       7 |
| `lib/category-normalization.ts` |           9 |       1 |
| `lib/gateway.ts`                |           9 |       5 |
| `lib/sync-observability.ts`     |           9 |       3 |
| `lib/admin-auth-client.ts`      |           8 |       0 |
| `lib/trace-client.ts`           |           7 |       0 |
| `lib/cloud-sync.ts`             |           6 |       5 |
| `lib/github-sync-runner.ts`     |           6 |       7 |
| `lib/review-queue.ts`           |           6 |       2 |
| `lib/wiki-compiler.ts`          |           6 |       3 |
| `lib/analysis-worker.ts`        |           5 |       8 |
| `lib/embedding.ts`              |           5 |       4 |
| `lib/llm-config.ts`             |           5 |       3 |
| `lib/store/types.ts`            |           5 |       4 |
| `lib/utils.ts`                  |           5 |       0 |

## Boundary Notes

- Server-only modules should stay behind `app/api/**` route handlers.
- Client views should prefer `lib/api-client.ts` and browser-safe modules.
- Use this map as a navigation aid before broad refactors.
