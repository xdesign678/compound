# Compound alerting

Compound exposes Prometheus-compatible metrics at `/api/metrics` and liveness
data at `/api/health`. Alert definitions live in
`ops/alerting/compound-alerts.json`; the Prometheus rule file generated from
those definitions is `ops/alerting/prometheus-rules.yml`.

## Scrape configuration

Scrape `/api/metrics` with the same admin token used for the application:

```yaml
scrape_configs:
  - job_name: compound
    metrics_path: /api/metrics
    scheme: https
    authorization:
      type: Bearer
      credentials: ${COMPOUND_ADMIN_TOKEN}
    static_configs:
      - targets:
          - your-compound-host.example.com
```

Load `ops/alerting/prometheus-rules.yml` through the Prometheus `rule_files`
setting and route `severity="critical"` to the primary on-call target. Route
`severity="warning"` to a lower-urgency channel that is still reviewed daily.

## Editing rules

Edit `ops/alerting/compound-alerts.json`, then run:

```bash
npm run alerts:generate
npm run alerts:check
```

`npm run alerts:check` validates that every rule has a severity, team label,
human summary, detailed description, runbook link, and an expression tied to the
Compound scrape target or `compound_*` metrics.

## Runbooks

### CompoundServiceDown

Check whether the hosting platform can reach the app and whether `/api/health`
returns `200`. If the health endpoint is down, inspect the latest deployment,
container logs, and required production variables such as `COMPOUND_ADMIN_TOKEN`
and `DATA_DIR`.

### CompoundApiHighErrorRate

Start from the first route returning 5xx in application logs or Sentry. Common
causes are database access failures, missing production secrets, failed LLM
gateway calls, or sync worker exceptions.

### CompoundApiP95LatencyHigh

Check whether sync, analysis, or review queue work is running at the same time.
If latency is concentrated on one route, inspect its Sentry trace and database
work before changing infrastructure size.

### CompoundSyncFailuresDetected

Open `/sync`, read the failed item errors, and confirm whether the failures are
GitHub access, markdown ingestion, analysis, or embedding related. Retry after
the underlying issue is clear.

### CompoundMetricsCollectionFailure

Open `/api/metrics` with an admin token and find the
`compound_metrics_collection_error` collector label. Fix the failing collector
before trusting alerts that depend on sync, review, embedding, or coverage
metrics.

### CompoundReviewBacklogHigh

Open `/review`, triage stale items, and check whether a recent sync imported a
large document batch. A high queue is not usually an outage, but it means the
knowledge base is waiting for human review.
