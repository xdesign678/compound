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
5. If the database is empty because the volume was never attached, restore a
   verified backup before considering a GitHub rescan.

## Backup

Run the online SQLite backup while the service is healthy:

```bash
DATA_DIR=/data COMPOUND_BACKUP_DIR=/data/backups npm run backup
```

The command uses SQLite's online backup API, runs `PRAGMA quick_check`, writes a
SHA-256 metadata file next to the snapshot, and keeps the newest 14 snapshots by
default. Set `COMPOUND_BACKUP_KEEP` to change retention. The backup directory
must be replicated outside the application volume; a snapshot on the same
failed disk is not a disaster-recovery backup.

Schedule the command from the deployment platform at least daily. For a private
knowledge base, the operational target is RPO 24 hours or less and RTO 2 hours
or less unless the owner chooses stricter values.

## Restore

1. Stop the Compound service so no process holds `compound.db`.
2. Attach the correct persistent volume and place the selected `.db` snapshot
   plus its `.json` checksum metadata on the host.
3. Restore explicitly:

   ```bash
   DATA_DIR=/data npm run restore -- --from /data/backups/compound-<timestamp>.db --force
   ```

4. The restore command validates the source checksum and SQLite integrity,
   creates a safety snapshot of the current target when it exists, swaps the
   restored database atomically, and runs foreign-key checks.
5. Start the service and complete the verification checklist below.

Never restore into a running container. Never copy `compound.db` together with
stale `-wal` or `-shm` files.

## Drill

`npm run backup:drill` creates an isolated database, backs it up, restores it to
another directory, and verifies a marker row. CI runs this non-destructive drill.
Production owners should additionally perform a quarterly restore of a real
encrypted snapshot into an isolated environment and record the result below.

## Verify

- `DATA_DIR` is present in `/api/health` output.
- New concepts survive a service restart.
- GitHub sync does not re-ingest unchanged files unexpectedly.
- `/sync` and `/review` state remains stable after reloads.
- `PRAGMA quick_check` returns `ok` and `PRAGMA foreign_key_check` returns no rows.
- The newest off-volume backup exists and its checksum metadata matches.

## Escalate

Escalate before deleting, replacing, or manually editing `compound.db`. Capture
a backup copy first whenever possible.

## 演练记录

| 日期       | 演练人 | 触发情境（真实 / 演练） | 用时     | 备注                                        |
| ---------- | ------ | ----------------------- | -------- | ------------------------------------------- |
| 2026-07-18 | Codex  | 隔离自动演练            | < 1 分钟 | `npm run backup:drill` 通过；不含生产卷恢复 |
