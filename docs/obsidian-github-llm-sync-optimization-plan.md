# Obsidian -> GitHub -> LLM Wiki Sync Optimization Plan

Date: 2026-05-09

## Summary

This plan covers the full flow from local Obsidian notes to a GitHub repository,
then to Compound's web sync pipeline, LLM analysis, Wiki indexing, and query
readiness.

The current architecture is directionally right:

- Obsidian and GitHub should stay as the source sync layer.
- Compound should remain the private LLM Wiki compiler.
- SQLite should remain the first queue/storage layer for the next optimization
  pass.
- External systems such as Redis/BullMQ/Temporal should be treated as future
  scaling options, not the default first move.

The main optimization goals are:

1. Improve stability and recovery.
2. Make async state explicit and reliable.
3. Reduce unnecessary LLM work through better incremental caching.
4. Improve observability for sync, analysis jobs, model calls, and failures.
5. Keep online validation safe by default.

## Current Baseline

### Online API Baseline

Online target:

```text
https://compund.zeabur.app
```

Read-only online checks already passed:

- `GET /api/health`: HTTP 200.
- `GET /api/wiki/health`: HTTP 200.
- `GET /api/metrics`: HTTP 200.

Observed online state:

- Admin auth is configured and enforced.
- LLM is configured.
- GitHub sync is configured.
- `DATA_DIR` is configured.
- Wiki FTS is ready.
- Wiki metrics at the time of the check:
  - `sources`: 178
  - `concepts`: 383
  - `sourceChunks`: 697
  - `conceptEvidence`: 511
  - `conceptVersions`: 353
- `/api/metrics` showed no active sync run at the time of the check.
- `/api/metrics` already exposed analysis job counts, including succeeded
  `github_ingest`, `embedding`, `summarize`, and `qa_index` jobs.

The admin token used for testing must never be committed or written into docs.
Use a temporary shell variable when calling online APIs.

### Online LLM Smoke Model

The online health check reported the current production model as:

```text
minimax/minimax-m2.7
```

Use this model explicitly for online LLM smoke tests:

```http
x-user-model: minimax/minimax-m2.7
```

Reason:

- This tests the real production model path.
- It avoids accidental model drift if the deployment default changes later.
- It still uses the server-side configured API key and API URL, so no local
  OpenRouter key is required.

Online LLM smoke tests are not part of the default read-only check because
`/api/query` consumes model quota and may write query telemetry/history. Run it
only when the phase explicitly calls for a real LLM test.

### Current Main Flow

The current automatic flow is:

1. Obsidian notes are pushed to a GitHub repository.
2. Compound receives a GitHub webhook, cron rescan, or manual sync request.
3. `listMarkdownFiles()` scans the GitHub tree for Markdown files.
4. `github-sync-runner` diffs remote files against local `sources.external_key`.
5. Changed files are written to `sync_run_items`.
6. Create/update files are downloaded from GitHub.
7. Each downloaded Markdown file is queued as a `github_ingest` analysis job.
8. `analysis-worker` claims jobs from SQLite.
9. `github_ingest` calls the LLM ingest path and writes sources/concepts.
10. Wiki artifacts are compiled: chunks, FTS, evidence, versions, relations.
11. Post-ingest jobs are queued:
    - `embedding`
    - `summarize`
    - `relations`
    - `qa_index`
12. `/sync`, `/api/sync/dashboard`, and `/api/metrics` expose progress and
    health.

## Key Problems

### Completion Semantics Are Too Coarse

`github_ingest` currently marks a file item as succeeded after the base ingest
finishes. However, post-ingest jobs may still be queued or running:

- embedding
- source summary
- relation extraction
- QA readiness marker

This can make the UI feel done before the full analysis pass is actually done.

### Worker Lifecycle Is Not Durable Enough

The worker is an in-process background Promise triggered by API routes and
dashboard polling. SQLite stores job state, but long LLM calls do not refresh a
durable heartbeat during execution.

The current lease window avoids some false recovery, but the model is still
vulnerable to:

- apparent stalls during long model calls,
- process restarts,
- multi-instance deployments,
- unclear worker ownership,
- duplicate pressure on upstream LLMs.

### Cancel Is Mostly State-Level

Cancel currently marks runs/jobs/items as cancelled in SQLite, but in-flight LLM
or embedding network requests are not reliably interrupted. The real request may
continue until it returns or times out.

### Background LLM Calls Need Their Own Budget

HTTP routes use request rate limits, but background jobs do not go through the
same `llmRateLimit()` path. Worker concurrency is controlled mostly by:

- `COMPOUND_ANALYSIS_WORKER_BATCH`
- `COMPOUND_ANALYSIS_MAX_WORKERS`
- gateway timeout/circuit breaker behavior

This is not enough for predictable LLM spend and upstream stability.

### Incremental Rebuilds Are Not Granular Enough

The sync layer uses GitHub path and blob sha to skip unchanged files, but the
analysis stages do not yet have a full stage-level fingerprint model.

Useful future fingerprints:

```text
repo + branch + path + blobSha + normalizedContentHash + parserVersion + promptVersion
```

That would allow the app to skip chunking, embeddings, summaries, or relations
when their inputs and versions have not changed.

### GitHub Tree Truncation Needs Fallback

GitHub's recursive tree API can return `truncated=true` for large repositories.
The current code warns, but a large Obsidian vault may need a non-recursive
fallback scan to avoid missing files.

### UI and Backend Action Mismatch

The `/sync` UI has a `skip-failed` style action, but the backend path currently
maps through cancel behavior. The label and backend behavior should match.

## Architecture Direction

### Keep SQLite First

Do not introduce Redis/BullMQ/Temporal in the first pass. Instead, improve the
current SQLite queue with patterns borrowed from mature task systems:

- step-level state,
- attempts,
- heartbeat,
- retry backoff,
- permanent failure classification,
- dead-letter or manual-review state,
- clearer worker ownership.

External references:

- BullMQ stalled jobs and retries: https://docs.bullmq.io/guide/jobs/stalled
- Inngest durable execution: https://www.inngest.com/docs/learn/how-functions-are-executed
- QStash dead-letter queue: https://upstash.com/docs/qstash/features/dlq
- Trigger.dev tasks and retries: https://trigger.dev/docs
- Temporal durable workflows: https://docs.temporal.io/

### Use RAG Frameworks As Design References

Borrow ingestion ideas, not whole frameworks:

- LlamaIndex IngestionPipeline: cache, transformations, docstore, vector store.
- LangChain RecordManager/indexing: source ids, document hashes, incremental
  cleanup.
- Microsoft GraphRAG: entity/relation extraction and summaries, but only as a
  lightweight local graph model for now.

External references:

- LlamaIndex ingestion pipeline: https://docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/
- LangChain indexing API: https://api.python.langchain.com/en/latest/indexing/langchain_core.indexing.api.index.html
- Microsoft GraphRAG: https://github.com/microsoft/graphrag

### Treat Markdown Publishing Tools As Compatibility References

Quartz, MkDocs, Dendron, and Obsidian Git are useful for Markdown compatibility
and sync conventions. They should not replace Compound's LLM Wiki architecture.

Use them to build fixtures for:

- frontmatter,
- wikilinks,
- tags,
- callouts,
- embeds,
- asset links,
- deep headings.

References:

- Obsidian Git: https://github.com/Vinzent03/obsidian-git
- Quartz: https://quartz.jzhao.xyz/
- MkDocs: https://www.mkdocs.org/
- Dendron: https://github.com/dendronhq/dendron

## Implementation Phases

### Phase 1: Fix State Semantics and Dashboard Accuracy

Goal: make `/sync` report the real state of each file and run.

Changes:

- Split file progress into base ingest and enhanced analysis.
- Treat `github_ingest` success as "base Wiki ingest complete".
- Treat `embedding`, `summarize`, `relations`, and `qa_index` terminal states
  as "enhanced analysis complete".
- Update dashboard health so post-ingest failed jobs keep the run visible as
  needing attention.
- Update `/api/metrics` to expose analysis state by run/item/stage more clearly.
- Fix or rename `skip-failed` so the UI action matches backend behavior.

Expected result:

- The UI no longer says everything is complete while post-ingest jobs are still
  running or failed.
- Operators can tell whether the Wiki is basically usable versus fully analyzed.

### Phase 2: Make Worker Execution More Durable

Goal: reduce false stalls and improve recovery from long model calls or restarts.

Changes:

- Add durable heartbeat refresh for running analysis jobs.
- Refresh heartbeat during long stages:
  - LLM ingest,
  - contextual chunking,
  - embedding,
  - summarize,
  - relation extraction.
- Add stage duration metrics.
- Add job attempt metrics.
- Add error category metrics.
- Distinguish transient and permanent errors:
  - permanent: missing payload, invalid config, unrecoverable schema issue;
  - transient: 429, 5xx, timeout, network reset.
- Keep failed jobs retryable from `/sync`.

Expected result:

- A long LLM call looks like active work, not a dead job.
- Crash recovery remains automatic.
- Repeated permanent failures do not waste retries.

### Phase 3: Propagate Cancel To In-Flight Calls

Goal: make cancel stop real work, not only update DB state.

Changes:

- Create per-run or per-job `AbortController` instances.
- Pass `AbortSignal` into:
  - `chat()`,
  - contextual chunk calls,
  - remote embedding fetches,
  - other long network calls.
- On cancel, abort the active controller and persist cancelled state.
- Preserve DB state as the source of truth across restarts.

Expected result:

- Cancelling a sync can interrupt active LLM calls quickly.
- The UI's cancel language becomes technically accurate.

### Phase 4: Add Background LLM Budgeting

Goal: prevent large syncs from overwhelming the upstream model provider.

Changes:

- Add a background LLM concurrency limiter.
- Budget by task class:
  - `github_ingest`
  - `summarize`
  - `relations`
  - contextual chunking
- Keep default concurrency conservative.
- Show limiter state in dashboard diagnostics when jobs are queued because of
  budget.
- Keep HTTP request rate limiting separate from worker LLM budgeting.

Expected result:

- Throughput becomes predictable.
- Model failures from burst pressure should decrease.
- Queue delays become visible instead of mysterious.

### Phase 5: Add Stage-Level Incremental Caching

Goal: avoid repeated LLM and indexing work when inputs did not change.

Changes:

- Add source/stage fingerprints:

```text
repo + branch + path + blobSha + normalizedContentHash + parserVersion + promptVersion
```

- Store per-stage input hash and output hash.
- Skip unchanged stages.
- Rerun only affected stages when parser or prompt versions change.
- Avoid long-term storage of full raw Markdown inside `analysis_jobs.payload_json`.
- Prefer storing a source/blob reference that can be recovered or refetched.

Expected result:

- Force rescan becomes cheaper.
- Updates to one file do not cause unrelated analysis work.
- Repeated retries avoid unnecessary recomputation where possible.

### Phase 6: Fix Job Idempotency and Queue Constraints

Goal: prevent hidden conflicts between stable job ids and table uniqueness.

Changes:

- Reconcile `analysis_jobs` job id generation with SQLite unique constraints.
- Include run/item dimensions only where they are meant to create a distinct
  job.
- Preserve source/stage dedupe where rerunning the exact same stage should be
  skipped.
- Add tests for force rescan with the same sha.
- Add tests for same source/stage across different runs.

Expected result:

- No hidden unique constraint conflict during force rescan.
- Queue behavior is predictable across retries and repeated runs.

### Phase 7: Harden GitHub and Obsidian Compatibility

Goal: make large and messy vaults safer to sync.

Changes:

- Add fallback when GitHub recursive tree returns `truncated=true`.
- Keep skipping `.obsidian/` and `.trash/`.
- Add Markdown fixtures for common Obsidian syntax:
  - YAML frontmatter,
  - wikilinks,
  - tags,
  - callouts,
  - embeds,
  - local assets,
  - nested headings.
- Make parser output stable source/chunk metadata.

Expected result:

- Large vaults do not silently miss files.
- Obsidian-flavored Markdown is covered by regression tests.

### Phase 8: Online Validation and Release

Goal: validate safely against the deployed service.

Rules:

- Work directly on `main`.
- Do not create a branch or PR.
- Commit and push to `origin main` when changes are complete.
- Never commit admin tokens or model API keys.

Default online read-only smoke:

```bash
BASE="https://compund.zeabur.app"
TOKEN="$COMPOUND_ADMIN_TOKEN"

curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/health"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/wiki/health"
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/metrics"
```

Optional online LLM smoke:

```bash
BASE="https://compund.zeabur.app"
TOKEN="$COMPOUND_ADMIN_TOKEN"
MODEL="minimax/minimax-m2.7"

curl -fsS \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-user-model: $MODEL" \
  -d '{"question":"用一句话说明当前 Wiki 主要内容。"}' \
  "$BASE/api/query"
```

Run the LLM smoke only when a phase explicitly needs real model validation.

Do not trigger these routes during default validation:

- `POST /api/sync/run`
- `GET|POST /api/sync/cron/rescan`
- `POST /api/ingest`

Use them only in a dedicated sync validation phase.

## Test Plan

### Unit Tests

Add or update tests for:

- queue claim ordering,
- retry and backoff,
- stale lease recovery,
- heartbeat refresh,
- cancel abort propagation,
- permanent versus transient failures,
- job idempotency,
- force rescan with same sha,
- stage fingerprint skip logic,
- `skip-failed` behavior.

### Integration Tests

Cover:

- new Markdown file,
- updated same path with new sha,
- deleted Markdown file,
- force rescan with same sha,
- LLM timeout and retry,
- worker restart recovery,
- post-ingest job failure after base ingest success,
- dashboard state while post-ingest jobs are still running.

### UI Tests

Cover `/sync` states:

- base ingest running,
- base ingest complete and enhanced analysis running,
- enhanced analysis failed,
- stalled run,
- single file retry,
- retry all,
- cancel,
- corrected skip-failed behavior.

### Required Local Commands

Use the high-signal repo checks:

```bash
npm run check
npm run docs:api:check
```

Also run targeted sync/worker tests. If changes affect build behavior or
deployment risk, run:

```bash
npm run build:measure
```

## Acceptance Criteria

The optimization is complete when:

- `/sync` accurately distinguishes base ingest and enhanced analysis.
- Running jobs heartbeat during long LLM/network work.
- Cancel interrupts in-flight model/network calls where technically possible.
- Background LLM calls have an explicit concurrency budget.
- Repeated syncs skip unchanged stages.
- Force rescan does not hit hidden job uniqueness conflicts.
- Large GitHub trees have a fallback when recursive scan is truncated.
- Online read-only smoke passes after deployment.
- Optional online LLM smoke uses `x-user-model: minimax/minimax-m2.7`.
- Changes are committed and pushed to `origin main`.

## Assumptions

- The deployed target remains `https://compund.zeabur.app`.
- The production LLM smoke model remains fixed to `minimax/minimax-m2.7` unless
  the plan is intentionally revised.
- The online deployment already has a valid server-side LLM key.
- Local OpenRouter credentials are not required for online API validation.
- Stability and observability are more important than blindly increasing worker
  concurrency.
- SQLite remains the source of truth for the next implementation pass.
