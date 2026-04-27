---
name: server-db-migration
description: Add or modify a SQLite schema element in lib/server-db.ts or lib/wiki-db.ts. Use this skill when the user asks to add a column, table, index, or FTS structure to the better-sqlite3 store, or when an existing query needs schema-level support in the Compound codebase.
---

# Evolve the better-sqlite3 schema safely

Compound persists its server-side state in a single SQLite database
opened by `lib/server-db.ts` (concepts, sources, activity log) and
`lib/wiki-db.ts` (wiki chunks, evidence, FTS, embeddings). Both files
follow an idempotent, additive migration pattern: schema is created via
`CREATE ... IF NOT EXISTS` and altered via `try { ALTER ... } catch {}`
guarded by a runtime probe of `PRAGMA table_info(...)`.

## When to use this skill

- The user requests a new column on an existing table.
- A new feature needs an entirely new table or index.
- An existing FTS5 virtual table needs to track a new column.
- You see a SQL exception like `no such column` or
  `no such table` at runtime in dev.

## Hard rules

1. **Never write a destructive migration.** No `DROP TABLE`, no
   `DROP COLUMN`, no `DELETE FROM` in migration code. Existing
   deployments back the file with persistent volumes (`DATA_DIR`); a
   destructive change is irreversible.
2. **Migrations must be idempotent.** They run on every cold start of
   the singleton in `getHolder()` (see the `globalKey` pattern).
3. **All schema work happens in the migration block.** Do not run
   `ALTER` from request handlers. The migration must be in
   `runMigrations(db)` (server-db) or in the `ensureMigrations()` /
   `ensureFts()` helpers in `wiki-db.ts`.
4. **Type changes go through `types.ts`.** Update `lib/types.ts` (or
   the local `Concept`/`Source` interfaces in `wiki-db.ts`) so the
   TypeScript layer matches the new column.

## Adding a column to an existing table

```ts
// lib/server-db.ts inside runMigrations(db)
const cols = db.prepare(`PRAGMA table_info(sources)`).all() as Array<{ name: string }>;
const hasReviewedAt = cols.some((c) => c.name === 'reviewed_at');
if (!hasReviewedAt) {
  db.exec(`ALTER TABLE sources ADD COLUMN reviewed_at INTEGER`);
}
```

Why the probe? `ALTER TABLE ... ADD COLUMN` is _not_ idempotent in
SQLite (it errors if the column exists). The probe pattern is what the
existing migrations use; copy it verbatim.

## Adding a new table

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS review_notes (
    id          TEXT PRIMARY KEY,
    source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    note        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_review_notes_source_id
    ON review_notes(source_id);
`);
```

Always include `IF NOT EXISTS` on both the table and every index.

## Adding to an FTS5 virtual table

`wiki-db.ts` keeps a `concepts_fts` (and similar) virtual table in sync
with the main table via INSERT/UPDATE triggers. To track a new column:

1. Add the column to the base table (using the probe pattern above).
2. Drop and recreate the FTS table — this is the _only_ allowed
   destructive operation, because FTS data is fully derived:
   ```ts
   db.exec(`DROP TABLE IF EXISTS concepts_fts;`);
   db.exec(`CREATE VIRTUAL TABLE concepts_fts USING fts5(
     id UNINDEXED, title, body, new_column,
     content='concepts', content_rowid='rowid'
   );`);
   ```
3. Update the AFTER INSERT / UPDATE / DELETE triggers to project the
   new column.
4. Re-populate the FTS index from the base table at the end of the
   migration block:
   ```ts
   db.exec(`INSERT INTO concepts_fts(rowid, id, title, body, new_column)
            SELECT rowid, id, title, body, new_column FROM concepts;`);
   ```

## Type / repo updates

After the schema change:

- Add the field to `lib/types.ts` (or the relevant interface in
  `wiki-db.ts`).
- Update the `repo.*` / `wikiRepo.*` mappers that read/write the table
  so the new column is round-tripped.
- If the column is nullable in DB but required in TS, decide deliberately
  — prefer making it optional in the TS type until backfilled.

## Testing the migration

1. Delete the local dev database to simulate a cold start:
   ```bash
   rm -rf data/compound.db data/compound.db-wal data/compound.db-shm
   ```
2. Run `npm run dev`; the migration runs on the first request that
   touches the singleton.
3. Add or extend a `lib/*.test.ts` that exercises the new column / table
   end-to-end. Use `process.env.DATA_DIR = fs.mkdtempSync(...)` in a
   `test.before` hook so the test gets a fresh DB (see the
   `add-node-test` skill).
4. Run `npm run check` — typecheck must accept the new fields, tests
   must pass, and `next build` must still succeed.
5. **Do not** commit a `data/` directory. The dev DB is git-ignored.

## Pre-commit verification

```bash
npm run typecheck
npm run test
npm run build
```

If any step touches the schema, also confirm the migration is a no-op
on a _second_ cold start: run the dev server twice on the same data
directory and ensure no errors are logged the second time.
