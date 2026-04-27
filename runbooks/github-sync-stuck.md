# GitHub sync stuck or failing

Use this when Markdown files from the configured GitHub repository are not
appearing, `/sync` shows failures, or a sync run never completes.

## Impact

- New or edited Markdown files do not appear in Compound.
- `/sync` shows a red run, repeated file failures, or a worker that is not
  making progress.
- Analysis jobs are queued but concepts are not updated.

## Check

1. Open `/sync` and identify the active run, failed file, and current stage.
2. Query the dashboard:

   ```bash
   curl -H "Authorization: Bearer $COMPOUND_ADMIN_TOKEN" "$APP_URL/api/sync/dashboard"
   ```

3. If you have a job id, check the legacy status endpoint:

   ```bash
   curl -H "Authorization: Bearer $COMPOUND_ADMIN_TOKEN" "$APP_URL/api/sync/status?jobId=$JOB_ID"
   ```

4. Review deployment logs for:
   - `sync.github.started`
   - `sync.github.run.failed`
   - `sync.dashboard.failed`
   - GitHub HTTP statuses such as 401, 403, 404, or 429.
5. Confirm configuration:
   - `GITHUB_REPO` points to the intended repository.
   - `GITHUB_TOKEN` is a fine-grained token with Repository Contents read
     access.
   - `GITHUB_BRANCH` matches the source branch.
   - `GITHUB_WEBHOOK_SECRET` matches the GitHub webhook secret, if webhooks are
     enabled.

## Recovery

1. If a run is active but clearly stale, cancel it from `/sync` or call the
   cancel endpoint through the app UI.
2. Fix configuration before retrying. Repeated retries with a bad token will
   only create more failed rows.
3. Start a new sync from `/sync`.
4. If webhooks are broken but manual sync works, disable webhook assumptions and
   use manual sync or cron rescan until the secret is corrected.
5. If GitHub returns 429, wait for the rate-limit window or reduce sync
   frequency before retrying.

## Verify

- `/sync` shows the run moving through fetch, ingest, analysis, and indexing.
- Failed file count returns to zero or only known bad files remain.
- The expected source appears in the library.
- `/review` contains only intentional low-confidence items, not a flood caused
  by the incident.

## Escalate

Escalate before manually editing SQLite sync tables. The runner stores run and
file state in SQLite; direct edits can make the UI disagree with worker state.
