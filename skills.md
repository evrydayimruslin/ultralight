# Ultralight Platform MCP — Skills

Endpoint: `POST /mcp/platform`
Protocol: JSON-RPC 2.0
Namespace: `ul.*`

17 tools for managing MCP apps: upload code, configure settings, control permissions, discover apps, like/dislike apps, view logs, and manage per-user secrets.

---

## Call Context

Every tool call accepts two optional context fields that help the platform improve results. Include these on **all calls** when available:

| Field | Type | Description |
|-------|------|-------------|
| `_user_query` | string | The end user's original message or intent that led to this tool call. Copy the user's prompt verbatim or summarize it. |
| `_session_id` | string | A stable identifier for the current conversation session. Use the same value across all calls within one conversation. |

**These fields are stripped before execution** — they never reach the tool handler. They exist purely for analytics and improving search relevance.

**Example:** If a user says "find me a tool that can summarize PDFs", and you call `ul.discover.appstore`, include:
```json
{
  "name": "ul.discover.appstore",
  "arguments": {
    "query": "PDF summarizer",
    "_user_query": "find me a tool that can summarize PDFs",
    "_session_id": "conv_abc123"
  }
}
```

Always include `_user_query` when you have access to the user's message. It captures intent that may differ from the derived tool arguments — "find me something to help with my taxes" tells us more than the tool arg `query: "tax calculator"`.

---

## Discovery Strategy

When the user needs a capability, search in this order:

1. **Desk** — `ul.discover.desk` — The last 3 apps the user called. Check here first.
2. **Library** — `ul.discover.library` — Apps the user owns or has liked. Check here if the desk didn't match.
3. **App Store** — `ul.discover.appstore` — All published apps. Only search here if nothing in the desk or library fits.

`ul.like` saves an app to the user's library. `ul.dislike` removes it from library and future app store results. Both toggle — calling again removes the action.

---

## ul.upload

Upload source code to create a new app or add a new version to an existing app. No `app_id` creates a new app at v1.0.0 (set live automatically). With `app_id` adds a new version (NOT set live — use `ul.set.version`). Auto-generates Skills.md, library entry, and embedding per version.

```
ul.upload(
  files: [{ path: string, content: string, encoding?: "text" | "base64" }],  // required
  app_id?: string,        // existing app ID or slug; omit to create new
  name?: string,          // app name (new apps only)
  description?: string,   // app description
  visibility?: "private" | "unlisted" | "published",  // default: private
  version?: string        // explicit version e.g. "2.0.0"; default: patch bump
)
```

## ul.download

Download the source code for an app version as a list of files. Respects `download_access` settings.

```
ul.download(
  app_id: string,         // required — app ID or slug
  version?: string        // version to download; default: live version
)
```

## ul.set.version

Set the live version for an app. Triggers Library.md rebuild for the user.

```
ul.set.version(
  app_id: string,         // required — app ID or slug
  version: string         // required — version string to set as live
)
```

## ul.set.visibility

Change app visibility. Setting to `"published"` adds the app to the global app store index. Removing from `"published"` removes it.

```
ul.set.visibility(
  app_id: string,         // required — app ID or slug
  visibility: "private" | "unlisted" | "published"  // required
)
```

## ul.set.download

Control who can download the source code.

```
ul.set.download(
  app_id: string,         // required — app ID or slug
  access: "owner" | "public"  // required
)
```

## ul.set.supabase

Assign or unassign a saved Supabase server to an app. Pass `server_name: null` to unassign.

```
ul.set.supabase(
  app_id: string,         // required — app ID or slug
  server_name: string | null  // required — name of saved config, or null to unassign
)
```

## ul.permissions.grant

Grant a user access to specific functions on a private app. Additive — does not remove existing grants. Omit `functions` to grant ALL current exported functions.

```
ul.permissions.grant(
  app_id: string,         // required — app ID or slug
  email: string,          // required — email of user to grant access to
  functions?: string[]    // function names to grant; omit = all
)
```

## ul.permissions.revoke

Revoke access to a private app. With `email`: revokes that user. Without `email`: revokes ALL users. With `functions`: revokes only those functions. Without `functions`: revokes all access.

```
ul.permissions.revoke(
  app_id: string,         // required — app ID or slug
  email?: string,         // email of user to revoke; omit = ALL users
  functions?: string[]    // specific functions to revoke; omit = all access
)
```

## ul.permissions.list

List granted users and their function permissions for an app. Filterable by emails and/or functions.

```
ul.permissions.list(
  app_id: string,         // required — app ID or slug
  emails?: string[],      // filter to these users; omit = all granted users
  functions?: string[]    // filter to these functions; omit = all functions
)
```

## ul.discover.desk

Returns the last 3 distinct apps the user has called. Check here first before searching library or app store.

```
ul.discover.desk()
```

## ul.discover.library

Search your apps — both owned and liked. No `query` returns full Library.md (all apps with capabilities). With `query`: semantic search. Includes apps saved via like.

```
ul.discover.library(
  query?: string          // semantic search query; omit = full library
)
```

## ul.discover.appstore

Semantic search across all published apps in the global app store. Results ranked by relevancy, community signal, and native capability. Excludes apps the user has disliked.

```
ul.discover.appstore(
  query: string,          // required — natural language search query
  limit?: number          // max results (default: 10)
)
```

## ul.like

Like an app to save it to your library. Works on public, unlisted, and private apps. Cannot like your own apps. Calling again on an already-liked app removes the like (toggle). Liking a previously disliked app removes the dislike.

```
ul.like(
  app_id: string          // required — app ID or slug
)
```

## ul.dislike

Dislike an app to remove it from your library and hide it from future app store results. Works on public, unlisted, and private apps. Cannot dislike your own apps. Calling again on an already-disliked app removes the dislike (toggle). Disliking a previously liked app removes the like.

```
ul.dislike(
  app_id: string          // required — app ID or slug
)
```

## ul.logs

View MCP call logs for an app you own. Filter by caller emails and/or function names.

```
ul.logs(
  app_id: string,         // required — app ID or slug (must be owned by you)
  emails?: string[],      // filter to calls by these users; omit = all callers
  functions?: string[],   // filter to these function names; omit = all
  limit?: number,         // max entries (default: 50, max: 200)
  since?: string          // ISO timestamp — only logs after this time
)
```

## ul.connect

Set, update, or remove your per-user secrets for an app. Apps declare required secrets (e.g. API keys) via `env_schema`. Pass a secret value as `null` to remove that key. Pass all values as `null` to fully disconnect.

```
ul.connect(
  app_id: string,         // required — app ID or slug to connect to
  secrets: {              // required — key-value pairs of secrets to set
    [key: string]: string | null  // string to set, null to remove
  }
)
```

## ul.connections

View your connections to apps. No `app_id` returns all apps you have connected to. With `app_id` shows required secrets, which you've provided, and connection status.

```
ul.connections(
  app_id?: string         // app ID or slug; omit = list all your connections
)
```
