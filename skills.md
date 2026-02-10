# Ultralight Platform MCP — Skills

Endpoint: `POST /mcp/platform`
Protocol: JSON-RPC 2.0
Namespace: `ul.*`

12 tools for managing MCP apps: upload code, configure settings, control permissions, discover apps, and view logs.

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

## ul.discover.library

Search your own apps. No `query` returns full Library.md (all apps with capabilities). With `query`: semantic search against your app embeddings.

```
ul.discover.library(
  query?: string          // semantic search query; omit = full library
)
```

## ul.discover.appstore

Semantic search across all published apps in the global app store.

```
ul.discover.appstore(
  query: string,          // required — natural language search query
  limit?: number          // max results (default: 10)
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
