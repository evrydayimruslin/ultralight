# Security

## Parameterized queries

Always use `?` placeholders. Never interpolate values into SQL strings.

```ts
// Correct
await ultralight.db.all("SELECT * FROM tasks WHERE user_id = ? AND status = ?", [ultralight.user.id, status]);

// WRONG — SQL injection risk
await ultralight.db.all(`SELECT * FROM tasks WHERE user_id = '${userId}' AND status = '${status}'`);
```

## db.exec() blocked at runtime

`ultralight.db.exec()` is blocked in app code to prevent DDL injection. It is only available during migrations.

## user_id validation

The SDK enforces `user_id` filtering on every query at runtime. This cannot be bypassed. Queries missing a `user_id` filter will throw. See user-isolation.md.

## Migration validation

Migration SQL is validated at deploy time. The following are rejected:

- `DROP TABLE`
- `PRAGMA`
- `ATTACH DATABASE`

## Permissions

Sensitive operations require explicit permissions declared in `manifest.json`:

- `ai` — access to AI/LLM capabilities
- `charge` — ability to charge users
- `net:fetch` — outbound HTTP requests

Undeclared permissions will be denied at runtime.
