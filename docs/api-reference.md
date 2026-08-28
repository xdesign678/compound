<!-- AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
     Run `npm run docs:api` (scripts/generate-api-docs.mjs) to regenerate.
     Source of truth: app/api/**/route.ts -->

# Compound HTTP API reference

This document is generated automatically from the Next.js Route Handlers under `app/api/**/route.ts`. It enumerates every public HTTP endpoint, the methods it implements, runtime hints, and obvious security guards (admin token, rate limit, payload size, webhook signatures).

- Routes: **47**
- Handlers (HTTP methods): **57**
- Generator: `scripts/generate-api-docs.mjs`

## Table of contents

- **auth**
  - [`/api/auth/session`](#api-auth-session)
- **categorize**
  - [`/api/categorize`](#api-categorize)
- **concepts**
  - [`/api/concepts/archive-answer`](#api-concepts-archive-answer)
  - [`/api/concepts/from-selection`](#api-concepts-from-selection)
  - [`/api/concepts/from-selection/status`](#api-concepts-from-selection-status)
- **data**
  - [`/api/data/concepts/{id}/flag`](#api-data-concepts--id--flag)
  - [`/api/data/concepts/{id}`](#api-data-concepts--id)
  - [`/api/data/concepts/{id}/versions`](#api-data-concepts--id--versions)
  - [`/api/data/concepts`](#api-data-concepts)
  - [`/api/data/snapshot`](#api-data-snapshot)
  - [`/api/data/sources`](#api-data-sources)
- **health**
  - [`/api/health/live`](#api-health-live)
  - [`/api/health/ready`](#api-health-ready)
  - [`/api/health`](#api-health)
- **ingest**
  - [`/api/ingest`](#api-ingest)
- **lint**
  - [`/api/lint`](#api-lint)
  - [`/api/lint/run`](#api-lint-run)
  - [`/api/lint/status`](#api-lint-status)
- **metrics**
  - [`/api/metrics`](#api-metrics)
- **ops**
  - [`/api/ops/model-runs`](#api-ops-model-runs)
- **query**
  - [`/api/query`](#api-query)
- **repair**
  - [`/api/repair/run`](#api-repair-run)
  - [`/api/repair/status`](#api-repair-status)
- **review**
  - [`/api/review/queue/{id}`](#api-review-queue--id)
  - [`/api/review/queue`](#api-review-queue)
- **settings**
  - [`/api/settings/models`](#api-settings-models)
- **sync**
  - [`/api/sync/cancel`](#api-sync-cancel)
  - [`/api/sync/cron/rescan`](#api-sync-cron-rescan)
  - [`/api/sync/dashboard`](#api-sync-dashboard)
  - [`/api/sync/dlq`](#api-sync-dlq)
  - [`/api/sync/github/content`](#api-sync-github-content)
  - [`/api/sync/github/list`](#api-sync-github-list)
  - [`/api/sync/github/run`](#api-sync-github-run)
  - [`/api/sync/github/webhook`](#api-sync-github-webhook)
  - [`/api/sync/retry`](#api-sync-retry)
  - [`/api/sync/run`](#api-sync-run)
  - [`/api/sync/status`](#api-sync-status)
  - [`/api/sync/worker`](#api-sync-worker)
- **wiki**
  - [`/api/wiki/category`](#api-wiki-category)
  - [`/api/wiki/category/runs/{id}`](#api-wiki-category-runs--id)
  - [`/api/wiki/category/runs`](#api-wiki-category-runs)
  - [`/api/wiki/export`](#api-wiki-export)
  - [`/api/wiki/health`](#api-wiki-health)
  - [`/api/wiki/import`](#api-wiki-import)
  - [`/api/wiki/rebuild-index`](#api-wiki-rebuild-index)
  - [`/api/wiki/search`](#api-wiki-search)
  - [`/api/wiki/topics`](#api-wiki-topics)

## auth

### `/api/auth/session`

Source: [`app/api/auth/session/route.ts`](../app/api/auth/session/route.ts)

| Field       | Value                    |
| ----------- | ------------------------ |
| Methods     | `GET`, `POST`, `DELETE`  |
| Runtime     | `nodejs`                 |
| maxDuration | _unset_                  |
| Guards      | `content-length-guarded` |

#### GET

GET /api/auth/session
Reports whether the current browser has a valid access-protection session.
The response never exposes the token and is not cacheable.

@returns 200 JSON `{ authenticated: boolean }`.

#### POST

POST /api/auth/session
Validates an Admin Token and sets the httpOnly access-protection cookie.
Failed attempts are rate-limited per client IP (auth scope) with Retry-After.

Body: `{ "token": "..." }`.

@returns 200 JSON `{ authenticated: true }` and a Set-Cookie header on success.

#### DELETE

DELETE /api/auth/session
Clears the httpOnly access-protection cookie.

@returns 200 JSON `{ authenticated: false }`.

## categorize

### `/api/categorize`

Source: [`app/api/categorize/route.ts`](../app/api/categorize/route.ts)

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Methods     | `POST`                                                  |
| Runtime     | `nodejs`                                                |
| maxDuration | 90                                                      |
| Guards      | `admin-token`, `rate-limited`, `content-length-guarded` |

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/categorize/route.ts` to document this endpoint._

## concepts

### `/api/concepts/archive-answer`

Source: [`app/api/concepts/archive-answer/route.ts`](../app/api/concepts/archive-answer/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `POST`                                  |
| Runtime     | `nodejs`                                |
| maxDuration | 30                                      |
| Guards      | `admin-token`, `content-length-guarded` |

#### POST

Archive an Ask answer as a derived draft Wiki concept. The new concept,
provenance, open review item, activity, and sync change share one SQLite
transaction. Drafts stay visible for review but are excluded from retrieval
until approved.

### `/api/concepts/from-selection`

Source: [`app/api/concepts/from-selection/route.ts`](../app/api/concepts/from-selection/route.ts)

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Methods     | `POST`                                                  |
| Runtime     | `nodejs`                                                |
| maxDuration | 30                                                      |
| Guards      | `admin-token`, `rate-limited`, `content-length-guarded` |

#### POST

Start a server-side Wiki creation run from a free-form text selection. The
API returns quickly with a `runId`; the LLM work and SQLite writes continue
in the server process so the browser can close or reload without losing the
creation job.

Body: `SelectionWikiRequest` — `selection` is required (>= 2, <= 4k chars).
Optional `sourceConceptId` links the new page back to the page the snippet
came from; `contextTitle` gives the worker extra grounding. Poll
`/api/concepts/from-selection/status?runId=<id>` for progress and result.

Guards: admin token, LLM rate limit, 256KB body cap.

### `/api/concepts/from-selection/status`

Source: [`app/api/concepts/from-selection/status/route.ts`](../app/api/concepts/from-selection/status/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | _unset_       |
| Guards      | `admin-token` |

#### GET

Poll the status of a server-side selection-to-Wiki run.

Query: `?runId=<id>`
Returns the current phase, error (if any), and final `SelectionWikiResponse`
once the run is done. The route also revives still-running jobs if the server
lost its in-memory worker reference after a restart.

Guards: admin token.

## data

### `/api/data/concepts/{id}/flag`

Source: [`app/api/data/concepts/[id]/flag/route.ts`](../app/api/data/concepts/[id]/flag/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `POST`                                  |
| Runtime     | `nodejs`                                |
| maxDuration | 10                                      |
| Guards      | `admin-token`, `content-length-guarded` |

#### POST

POST /api/data/concepts/:id/flag
Mark a concept as incorrect. Creates a deduplicated server review item
and a server activity + sync change in the same transaction, then returns
both so the current client can mirror them.

Consecutive clicks reuse the open review item and do not enqueue more
pending reviews or extra activity. Body (optional): `{ expectedRevision }`.

CAS mismatch returns 409
`{ code: "revision_conflict", expectedRevision, currentRevision }`.
Missing `expectedRevision` follows `COMPOUND_MUTATION_CAS_MODE`
(`log-only` default, or `enforce`).

### `/api/data/concepts/{id}`

Source: [`app/api/data/concepts/[id]/route.ts`](../app/api/data/concepts/[id]/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `DELETE`                                |
| Runtime     | `nodejs`                                |
| maxDuration | 30                                      |
| Guards      | `admin-token`, `content-length-guarded` |

#### DELETE

DELETE /api/data/concepts/:id
Server-authoritative concept delete. Body (optional): `{ expectedRevision }`.

Same transaction, in order: CAS → strip this id from other concepts'
`related` arrays → delete the main row → FTS / evidence / relations /
versions / category-derived cleanup → sync tombstone.
Repeat DELETE is idempotent when a tombstone already exists (no extra
tombstone). Never-existed ids return 404.

CAS mismatch returns 409
`{ code: "revision_conflict", expectedRevision, currentRevision }`.
Missing `expectedRevision` follows `COMPOUND_MUTATION_CAS_MODE`
(`log-only` default, or `enforce`).

### `/api/data/concepts/{id}/versions`

Source: [`app/api/data/concepts/[id]/versions/route.ts`](../app/api/data/concepts/[id]/versions/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 30            |
| Guards      | `admin-token` |

#### GET

GET /api/data/concepts/:id/versions
Returns AI-maintained edit history for a concept.

### `/api/data/concepts`

Source: [`app/api/data/concepts/route.ts`](../app/api/data/concepts/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 30            |
| Guards      | `admin-token` |

#### GET

GET /api/data/concepts?ids=c-1,c-2
Returns full concept documents for on-demand hydration.
Each concept includes `serverRevision` (monotonic server mutation token).

### `/api/data/snapshot`

Source: [`app/api/data/snapshot/route.ts`](../app/api/data/snapshot/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 30            |
| Guards      | `admin-token` |

#### GET

GET /api/data/snapshot
Returns a stable full snapshot or an incremental change delta after `?cursor=...`.
Full snapshots use `?beforeCursor=...` for stable pagination and return the
authoritative cursor that clients persist for the next pull.
Supports `?limit=N&offset=M` for pagination (defaults: limit=5000, offset=0).
Full snapshots paginate sources, concepts, activity, and ask with the same
offset/limit and expose `totalSources/totalConcepts/totalActivity/totalAsk`.
Full concept bodies / source raw content are fetched on demand by detail views
and heavy workflows such as ask / categorize.
Source and concept entities include `serverRevision`.

### `/api/data/sources`

Source: [`app/api/data/sources/route.ts`](../app/api/data/sources/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `GET`, `PATCH`                          |
| Runtime     | `nodejs`                                |
| maxDuration | 30                                      |
| Guards      | `admin-token`, `content-length-guarded` |

#### GET

GET /api/data/sources?ids=s-1,s-2
Returns full source documents for on-demand hydration.
Each source includes `serverRevision` (monotonic server mutation token).

#### PATCH

PATCH /api/data/sources
Updates a source document and recompiles retrieval artifacts for all
concepts backed by that source.
Body: `{ id, rawContent, title?, expectedRevision? }`.

CAS: `expectedRevision` is compared in the same transaction before any
index / activity / analysis-job side effects. Mismatch returns 409
`{ code: "revision_conflict", expectedRevision, currentRevision }`.
Missing `expectedRevision` follows `COMPOUND_MUTATION_CAS_MODE`
(`log-only` default, or `enforce`).

## health

### `/api/health/live`

Source: [`app/api/health/live/route.ts`](../app/api/health/live/route.ts)

| Field       | Value             |
| ----------- | ----------------- |
| Methods     | `GET`             |
| Runtime     | `nodejs`          |
| maxDuration | _unset_           |
| Guards      | _(none detected)_ |

#### GET

GET /api/health/live
Process liveness only. Does not inspect SQLite, volumes, or workers.

### `/api/health/ready`

Source: [`app/api/health/ready/route.ts`](../app/api/health/ready/route.ts)

| Field       | Value             |
| ----------- | ----------------- |
| Methods     | `GET`             |
| Runtime     | `nodejs`          |
| maxDuration | _unset_           |
| Guards      | _(none detected)_ |

#### GET

GET /api/health/ready
Readiness probe. Public body is `{ status, probe, identityAnchor }`, where
`identityAnchor` is `verified`, `unverified`, or `not_configured`. Detailed
failure reasons are written to internal structured logs, not the response.

Checks process liveness, SQLite readability, critical schema/meta, and that
DATA_DIR is writable. When COMPOUND_EXPECTED_DATASET_ID is configured, the
mounted dataset must match it. A missing backup directory is not a ready
failure. `not_configured` does not verify persistent-volume identity.

### `/api/health`

Source: [`app/api/health/route.ts`](../app/api/health/route.ts)

| Field       | Value             |
| ----------- | ----------------- |
| Methods     | `GET`             |
| Runtime     | `nodejs`          |
| maxDuration | _unset_           |
| Guards      | _(none detected)_ |

#### GET

Liveness / configuration probe. Returns `{ status: 'ok' }` publicly.
Detailed configuration info (auth, llm, embedding, githubSync, data) is
only returned when the request carries a valid admin token.

@returns 200 JSON with `status` and optionally detailed config.

## ingest

### `/api/ingest`

Source: [`app/api/ingest/route.ts`](../app/api/ingest/route.ts)

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Methods     | `POST`                                                  |
| Runtime     | `nodejs`                                                |
| maxDuration | 300                                                     |
| Guards      | `admin-token`, `rate-limited`, `content-length-guarded` |

#### POST

Ingest a raw source document (markdown, link, free text) and return the
extracted/updated concept set. Pipes the payload to the server-side LLM
ingest pipeline (`ingestSourceToServerDb`), which normalises categories,
stores the source row, and merges concepts into the SQLite-backed Wiki.

Body: `IngestRequest` — `source.rawContent` is required (<= 100k chars).
Optional `existingConcepts` (<= 500) hints the LLM about prior concepts.
Optional `operationId` is an idempotency key: same id and payload replay the
stored result; same id with a different payload returns 409.

Guards: admin token, LLM rate limit, 512KB body cap.

## lint

### `/api/lint`

Source: [`app/api/lint/route.ts`](../app/api/lint/route.ts)

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Methods     | `POST`                                                  |
| Runtime     | `nodejs`                                                |
| maxDuration | 90                                                      |
| Guards      | `admin-token`, `rate-limited`, `content-length-guarded` |

#### POST

Run an LLM-driven consistency lint over a snapshot of the Wiki concept
index. Produces `findings`: structured issues such as duplicate concepts,
orphaned relations, or category drift. Results are filtered so each
finding only references concept ids that exist in the request.

Body: `LintRequest` — `concepts: Array<{ id, title, summary, related }>`
(<= 500). An empty array short-circuits to `{ findings: [] }`.

Guards: admin token, LLM rate limit, 512KB body cap.

### `/api/lint/run`

Source: [`app/api/lint/run/route.ts`](../app/api/lint/run/route.ts)

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Methods     | `POST`                                                  |
| Runtime     | `nodejs`                                                |
| maxDuration | 30                                                      |
| Guards      | `admin-token`, `rate-limited`, `content-length-guarded` |

#### POST

Start an async deep-lint run. The server reads concepts from its own DB,
runs LLM analysis in the background, and stores findings. The client polls
GET /api/lint/status for progress and results.

No request body required — the server uses its own data. Optional `llmConfig`
overrides may be sent in headers or the JSON body for the initial worker.
Returns `{ runId, ok: true }`.

Guards: admin token, LLM rate limit, 16KB body cap.

### `/api/lint/status`

Source: [`app/api/lint/status/route.ts`](../app/api/lint/status/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | _unset_       |
| Guards      | `admin-token` |

#### GET

Poll the status of an async deep-lint run.

Query: `?runId=<id>`
Returns: `LintRunStatusResponse` with phase, findings, conceptCount, etc.

Also revives any pending lint runs that lost their worker (e.g. server restart).

Guards: admin token.

## metrics

### `/api/metrics`

Source: [`app/api/metrics/route.ts`](../app/api/metrics/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 10            |
| Guards      | `admin-token` |

#### GET

Prometheus-compatible metrics scrape endpoint. Exposes process memory/uptime,
HTTP request counters and latency histograms, plus sync, analysis,
review-queue, embedding, and knowledge-base gauges for external monitoring
systems such as Prometheus, Datadog, New Relic, or CloudWatch agents.

Guards: admin token.

## ops

### `/api/ops/model-runs`

Source: [`app/api/ops/model-runs/route.ts`](../app/api/ops/model-runs/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 10            |
| Guards      | `admin-token` |

#### GET

GET /api/ops/model-runs?days=14
Returns aggregated LLM run telemetry: token totals, provider-reported cost,
latency by model/task, daily spend, and recent failure markers.

## query

### `/api/query`

Source: [`app/api/query/route.ts`](../app/api/query/route.ts)

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Methods     | `POST`                                                  |
| Runtime     | `nodejs`                                                |
| maxDuration | 90                                                      |
| Guards      | `admin-token`, `rate-limited`, `content-length-guarded` |

#### POST

Answer a natural-language question against the user's Wiki using a
production-grade RAG pipeline:

1. history-aware query rewrite
2. hybrid retrieval (FTS5 BM25 + vector when configured)
3. concept graph 1-hop expansion via `concept_relations`
4. Reciprocal Rank Fusion across all retrievers
5. LLM-as-reranker → top-K
6. answer synthesis with citations (streaming when client opts in)
7. citation faithfulness check

Body: `QueryRequest` — `question` is required (<= 2k chars). Optional
`concepts` (<= 500) and `conversationHistory` (last 6 turns are kept).

Streaming: when the request includes `Accept: text/event-stream` the
response is an SSE stream. The stream emits:

- `event: stage` — pipeline progress: `{ key, status, detail?, conceptTitles? }`
- `event: delta` — incremental answer text fragments
- `event: done` — final JSON payload with citations, suggestedQuestions, etc.
  Otherwise a regular JSON response is returned (backward compatible).

Guards: admin token, LLM rate limit, 512KB body cap.

## repair

### `/api/repair/run`

Source: [`app/api/repair/run/route.ts`](../app/api/repair/run/route.ts)

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Methods     | `POST`                                                  |
| Runtime     | `nodejs`                                                |
| maxDuration | 30                                                      |
| Guards      | `admin-token`, `rate-limited`, `content-length-guarded` |

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/repair/run/route.ts` to document this endpoint._

### `/api/repair/status`

Source: [`app/api/repair/status/route.ts`](../app/api/repair/status/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | _unset_       |
| Guards      | `admin-token` |

#### GET

_No JSDoc comment found above the `GET` handler. Add a leading `/** ... */` block in `app/api/repair/status/route.ts` to document this endpoint._

## review

### `/api/review/queue/{id}`

Source: [`app/api/review/queue/[id]/route.ts`](../app/api/review/queue/[id]/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `POST`        |
| Runtime     | `nodejs`      |
| maxDuration | 10            |
| Guards      | `admin-token` |

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/review/queue/[id]/route.ts` to document this endpoint._

### `/api/review/queue`

Source: [`app/api/review/queue/route.ts`](../app/api/review/queue/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`, `POST` |
| Runtime     | `nodejs`      |
| maxDuration | 10            |
| Guards      | `admin-token` |

#### GET

_No JSDoc comment found above the `GET` handler. Add a leading `/** ... */` block in `app/api/review/queue/route.ts` to document this endpoint._

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/review/queue/route.ts` to document this endpoint._

## settings

### `/api/settings/models`

Source: [`app/api/settings/models/route.ts`](../app/api/settings/models/route.ts)

| Field       | Value                            |
| ----------- | -------------------------------- |
| Methods     | `GET`, `POST`, `PATCH`, `DELETE` |
| Runtime     | `nodejs`                         |
| maxDuration | _unset_                          |
| Guards      | `admin-token`                    |

#### GET

Return the cloud-backed model settings: custom model shortcuts, hidden preset
shortcuts, and the selected model override.

#### POST

Remember a custom model shortcut in the shared server-side settings history.

#### PATCH

Update shared model preferences, including the selected model or a hidden
preset shortcut.

#### DELETE

Remove a custom model shortcut from the shared server-side settings history.

## sync

### `/api/sync/cancel`

Source: [`app/api/sync/cancel/route.ts`](../app/api/sync/cancel/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `POST`        |
| Runtime     | `nodejs`      |
| maxDuration | 10            |
| Guards      | `admin-token` |

#### POST

Cancel the active GitHub sync run and cooperatively abort in-flight analysis
calls for that run. Queued and running analysis jobs are marked cancelled;
failed jobs remain retryable through `/api/sync/retry`.

### `/api/sync/cron/rescan`

Source: [`app/api/sync/cron/rescan/route.ts`](../app/api/sync/cron/rescan/route.ts)

| Field       | Value                       |
| ----------- | --------------------------- |
| Methods     | `GET`, `POST`               |
| Runtime     | `nodejs`                    |
| maxDuration | 30                          |
| Guards      | `admin-token`, `cron-token` |

#### GET

Incrementally re-scan GitHub. Designed to be invoked from a scheduler
(Vercel Cron, GitHub Actions, external uptime ping). Authenticates with
either `Authorization: Bearer ${CRON_SECRET}` or the standard admin
token. `GET` is reserved for cron-secret callers; admin-triggered POST may
opt into a full rebuild with `?force=true`.

#### POST

See {@link GET}. POST variant for schedulers that prefer non-idempotent verbs.

### `/api/sync/dashboard`

Source: [`app/api/sync/dashboard/route.ts`](../app/api/sync/dashboard/route.ts)

| Field       | Value                       |
| ----------- | --------------------------- |
| Methods     | `GET`                       |
| Runtime     | `nodejs`                    |
| maxDuration | 10                          |
| Guards      | `admin-token`, `cron-token` |

#### GET

Aggregate dashboard payload for the `/sync` page. Starts the analysis
worker on-demand, then returns the live sync observability snapshot
merged with embedding coverage and review-queue metrics, plus the
`story` block (narrative / phases / health / lastRun) used by the
V3 console for a single-glance summary.

Guards: admin token.

### `/api/sync/dlq`

Source: [`app/api/sync/dlq/route.ts`](../app/api/sync/dlq/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `POST`                                  |
| Runtime     | `nodejs`                                |
| maxDuration | 10                                      |
| Guards      | `admin-token`, `content-length-guarded` |

#### POST

Retry or delete one analysis dead-letter job from the `/sync` advanced
drawer.

Guards: admin token.

### `/api/sync/github/content`

Source: [`app/api/sync/github/content/route.ts`](../app/api/sync/github/content/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `POST`                                  |
| Runtime     | `nodejs`                                |
| maxDuration | 30                                      |
| Guards      | `admin-token`, `content-length-guarded` |

#### POST

POST /api/sync/github/content
Body: { path: string }
Returns the raw Markdown content of a single file from the configured repo.

Uses POST (not GET) so that paths containing special characters
do not have to be URL-encoded by the client.

### `/api/sync/github/list`

Source: [`app/api/sync/github/list/route.ts`](../app/api/sync/github/list/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 30            |
| Guards      | `admin-token` |

#### GET

GET /api/sync/github/list
Returns every Markdown file (path + sha + size) in the configured GitHub repo.
The client uses this list to diff against its local Sources and decide what to ingest.

### `/api/sync/github/run`

Source: [`app/api/sync/github/run/route.ts`](../app/api/sync/github/run/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `POST`        |
| Runtime     | `nodejs`      |
| maxDuration | 30            |
| Guards      | `admin-token` |

#### POST

POST /api/sync/github/run
Starts a server-side GitHub → SQLite sync job and returns the job id.
The actual work runs in the background; client polls `/api/sync/status`.

### `/api/sync/github/webhook`

Source: [`app/api/sync/github/webhook/route.ts`](../app/api/sync/github/webhook/route.ts)

| Field       | Value               |
| ----------- | ------------------- |
| Methods     | `POST`              |
| Runtime     | `nodejs`            |
| maxDuration | 30                  |
| Guards      | `webhook-signature` |

#### POST

GitHub `push` webhook receiver. Verifies the `x-hub-signature-256` HMAC
against `GITHUB_WEBHOOK_SECRET`, ignores unrelated events, replies to
`ping` events with `{ ok: true }`, and otherwise persists the delivery
into the durable webhook inbox in the same transaction before ACK.
Duplicate `X-GitHub-Delivery` values are idempotent. A delivery that
arrives while another sync is running stays queued until that job
finishes or boot recovery drains the inbox. Returns `jobId`, `existing`,
and `queued`.

Guards: IP rate limit (before HMAC), HMAC SHA-256 signature (no admin
token; webhooks are anonymous), body size limit.

### `/api/sync/retry`

Source: [`app/api/sync/retry/route.ts`](../app/api/sync/retry/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `POST`                                  |
| Runtime     | `nodejs`                                |
| maxDuration | 10                                      |
| Guards      | `admin-token`, `content-length-guarded` |

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/sync/retry/route.ts` to document this endpoint._

### `/api/sync/run`

Source: [`app/api/sync/run/route.ts`](../app/api/sync/run/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `POST`                                  |
| Runtime     | `nodejs`                                |
| maxDuration | 30                                      |
| Guards      | `admin-token`, `content-length-guarded` |

#### POST

POST /api/sync/run

One-button entrypoint used by the V3 console. Delegates to the existing
primitives so the user does not have to choose between "sync" / "worker" /
"retry":

1. start a new GitHub sync run (or wake the existing one)
2. retry any previously failed analysis jobs
3. wake the analysis worker

The legacy `/api/sync/github/run`, `/api/sync/worker`, and `/api/sync/retry`
routes stay around so the advanced drawer can still trigger them
individually.

Guards: admin token + sync rate-limit.

### `/api/sync/status`

Source: [`app/api/sync/status/route.ts`](../app/api/sync/status/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 10            |
| Guards      | `admin-token` |

#### GET

GET /api/sync/status?jobId=xxx
Returns the latest status for a sync job (polled by the client every 1-2s).

### `/api/sync/worker`

Source: [`app/api/sync/worker/route.ts`](../app/api/sync/worker/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`, `POST` |
| Runtime     | `nodejs`      |
| maxDuration | 30            |
| Guards      | `admin-token` |

#### GET

Deprecated read path. Worker execution mutates queue state, so callers must
use POST instead of accidentally triggering work through a link prefetch.

#### POST

Start the background analysis worker for queued ingest / embedding /
summarize / relation jobs. Requires the standard admin token.

## wiki

### `/api/wiki/category`

Source: [`app/api/wiki/category/route.ts`](../app/api/wiki/category/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `GET`, `POST`                           |
| Runtime     | `nodejs`                                |
| maxDuration | 60                                      |
| Guards      | `admin-token`, `content-length-guarded` |

#### GET

GET /api/wiki/category?primary=X&secondary=Y
Returns cached category wiki if available.

#### POST

POST /api/wiki/category
Creates a category wiki generation run and returns the run info.

### `/api/wiki/category/runs/{id}`

Source: [`app/api/wiki/category/runs/[id]/route.ts`](../app/api/wiki/category/runs/[id]/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | _unset_       |
| Guards      | `admin-token` |

#### GET

GET /api/wiki/category/runs/:id
Returns the status of a category wiki generation run.

### `/api/wiki/category/runs`

Source: [`app/api/wiki/category/runs/route.ts`](../app/api/wiki/category/runs/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | _unset_       |
| Guards      | `admin-token` |

#### GET

GET /api/wiki/category/runs?primary=X&secondary=Y&limit=20
Returns the most recent generation runs for a category wiki, used to render
the update-history list at the bottom of the wiki detail page.

### `/api/wiki/export`

Source: [`app/api/wiki/export/route.ts`](../app/api/wiki/export/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 120           |
| Guards      | `admin-token` |

#### GET

GET /api/wiki/export
Export the current Wiki as Markdown files plus graph/topic JSON. The payload
`{ ok, files: [{ path, content }] }` can be downloaded from Data settings
and re-imported via `/api/wiki/import`.

Guards: admin token.

### `/api/wiki/health`

Source: [`app/api/wiki/health/route.ts`](../app/api/wiki/health/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | _unset_       |
| Guards      | `admin-token` |

#### GET

_No JSDoc comment found above the `GET` handler. Add a leading `/** ... */` block in `app/api/wiki/health/route.ts` to document this endpoint._

### `/api/wiki/import`

Source: [`app/api/wiki/import/route.ts`](../app/api/wiki/import/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `POST`                                  |
| Runtime     | `nodejs`                                |
| maxDuration | 60                                      |
| Guards      | `admin-token`, `content-length-guarded` |

#### POST

Import Markdown files previously produced by `/api/wiki/export`. The import
updates existing concept pages by `frontmatter.id`, records versions, and
rebuilds FTS/relation artifacts. Body: `{ files, dryRun? }`.

### `/api/wiki/rebuild-index`

Source: [`app/api/wiki/rebuild-index/route.ts`](../app/api/wiki/rebuild-index/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `POST`        |
| Runtime     | `nodejs`      |
| maxDuration | 300           |
| Guards      | `admin-token` |

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/wiki/rebuild-index/route.ts` to document this endpoint._

### `/api/wiki/search`

Source: [`app/api/wiki/search/route.ts`](../app/api/wiki/search/route.ts)

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Methods     | `POST`                                  |
| Runtime     | `nodejs`                                |
| maxDuration | _unset_                                 |
| Guards      | `admin-token`, `content-length-guarded` |

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/wiki/search/route.ts` to document this endpoint._

### `/api/wiki/topics`

Source: [`app/api/wiki/topics/route.ts`](../app/api/wiki/topics/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 10            |
| Guards      | `admin-token` |

#### GET

GET /api/wiki/topics?limit=50
Returns lightweight topic/community summaries derived from source analysis
topics and entities, with related concept candidates for each topic.

---

_This file is regenerated on every CI run. If it is ever out of sync with the route handlers, the `docs:api:check` step will fail and surface the drift._
