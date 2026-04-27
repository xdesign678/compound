# Compound runbooks

These runbooks are the first stop when Compound is degraded in production or a
background job appears stuck. They are intentionally operational: each page
starts with impact, signals to check, and a safe recovery path.

## First five minutes

1. Confirm user impact: can the app load, can authenticated API calls succeed,
   and is GitHub sync or question answering blocked?
2. Check the unauthenticated health endpoint:

   ```bash
   curl -i "$APP_URL/api/health"
   ```

3. Check authenticated operational surfaces with the admin token:

   ```bash
   curl -H "Authorization: Bearer $COMPOUND_ADMIN_TOKEN" "$APP_URL/api/metrics"
   curl -H "Authorization: Bearer $COMPOUND_ADMIN_TOKEN" "$APP_URL/api/sync/dashboard"
   ```

4. Inspect deployment logs for structured events such as
   `sync.github.run.failed`, `sync.status.failed`, `wiki.health_failed`,
   `gateway_*`, or middleware 503 responses.
5. Pick the narrowest runbook below and record what changed, when it changed,
   and which recovery action was taken.

## Severity guide

| Severity | User impact                                               | Examples                                                                      | Target response                                                                             |
| -------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| SEV1     | Most users cannot open the app or private data is at risk | Production 503 loop, missing auth protection, persistent data volume detached | Start immediately, keep a written timeline, do not make risky data changes without a backup |
| SEV2     | Core workflows are unavailable                            | GitHub sync stuck, LLM answers failing, SQLite write failures                 | Triage within one hour, restore service before root-cause cleanup                           |
| SEV3     | Degraded but usable                                       | Slow sync, partial review queue backlog, intermittent model failures          | Triage during the same working day                                                          |

## Available playbooks

| Runbook                                                  | Use when                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [General incident response](incident-response.md)        | You need a structured triage loop before choosing a specific fix.                                  |
| [Production 503 or auth lockout](production-503-auth.md) | The app returns 503 in production, the login prompt is confusing, or protected API calls fail.     |
| [GitHub sync stuck or failing](github-sync-stuck.md)     | `/sync` is red, a job never finishes, GitHub returns 401/403/429, or files do not appear.          |
| [LLM gateway degraded](llm-gateway-degraded.md)          | Ingest, analysis, repair, or Q&A fails because the model endpoint is unavailable or misconfigured. |
| [SQLite data persistence](data-persistence.md)           | Data disappears after deploys, writes fail, or `DATA_DIR` / volume configuration is suspect.       |

## Handoff template

```text
Incident:
Severity:
Started at:
User impact:
Current status:
Last known good deploy/config:
Signals checked:
Actions taken:
Remaining risk:
Next owner:
```

## Related docs

- [README deployment notes](../README.md#deployment-notes)
- [Architecture and failure table](../docs/architecture.md#7-故障与回退路径)
- [HTTP API reference](../docs/api-reference.md)
