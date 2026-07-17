# Compound Code Map

Generated at: 2026-07-17T17:56:37.863Z

Files scanned: 320
Local import edges: 781

## Areas

| Area       | Files | Outgoing imports | Incoming imports |
| ---------- | ----: | ---------------: | ---------------: |
| app        |    54 |              252 |                0 |
| components |    60 |              225 |               85 |
| lib        |   184 |              296 |              691 |
| scripts    |    22 |                8 |                5 |

## Most Referenced Files

| File                              | Imported by | Imports |
| --------------------------------- | ----------: | ------: |
| `lib/types.ts`                    |          56 |       0 |
| `lib/server-auth.ts`              |          45 |       0 |
| `lib/store.ts`                    |          40 |       5 |
| `lib/logging.ts`                  |          35 |       0 |
| `lib/api-error.ts`                |          29 |       1 |
| `lib/server-db.ts`                |          28 |       3 |
| `components/Icons.tsx`            |          25 |       1 |
| `lib/request-guards.ts`           |          22 |       1 |
| `lib/db.ts`                       |          18 |       3 |
| `lib/request-context.ts`          |          18 |       3 |
| `lib/wiki-db.ts`                  |          17 |       4 |
| `lib/format.ts`                   |          15 |       0 |
| `lib/prompts.ts`                  |          14 |       0 |
| `lib/rate-limit.ts`               |          14 |       2 |
| `lib/api-client.ts`               |          13 |       8 |
| `lib/server-logger.ts`            |          12 |       1 |
| `components/sync/types.ts`        |          11 |       0 |
| `lib/sync-observability.ts`       |          11 |       3 |
| `lib/utils.ts`                    |          11 |       0 |
| `lib/gateway.ts`                  |          10 |       9 |
| `lib/observability/prometheus.ts` |          10 |       3 |
| `lib/admin-auth-client.ts`        |           9 |       0 |
| `lib/category-normalization.ts`   |           9 |       1 |
| `lib/analysis-worker.ts`          |           8 |      12 |
| `lib/category-wiki-worker.ts`     |           8 |       6 |
| `lib/cloud-sync.ts`               |           8 |       5 |
| `lib/model-history.ts`            |           8 |       3 |
| `lib/hooks/useFocusTrap.ts`       |           7 |       0 |
| `lib/i18n/index.ts`               |           7 |       2 |
| `lib/trace-client.ts`             |           7 |       0 |

## Boundary Notes

- Server-only modules should stay behind `app/api/**` route handlers.
- Client views should prefer `lib/api-client.ts` and browser-safe modules.
- Use this map as a navigation aid before broad refactors.
