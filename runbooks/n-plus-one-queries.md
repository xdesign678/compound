# N+1 query detection

Use this runbook when the `/api/metrics` scrape, structured logs, or a code
review surface a probable N+1 SQL pattern in Compound's `better-sqlite3`
persistence layer.

## Symptoms

- A request log line `db.n_plus_one_detected` is emitted with a
  `fingerprint`, `count` and `scopeLabel` (the originating route).
- The Prometheus metric `compound_db_n_plus_one_incidents_total` is
  increasing while traffic is otherwise stable.
- A specific fingerprint dominates the `compound_db_query_fingerprint_count`
  gauge for a given route.
- A `db.query_scope_summary` log shows `nPlusOneCount > 0` for a request.

## How detection works

`lib/observability/query-analyzer.ts` wraps every prepared statement returned
by `getServerDb().prepare(...)`. For each request (or any scope opened with
`runWithQueryScope`) it counts executions per normalized SQL fingerprint and
fires a single warning when the count crosses
`COMPOUND_N_PLUS_ONE_THRESHOLD` (default `10`).

Configuration knobs:

| Env var                           | Default | Effect                                       |
| --------------------------------- | ------: | -------------------------------------------- |
| `COMPOUND_N_PLUS_ONE_THRESHOLD`   |    `10` | Per-scope count that triggers the warning.   |
| `COMPOUND_SLOW_QUERY_MS`          |    `50` | Per-statement duration that emits a warning. |
| `COMPOUND_DISABLE_QUERY_ANALYZER` |   unset | Set to `1` to disable the wrapper entirely.  |

## Triage

1. Identify the request scope from the warning: the `scopeLabel` field looks
   like `GET /api/concepts` or `request:GET /api/sync/dashboard`.
2. Run the offending fingerprint locally:

   ```bash
   COMPOUND_N_PLUS_ONE_THRESHOLD=2 npm run dev
   # then hit the suspect route
   ```

3. Inspect the `db.query_scope_summary` log entry — it lists the top
   fingerprints per request and their cumulative duration.

## Fix patterns

| Anti-pattern                                            | Replacement                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `for (const id of ids) repo.getConcept(id)`             | `repo.getConceptsByIds(ids)` (batched `IN (...)` query already in `repo`). |
| Per-row `getSource(id)` after listing                   | `repo.getSourcesByIds(ids, { summariesOnly: true })`.                      |
| Per-row JSON parsing then re-fetch                      | Add a JOIN or store the denormalized field in the parent row.              |
| Loop calling `repo.upsertConcept` outside a transaction | Wrap with `db.transaction(() => { ... })()` to amortize fsync cost.        |

## Verification

After applying the fix, hit the offending endpoint with the analyzer enabled:

```bash
curl -s "$APP_URL/api/metrics" | grep compound_db_n_plus_one
```

Expect `compound_db_n_plus_one_incidents_total` to remain flat under load.
The unit test `lib/observability/query-analyzer.test.ts` exercises both the
N+1 detection path and the batched-fetch happy path; rerun it with
`npm test`.

## Related

- [`lib/observability/query-analyzer.ts`](../lib/observability/query-analyzer.ts)
- [`lib/server-db.ts`](../lib/server-db.ts)
- [SQLite data persistence runbook](data-persistence.md)
