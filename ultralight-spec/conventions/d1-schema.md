# D1 Schema Conventions

## Required columns (every table)

```sql
id         TEXT PRIMARY KEY,
user_id    TEXT NOT NULL,
created_at TEXT NOT NULL DEFAULT (datetime('now')),
updated_at TEXT NOT NULL DEFAULT (datetime('now'))
```

## Required indexes

At minimum, every table must have:

```sql
CREATE INDEX idx_{table}_user ON {table}(user_id);
```

Add additional indexes as needed using the same naming pattern.

## Naming

- Tables: `snake_case`, plural (e.g. `task_items`, `chat_messages`)
- Columns: `snake_case`
- Indexes: `idx_{table}_{columns}` (e.g. `idx_tasks_user`, `idx_tasks_status_user`)

## Data types

This is SQLite. Use only these types:

| Type | Use for |
|------|---------|
| `TEXT` | IDs, strings, dates (ISO 8601), UUIDs, enums |
| `REAL` | Decimals, currency amounts, floating point |
| `INTEGER` | Counts, booleans (0/1), whole numbers |

**Forbidden**: `VARCHAR`, `SERIAL`, arrays, JSON columns for queryable data.

## D1 constraints

Ultralight uses Cloudflare D1 (SQLite) via the REST API. Be aware of these constraints:

- **No transactions in app code.** `BEGIN TRANSACTION`, `COMMIT`, and `SAVEPOINT` are not supported. Use idempotent patterns instead (see api-surface.md).
- **`batch()` is sequential, not atomic.** Each statement runs independently. Design for partial failure tolerance.
- **`exec()` is blocked at runtime.** Only available during migration execution by the platform.
- **10GB per database.** Each app gets its own isolated D1 database.
- **All queries must include `user_id`.** The SDK validates this automatically.

## Example

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  priority   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_tasks_status_user ON tasks(status, user_id);
```
