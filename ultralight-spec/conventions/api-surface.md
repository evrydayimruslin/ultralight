# API Surface

Access the SDK via `globalThis.ultralight` (available as `ultralight` in app code).

## Database methods

### ultralight.db.run(sql, params?)

Execute INSERT, UPDATE, or DELETE.

```ts
const result = await ultralight.db.run(
  "INSERT INTO tasks (id, user_id, title) VALUES (?, ?, ?)",
  [crypto.randomUUID(), ultralight.user.id, "Buy groceries"]
);
// result: { success: true, meta: { changes: 1, last_row_id: 1, duration: 0.5, rows_read: 0, rows_written: 1 } }
```

### ultralight.db.all<T>(sql, params?)

SELECT all matching rows.

```ts
const tasks = await ultralight.db.all<Task>(
  "SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC",
  [ultralight.user.id]
);
// returns: Task[]
```

### ultralight.db.first<T>(sql, params?)

SELECT the first matching row.

```ts
const task = await ultralight.db.first<Task>(
  "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
  [taskId, ultralight.user.id]
);
// returns: Task | null
```

### ultralight.db.batch(statements)

Execute multiple statements atomically.

```ts
const results = await ultralight.db.batch([
  { sql: "UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?", params: ["done", id1, ultralight.user.id] },
  { sql: "UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?", params: ["done", id2, ultralight.user.id] },
]);
// returns: D1RunResult[]
```

### ultralight.db.exec(sql)

**BLOCKED at runtime.** Only available during migrations. Attempting to call `exec()` in app code will throw.

## Rules

1. **Always parameterize.** Use `?` placeholders. Never string-interpolate values into SQL.
2. **Always include user_id.** Every query must filter by `user_id` (see user-isolation.md).
3. **Use `crypto.randomUUID()` for IDs.** Generate IDs client-side, not with autoincrement.
4. **Use `ultralight.user.id`** to get the current authenticated user's ID.
