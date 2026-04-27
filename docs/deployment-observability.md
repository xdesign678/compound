# Deployment observability

This runbook explains where to check the impact of a Compound deploy while it is
rolling out and during the first minutes after it is live.

## Primary deploy surfaces

| Surface                  | Link                                                                                                                                                                                                                   | What to check                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Zeabur service dashboard | [Zeabur Projects](https://dash.zeabur.com/projects)                                                                                                                                                                    | Latest deployment status, build logs, runtime logs, restart count, CPU, memory, and volume mount health.                              |
| GitHub Actions           | Repository **Actions** tab                                                                                                                                                                                             | `check`, Docker build, API docs generation, build metrics artifact, and code quality artifact for the commit being deployed.          |
| Sentry                   | [Sentry Issues](https://sentry.io/issues/) and [Sentry Performance](https://sentry.io/performance/)                                                                                                                    | New errors, request traces, source-mapped stack traces, and release-specific regressions for `SENTRY_RELEASE`.                        |
| Prometheus / Grafana     | Scrape `GET /api/metrics` with an admin token, then graph it in [Grafana dashboards](https://grafana.com/docs/grafana/latest/dashboards/)                                                                              | HTTP 5xx rate, p95 route latency, process memory, uptime, sync failures, analysis backlog, embedding fallback, and review queue size. |
| Datadog / New Relic      | Feed `/api/metrics` through [Datadog OpenMetrics](https://docs.datadoghq.com/integrations/openmetrics/) or [New Relic Prometheus integrations](https://docs.newrelic.com/docs/infrastructure/prometheus-integrations/) | Same deploy health panels as Grafana when those vendors are used instead of a Prometheus stack.                                       |
| Compound runtime UI      | `/sync`, `/review`, `/api/health`, `/api/wiki/health`                                                                                                                                                                  | GitHub sync progress, failed files, analysis worker state, review queue pressure, app readiness, and Wiki index coverage.             |

## Deploy notification channel

Production deploy notifications should go to the team Slack channel that owns
Compound operations.

Use Zeabur project notifications when the service is deployed by Zeabur. If the
deploy later moves into GitHub Actions, use a repository secret named
`SLACK_WEBHOOK_URL` and send the same payload through a Slack incoming webhook:
[Slack incoming webhooks](https://api.slack.com/messaging/webhooks).

Each deploy notification should include:

- environment (`production` or `staging`)
- git commit SHA and author
- deployment URL
- Zeabur deployment URL or GitHub Actions run URL
- `/api/health` status
- `/sync` link for background sync impact
- Sentry release link when `SENTRY_RELEASE` is set

## First 15 minutes after deploy

1. Open the Zeabur service dashboard and confirm the latest deploy is running,
   not restarting, and has the expected persistent volume mounted at `/data`.
2. Call `GET /api/health`. A healthy production response should include
   `status: "ok"`, admin auth configured, LLM configured, and `DATA_DIR`
   configured.
3. Open Sentry filtered to the release or deploy time window. Treat new
   `global-error`, request, or gateway errors as deploy blockers.
4. Check the metrics dashboard for `compound_http_requests_total` 5xx growth,
   p95 latency movement, memory growth, and process uptime resets.
5. Open `/sync`. Confirm no sync run is stuck in `failed`, the analysis queue is
   draining, and new GitHub webhook or cron-triggered runs are visible.
6. Open `/review` if the deploy touched analysis, repair, categorization, or
   embedding code. A sudden queue spike means the deploy changed extraction
   quality and needs human review.

## Minimum dashboard panels

Any Grafana, Datadog, or New Relic dashboard for this service should include at
least these panels:

- `compound_http_requests_total` grouped by `status` and `route`
- `compound_http_request_duration_seconds` p95 grouped by `route`
- `compound_process_uptime_seconds`
- `compound_process_memory_bytes`
- `compound_sync_active_run`
- `compound_sync_run_files` grouped by `state`
- `compound_sync_errors` grouped by `error`
- `compound_analysis_jobs` grouped by `stage` and `status`
- review queue size from the `/api/metrics` review collector
- embedding provider/fallback metrics from the `/api/metrics` embedding collector

## Alert thresholds

Start with these alerts and tune them after a week of production data:

- Any sustained 5xx rate above 1% for 5 minutes.
- p95 latency above 2 seconds for normal page/API requests.
- process uptime resets more than twice in 10 minutes.
- any sync run stuck for more than 15 minutes.
- any `compound_sync_errors` value that increases after a deploy.
- review queue size doubling within 30 minutes of a deploy.
- Sentry issue count for the new release higher than the previous release.

## Required deploy-time environment

The observability path depends on these variables being set in the deployment
environment:

- `COMPOUND_ADMIN_TOKEN` or `ADMIN_TOKEN`: required to call protected metrics.
- `DATA_DIR=/data`: lets health checks prove the SQLite volume is configured.
- `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`: enable Sentry error tracking.
- `SENTRY_RELEASE`: set to the git SHA being deployed so Sentry can group errors
  by release.
- `SENTRY_ENVIRONMENT`: `production`, `staging`, or `development`.
