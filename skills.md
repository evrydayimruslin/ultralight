# Ultralight Platform MCP — Skills

Endpoint: `POST /mcp/platform`
Protocol: JSON-RPC 2.0
Namespace: `ul.*`

29 tools for managing MCP apps, user memory, discovery, permissions, connections, rate limits, and audit logs.

---

## MCP Resources

This server and every Ultralight per-app MCP server support **MCP Resources** — structured context that your client can load automatically on connection.

### Platform Resources (this server)

| Resource | URI | Description |
|----------|-----|-------------|
| Skills.md | `ultralight://platform/skills.md` | This document — full platform tool reference |
| Library.md | `ultralight://platform/library.md` | Your compiled app library (owned + saved apps with capabilities) |

### Per-App Resources

Every Ultralight app MCP at `/mcp/{appId}` also supports `resources/list` and `resources/read`. Each app exposes:

| Resource | URI | Description |
|----------|-----|-------------|
| Skills.md | `ultralight://app/{appId}/skills.md` | Auto-generated documentation: function signatures, parameters, return types, examples |

**When connecting to any Ultralight MCP endpoint**, call `resources/list` first to load the app's Skills.md into your context before calling tools. This gives you complete understanding of the app's capabilities, parameter types, and usage patterns.

---

## Call Context

Every tool call accepts two optional context fields that help the platform improve results. Include these on **all calls** when available:

| Field | Type | Description |
|-------|------|-------------|
| `_user_query` | string | The end user's original message or intent that led to this tool call. Copy the user's prompt verbatim or summarize it. |
| `_session_id` | string | A stable identifier for the current conversation session. Use the same value across all calls within one conversation. |

**These fields are stripped before execution** — they never reach the tool handler. They exist purely for analytics and improving search relevance.

---

## Discovery Strategy

When the user needs a capability, search in this order:

1. **Desk** — `ul.discover.desk` — The last 3 apps the user called. Check here first.
2. **Library** — `ul.discover.library` — Apps the user owns or has liked. Also returns the user's memory.md context. Check here if the desk didn't match.
3. **App Store** — `ul.discover.appstore` — All published apps. Call without a query to browse featured/top apps, or with a query to search. Only search here if nothing in the desk or library fits.

`ul.like` saves an app to the user's library. `ul.dislike` removes it from library and future app store results. Both toggle — calling again removes the action.

---

## Memory

Ultralight provides two complementary memory layers:

- **memory.md** — Free-form markdown the user (or agents) read/write. Preferences, project context, notes. Returned automatically by `ul.discover.library`. Use `ul.memory.read` / `ul.memory.write` / `ul.memory.append`.
- **KV store** — Structured key-value pairs for programmatic storage. Cross-app by default. Use `ul.memory.remember` / `ul.memory.recall` / `ul.memory.query` / `ul.memory.forget`.

Per-app MCP servers also expose `ultralight.remember()` / `ultralight.recall()` in the sandbox for app code to use programmatically.

---

## ul.upload

Upload source code to create a new app or add a new version to an existing app. No `app_id` creates a new app at v1.0.0 (set live automatically). With `app_id` adds a new version (NOT set live — use `ul.set.version`). Auto-generates Skills.md, library entry, and embedding per version.

```
ul.upload(
  files: [{ path: string, content: string, encoding?: "text" | "base64" }],
  app_id?: string,
  name?: string,
  description?: string,
  visibility?: "private" | "unlisted" | "published",
  version?: string
)
```

## ul.download

Download the source code for an app version as a list of files. Respects `download_access` settings.

```
ul.download(
  app_id: string,
  version?: string
)
```

## ul.set.version

Set the live version for an app. Triggers Library.md rebuild for the user.

```
ul.set.version(
  app_id: string,
  version: string
)
```

## ul.set.visibility

Change app visibility. Setting to `"published"` adds the app to the global app store index. Removing from `"published"` removes it.

```
ul.set.visibility(
  app_id: string,
  visibility: "private" | "unlisted" | "published"
)
```

## ul.set.download

Control who can download the source code.

```
ul.set.download(
  app_id: string,
  access: "owner" | "public"
)
```

## ul.set.supabase

Assign or unassign a saved Supabase server to an app. Pass `server_name: null` to unassign.

```
ul.set.supabase(
  app_id: string,
  server_name: string | null
)
```

## ul.permissions.grant

Grant a user access to specific functions on a private app. Additive — does not remove existing grants. Omit `functions` to grant ALL current exported functions. Pro: pass `constraints` to set IP allowlists, time windows, usage budgets, and expiry dates.

```
ul.permissions.grant(
  app_id: string,
  email: string,
  functions?: string[],
  constraints?: {
    allowed_ips?: string[],       // CIDR or exact IPs (e.g. ["10.0.0.0/8"])
    time_window?: {
      start_hour: number,         // 0-23
      end_hour: number,           // 0-23 (wraps if end < start)
      timezone?: string,          // IANA (e.g. "America/New_York")
      days?: number[]             // 0=Sun, 6=Sat
    },
    budget_limit?: number,        // max calls before access suspends
    budget_period?: "hour" | "day" | "week" | "month",
    expires_at?: string           // ISO timestamp
  }
)
```

## ul.permissions.revoke

Revoke access to a private app. With `email`: revokes that user. Without `email`: revokes ALL users. With `functions`: revokes only those functions. Without `functions`: revokes all access.

```
ul.permissions.revoke(
  app_id: string,
  email?: string,
  functions?: string[]
)
```

## ul.permissions.list

List granted users, their function permissions, and active constraints. Shows IP allowlists, time windows, budgets, and expiry. Filterable by emails and/or functions.

```
ul.permissions.list(
  app_id: string,
  emails?: string[],
  functions?: string[]
)
```

## ul.permissions.export

Pro: Export MCP call logs and permission audit data. Useful for compliance and security review.

```
ul.permissions.export(
  app_id: string,
  format?: "json" | "csv",
  since?: string,
  until?: string,
  limit?: number
)
```

## ul.set.ratelimit

Pro: Set per-consumer rate limits for your app. Pass null values to remove limits and use platform defaults.

```
ul.set.ratelimit(
  app_id: string,
  calls_per_minute?: number | null,
  calls_per_day?: number | null
)
```

## ul.discover.desk

Returns the last 3 distinct apps the user has called. Check here first before searching library or app store.

```
ul.discover.desk()
```

## ul.discover.library

Search your apps — both owned and liked. No `query` returns full Library.md + memory.md (all apps with capabilities, plus user context). With `query`: semantic search. Includes apps saved via like.

```
ul.discover.library(
  query?: string
)
→ { library: string, memory: string | null }  // no query
→ { query: string, results: [...] }           // with query
```

## ul.discover.appstore

Browse or search all published apps in the global app store. Without a query, returns featured/top apps ranked by community likes. With a query, returns semantic search results ranked by relevancy, community signal, and native capability. Excludes apps the user has disliked.

```
ul.discover.appstore(
  query?: string,  // omit to browse featured/top apps
  limit?: number
)
→ { mode: 'featured', results: [...] }  // no query
→ { mode: 'search', query, results: [...] }  // with query
```

## ul.like

Like an app to save it to your library. Toggle — calling again removes the like. Liking a previously disliked app removes the dislike.

```
ul.like(
  app_id: string
)
```

## ul.dislike

Dislike an app to remove it from your library and hide it from future app store results. Toggle — calling again removes the dislike.

```
ul.dislike(
  app_id: string
)
```

## ul.logs

View MCP call logs for an app you own. Filter by caller emails and/or function names.

```
ul.logs(
  app_id: string,
  emails?: string[],
  functions?: string[],
  limit?: number,
  since?: string
)
```

## ul.connect

Set, update, or remove your per-user secrets for an app. Pass a secret value as `null` to remove that key.

```
ul.connect(
  app_id: string,
  secrets: { [key: string]: string | null }
)
```

## ul.connections

View your connections to apps. No `app_id` returns all connected apps. With `app_id` shows required secrets and connection status.

```
ul.connections(
  app_id?: string
)
```

## ul.memory.read

Read the user's memory.md — free-form markdown context that persists across sessions and agents.

```
ul.memory.read()
→ { memory: string | null, exists: boolean }
```

## ul.memory.write

Overwrite the user's memory.md. Auto-embeds for semantic search. Use `ul.memory.append` to add without losing existing content.

```
ul.memory.write(
  content: string
)
```

## ul.memory.append

Append a section to the user's memory.md. Creates the file if it doesn't exist. Auto-embeds on update.

```
ul.memory.append(
  content: string
)
```

## ul.memory.remember

Store a key-value pair in the user's cross-app memory (KV store). Scope defaults to `"user"` (shared across all apps).

```
ul.memory.remember(
  key: string,
  value: any,
  scope?: string
)
```

## ul.memory.recall

Retrieve a value from the user's cross-app memory by key. Returns the value or null.

```
ul.memory.recall(
  key: string,
  scope?: string
)
```

## ul.memory.query

Query the user's KV memory. Filter by scope and/or key prefix. Returns `{ key, value }` pairs ordered by most recently updated.

```
ul.memory.query(
  scope?: string,
  prefix?: string,
  limit?: number
)
→ { entries: [{ key, value }], total: number, scope: string }
```

## ul.memory.forget

Delete a key from the user's cross-app memory.

```
ul.memory.forget(
  key: string,
  scope?: string
)
```

---

## Pages (Markdown Publishing)

Agents can publish markdown as live, public web pages. Useful for reports, summaries, documentation, or any content the user should be able to view in a browser or share via link.

## ul.markdown

Publish markdown content as a live web page. Returns a shareable URL. Same slug overwrites the previous version. Pages are public — no auth required to view.

```
ul.markdown(
  content: string,
  slug: string,
  title?: string
)
→ { success, slug, title, url, size, updated_at }
```

The page is served at `GET /p/{userId}/{slug}` as styled HTML.

## ul.pages

List all your published markdown pages with URLs, titles, sizes, and timestamps.

```
ul.pages()
→ { pages: [{ slug, title, size, created_at, updated_at, url }], total }
```

---

## Per-App SDK Memory

Every per-app MCP server at `/mcp/{appId}` also exposes memory tools in the SDK:

- `ultralight.remember(key, value, scope?)` — Store in KV (defaults to `app:{appId}` scope)
- `ultralight.recall(key, scope?)` — Retrieve from KV
- `ultralight.store(key, value)` / `ultralight.load(key)` — Per-app data storage (R2-backed, separate from KV memory)

App code running in the sandbox can also call `ultralight.remember()` / `ultralight.recall()` programmatically.

---

## Self-Hosted UI Pattern

Every Ultralight MCP server can serve its own web UI via the HTTP endpoint system at `GET /http/{appId}/ui`. Direct users to this URL when they want to view or manage their data in a browser.
