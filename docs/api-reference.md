<!-- AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
     Run `npm run docs:api` (scripts/generate-api-docs.mjs) to regenerate.
     Source of truth: app/api/**/route.ts -->

# Compound HTTP API reference

This document is generated automatically from the Next.js Route Handlers under `app/api/**/route.ts`. It enumerates every public HTTP endpoint, the methods it implements, runtime hints, and obvious security guards (admin token, rate limit, payload size, webhook signatures).

- Routes: **29**
- Handlers (HTTP methods): **34**
- Generator: `scripts/generate-api-docs.mjs`

## Table of contents

- **categorize**
  - [`/api/categorize`](#api-categorize)
- **data**
  - [`/api/data/concepts`](#api-data-concepts)
  - [`/api/data/snapshot`](#api-data-snapshot)
  - [`/api/data/sources`](#api-data-sources)
- **health**
  - [`/api/health`](#api-health)
- **ingest**
  - [`/api/ingest`](#api-ingest)
- **lint**
  - [`/api/lint`](#api-lint)
- **metrics**
  - [`/api/metrics`](#api-metrics)
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
  - [`/api/sync/github/content`](#api-sync-github-content)
  - [`/api/sync/github/list`](#api-sync-github-list)
  - [`/api/sync/github/run`](#api-sync-github-run)
  - [`/api/sync/github/webhook`](#api-sync-github-webhook)
  - [`/api/sync/retry`](#api-sync-retry)
  - [`/api/sync/run`](#api-sync-run)
  - [`/api/sync/status`](#api-sync-status)
  - [`/api/sync/worker`](#api-sync-worker)
- **wiki**
  - [`/api/wiki/export`](#api-wiki-export)
  - [`/api/wiki/health`](#api-wiki-health)
  - [`/api/wiki/rebuild-index`](#api-wiki-rebuild-index)
  - [`/api/wiki/search`](#api-wiki-search)

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

## data

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
Returns either the summary dataset or an incremental delta since `?since=...`.
Full concept bodies / source raw content are fetched on demand by detail views
and heavy workflows such as ask / categorize.

### `/api/data/sources`

Source: [`app/api/data/sources/route.ts`](../app/api/data/sources/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 30            |
| Guards      | `admin-token` |

#### GET

GET /api/data/sources?ids=s-1,s-2
Returns full source documents for on-demand hydration.

## health

### `/api/health`

Source: [`app/api/health/route.ts`](../app/api/health/route.ts)

| Field       | Value             |
| ----------- | ----------------- |
| Methods     | `GET`             |
| Runtime     | `nodejs`          |
| maxDuration | _unset_           |
| Guards      | _(none detected)_ |

#### GET

Liveness / configuration probe. Returns `{ status: 'ok' }` along with
boolean flags describing whether admin auth, the LLM gateway, GitHub sync,
and the persistent data directory are configured. Safe to call without
authentication so platform health checks (Docker, Kubernetes, uptime
monitors) can use it as a readiness signal.

@returns 200 JSON with `status`, `service`, `auth`, `llm`, `githubSync`, `data`.

## ingest

### `/api/ingest`

Source: [`app/api/ingest/route.ts`](../app/api/ingest/route.ts)

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Methods     | `POST`                                                  |
| Runtime     | `nodejs`                                                |
| maxDuration | 150                                                     |
| Guards      | `admin-token`, `rate-limited`, `content-length-guarded` |

#### POST

Ingest a raw source document (markdown, link, free text) and return the
extracted/updated concept set. Pipes the payload to the server-side LLM
ingest pipeline (`ingestSourceToServerDb`), which normalises categories,
stores the source row, and merges concepts into the SQLite-backed Wiki.

Body: `IngestRequest` — `source.rawContent` is required (<= 100k chars).
Optional `existingConcepts` (<= 500) hints the LLM about prior concepts.

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

Answer a natural-language question against the user's Wiki. Performs
hybrid retrieval (FTS + embeddings, with FTS-only fallback) to assemble
a context window from concept pages and source chunks, then asks the LLM
for a structured JSON response (`QueryResponse`).

Body: `QueryRequest` — `question` is required (<= 2k chars). Optional
`concepts` (<= 500) and `conversationHistory` (last 6 turns are kept).

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

| Field       | Value                   |
| ----------- | ----------------------- |
| Methods     | `GET`, `POST`, `DELETE` |
| Runtime     | `nodejs`                |
| maxDuration | _unset_                 |
| Guards      | `admin-token`           |

#### GET

_No JSDoc comment found above the `GET` handler. Add a leading `/** ... */` block in `app/api/settings/models/route.ts` to document this endpoint._

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/settings/models/route.ts` to document this endpoint._

#### DELETE

_No JSDoc comment found above the `DELETE` handler. Add a leading `/** ... */` block in `app/api/settings/models/route.ts` to document this endpoint._

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

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/sync/cancel/route.ts` to document this endpoint._

### `/api/sync/cron/rescan`

Source: [`app/api/sync/cron/rescan/route.ts`](../app/api/sync/cron/rescan/route.ts)

| Field       | Value                       |
| ----------- | --------------------------- |
| Methods     | `GET`, `POST`               |
| Runtime     | `nodejs`                    |
| maxDuration | 30                          |
| Guards      | `admin-token`, `cron-token` |

#### GET

Force a full GitHub re-scan. Designed to be invoked from a scheduler
(Vercel Cron, GitHub Actions, external uptime ping). Authenticates with
either `Authorization: Bearer ${CRON_SECRET}` or the standard admin
token. Both `GET` and `POST` are accepted to fit different schedulers.

#### POST

See {@link GET}. POST variant for schedulers that prefer non-idempotent verbs.

### `/api/sync/dashboard`

Source: [`app/api/sync/dashboard/route.ts`](../app/api/sync/dashboard/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 10            |
| Guards      | `admin-token` |

#### GET

Aggregate dashboard payload for the `/sync` page. Starts the analysis
worker on-demand, then returns the live sync observability snapshot
merged with embedding coverage and review-queue metrics, plus the
`story` block (narrative / phases / health / lastRun) used by the
V3 console for a single-glance summary.

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
`ping` events with `{ ok: true }`, and otherwise enqueues a webhook-
triggered sync via `startGithubSync`. Returns the resulting `jobId` and
an `existing` flag indicating whether a job was already running.

Guards: HMAC SHA-256 signature (no admin token; webhooks are anonymous).

### `/api/sync/retry`

Source: [`app/api/sync/retry/route.ts`](../app/api/sync/retry/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `POST`        |
| Runtime     | `nodejs`      |
| maxDuration | 10            |
| Guards      | `admin-token` |

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/sync/retry/route.ts` to document this endpoint._

### `/api/sync/run`

Source: [`app/api/sync/run/route.ts`](../app/api/sync/run/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `POST`        |
| Runtime     | `nodejs`      |
| maxDuration | 30            |
| Guards      | `admin-token` |

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

_No JSDoc comment found above the `GET` handler. Add a leading `/** ... */` block in `app/api/sync/worker/route.ts` to document this endpoint._

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/sync/worker/route.ts` to document this endpoint._

## wiki

### `/api/wiki/export`

Source: [`app/api/wiki/export/route.ts`](../app/api/wiki/export/route.ts)

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `GET`         |
| Runtime     | `nodejs`      |
| maxDuration | 120           |
| Guards      | `admin-token` |

#### GET

_No JSDoc comment found above the `GET` handler. Add a leading `/** ... */` block in `app/api/wiki/export/route.ts` to document this endpoint._

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

| Field       | Value         |
| ----------- | ------------- |
| Methods     | `POST`        |
| Runtime     | `nodejs`      |
| maxDuration | _unset_       |
| Guards      | `admin-token` |

#### POST

_No JSDoc comment found above the `POST` handler. Add a leading `/** ... */` block in `app/api/wiki/search/route.ts` to document this endpoint._

---

_This file is regenerated on every CI run. If it is ever out of sync with the route handlers, the `docs:api:check` step will fail and surface the drift._
