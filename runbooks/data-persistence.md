# SQLite data persistence

Use this when data disappears after deploys, writes fail, or SQLite state looks
out of sync with the UI.

## Impact

- Concepts or sources disappear after a restart.
- GitHub sync repeats already-ingested files.
- API routes return 5xx around SQLite writes.
- `/api/health` reports missing or suspicious persistence configuration.

## Check

1. Confirm `DATA_DIR` is set in production and points to a mounted persistent
   volume, usually `/data`.
2. Confirm the deployment platform mounts the same volume across restarts.
3. Check deployment logs for SQLite open, migration, disk, or permission
   errors.
4. Check free disk space and write permissions on the mounted directory.
5. Compare browser cache behavior with server state. IndexedDB can make old
   content visible locally even when the server database is missing data.

## Recovery

1. Stop repeated restarts if the volume is misconfigured. More restarts can make
   diagnosis harder.
2. Fix `DATA_DIR` and volume mount configuration before triggering new syncs.
3. Restart the service once the volume is attached.
4. If the database file exists but writes fail, inspect permissions and disk
   space before changing application code.
5. If the database is empty because the volume was never attached, restore from
   backup or run GitHub sync again after confirming the correct volume is
   mounted.

## Verify

- `DATA_DIR` is present in `/api/health` output.
- New concepts survive a service restart.
- GitHub sync does not re-ingest unchanged files unexpectedly.
- `/sync` and `/review` state remains stable after reloads.

## Escalate

Escalate before deleting, replacing, or manually editing `compound.db`. Capture
a backup copy first whenever possible.
