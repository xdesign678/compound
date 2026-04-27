# General incident response

Use this when the symptom is unclear or multiple systems look unhealthy.

## Goals

- Protect private knowledge first: do not expose the app publicly without
  `COMPOUND_ADMIN_TOKEN` or `ADMIN_TOKEN`.
- Restore the smallest working path before broad cleanup.
- Preserve evidence: timestamps, deploy ids, config changes, and the first real
  error message.

## Triage loop

1. Classify the impact.
   - App does not load: start with `production-503-auth.md` and deployment logs.
   - App loads but content is stale: start with `github-sync-stuck.md`.
   - App loads but LLM features fail: start with `llm-gateway-degraded.md`.
   - Data disappeared or writes fail: start with `data-persistence.md`.
2. Check health and metrics.

   ```bash
   curl -i "$APP_URL/api/health"
   curl -H "Authorization: Bearer $COMPOUND_ADMIN_TOKEN" "$APP_URL/api/metrics"
   ```

3. Check the user-facing operational pages:
   - `/sync` for sync run state, file failures, analysis worker state, retry and
     cancel controls.
   - `/review` for low-confidence or large-change items waiting for human
     approval.
4. Compare the current deploy/config with the last known good state.
   - `COMPOUND_ADMIN_TOKEN` / `ADMIN_TOKEN`
   - `DATA_DIR`
   - `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`
   - `GITHUB_REPO`, `GITHUB_TOKEN`, `GITHUB_BRANCH`
   - `GITHUB_WEBHOOK_SECRET`, `CRON_SECRET`
5. Take the least destructive recovery action first. Prefer retry, cancel,
   config correction, or restart over data deletion.

## Evidence to capture

- Exact user symptom and URL.
- First failing HTTP status and response body preview.
- Relevant structured log event names.
- Current deploy id or commit sha.
- Whether the issue reproduces after a fresh authenticated request.

## When to escalate

Escalate if any of these are true:

- Auth protection is missing or the admin token was leaked.
- SQLite volume may be detached, overwritten, or corrupted.
- Recovery requires manually editing production SQLite data.
- A rollback would lose newly ingested notes.
