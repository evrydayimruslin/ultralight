# Migrations

## File location and naming

Migration files go in the `migrations/` folder at the app root.

Naming pattern: `{NNN}_{description}.sql`

```
migrations/
  001_initial.sql
  002_add_priority_column.sql
  003_create_tags_table.sql
```

## Provisioning and execution

When you deploy an app with a `migrations/` folder:

1. The platform **provisions a D1 database** for your app (if not already provisioned)
2. Migrations are **validated** (schema conventions, forbidden operations)
3. Migrations are **run synchronously** during the upload — before the response is returned
4. The upload response includes D1 status confirming tables were created

This means your database is ready to use **immediately after deploy** — there is no lazy provisioning delay.

## Ordering

Migrations are sorted and applied by version number (the `NNN` prefix). They are tracked in the `_migrations` system table — the platform knows which have been applied.

## Rules

1. **Never modify an already-applied migration.** If you need to change the schema, create a new migration file with the next version number.
2. **Use `CREATE TABLE IF NOT EXISTS`** for safety on initial table creation.
3. **Use `ALTER TABLE ADD COLUMN`** for adding columns in subsequent migrations.

## Forbidden operations

These are validated at deploy time and will be rejected:

- `DROP TABLE` — destructive, not allowed
- `PRAGMA` — not allowed in migrations
- `ATTACH DATABASE` — not allowed

## Example

```sql
-- 001_initial.sql
CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
```

```sql
-- 002_add_pinned.sql
ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
```
