# User Isolation

Every Ultralight app enforces strict per-user data isolation. Users can only see and modify their own data.

## Requirements

1. Every table MUST have a `user_id TEXT NOT NULL` column.
2. Every query MUST filter by `user_id`.
3. The SDK validates this at runtime — it throws if `user_id` is missing from your SQL.

## Getting the current user

```ts
const userId = ultralight.user.id;
```

## Query rules

### INSERT — must include user_id in the column list

```ts
await ultralight.db.run(
  "INSERT INTO tasks (id, user_id, title) VALUES (?, ?, ?)",
  [crypto.randomUUID(), ultralight.user.id, title]
);
```

### SELECT — must have WHERE user_id = ?

```ts
const tasks = await ultralight.db.all(
  "SELECT * FROM tasks WHERE user_id = ?",
  [ultralight.user.id]
);
```

### UPDATE — must have WHERE user_id = ?

```ts
await ultralight.db.run(
  "UPDATE tasks SET status = ? WHERE id = ? AND user_id = ?",
  [newStatus, taskId, ultralight.user.id]
);
```

### DELETE — must have WHERE user_id = ?

```ts
await ultralight.db.run(
  "DELETE FROM tasks WHERE id = ? AND user_id = ?",
  [taskId, ultralight.user.id]
);
```

## Cross-user queries are blocked

The SDK will reject any query that does not include a `user_id` filter. There is no escape hatch. Each user only sees their own data.
