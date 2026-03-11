# Resource Expansion Plan

## Current State

Both MCP handlers already support `resources/list` and `resources/read`. Currently exposed:

| Handler | URI | Source |
|---------|-----|--------|
| Platform | `ultralight://platform/skills.md` | `buildPlatformDocs()` |
| Platform | `ultralight://platform/library.md` | R2: `users/{userId}/library.md` |
| Per-App | `ultralight://app/{appId}/skills.md` | Supabase: `apps.skills_md` |

All the plumbing works. This plan expands what data is accessible through the existing protocol surface.

---

## Phase 1: Expose Existing Data (Low Effort)

These resources already exist in storage — we're just adding URI routes to serve them.

### 1A. Platform Handler — User Memory & Profile

**File:** `api/handlers/platform-mcp.ts` → `handleResourcesList` + `handleResourcesRead`

Add to `resources/list`:

```typescript
{
  uri: 'ultralight://platform/memory.md',
  name: 'Your Cross-Session Memory',
  description: 'Persistent markdown notes, preferences, and project context across all apps and sessions.',
  mimeType: 'text/markdown',
}
```

Add to `resources/read`:

```typescript
if (uri === 'ultralight://platform/memory.md') {
  const r2Service = createR2Service();
  let memoryMd = await r2Service.fetchTextFile(`users/${userId}/memory.md`);
  if (!memoryMd) memoryMd = '# Memory\n\nNo notes yet. Use `ul.memory({ action: "write" })` to start.';
  return jsonRpcResponse(id, { contents: [{ uri, mimeType: 'text/markdown', text: memoryMd }] });
}
```

**Why:** Agents currently access memory via `ul.memory({ action: "read" })` which is a tool call (counts toward rate limits, slower). As a resource, it's a passive read — ideal for context loading at session start.

**Effort:** ~15 lines of code. Same pattern as `library.md`.

### 1B. Per-App Handler — App Configuration

**File:** `api/handlers/mcp.ts` → `handleResourcesList` + `handleResourcesRead`

Add to `resources/list`:

```typescript
{
  uri: `ultralight://app/${appId}/manifest.json`,
  name: `${app.name || app.slug} — App Manifest`,
  description: 'Function definitions, parameter schemas, and app configuration.',
  mimeType: 'application/json',
}
```

Add to `resources/read`:

```typescript
if (uri === `ultralight://app/${appId}/manifest.json`) {
  const manifest = app.manifest ? JSON.parse(app.manifest) : { functions: {} };
  // Enrich with runtime metadata
  manifest._meta = {
    app_id: appId,
    name: app.name,
    version: app.current_version,
    visibility: app.visibility,
    exports: app.exports,
    total_runs: app.total_runs,
  };
  return jsonRpcResponse(id, {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(manifest, null, 2) }]
  });
}
```

**Why:** Agents connecting to an app via `/mcp/{appId}` can read structured function schemas without parsing markdown. Machine-readable complement to `skills.md`.

**Effort:** ~20 lines. Data already in `apps` table.

---

## Phase 2: App Storage as Resources (Medium Effort)

This is the highest-value expansion. App storage keys become readable data.

### 2A. Per-App Handler — Storage Key Listing

**File:** `api/handlers/mcp.ts`

Add a **resource template** to `resources/list`:

```typescript
{
  uri: `ultralight://app/${appId}/data`,
  name: `${app.name || app.slug} — Stored Data`,
  description: 'List of all storage keys for this app. Read individual keys at ultralight://app/{appId}/data/{key}.',
  mimeType: 'application/json',
}
```

For `resources/read`:

```typescript
// List all keys
if (uri === `ultralight://app/${appId}/data`) {
  const appData = createAppDataService(appId, userId);
  const keys = await appData.list();
  return jsonRpcResponse(id, {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ keys, count: keys.length }) }]
  });
}

// Read individual key
const dataPrefix = `ultralight://app/${appId}/data/`;
if (uri.startsWith(dataPrefix)) {
  const key = uri.slice(dataPrefix.length);
  const appData = createAppDataService(appId, userId);
  const value = await appData.load(key);
  if (value === null) return jsonRpcErrorResponse(id, NOT_FOUND, `Storage key not found: ${key}`);
  return jsonRpcResponse(id, {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value) }]
  });
}
```

**Why:** Currently agents must use `ultralight.load(key)` inside sandbox code or call a function that reads storage. As resources, agents can browse and read app state directly — essential for debugging, auditing, and building data-aware workflows.

**Effort:** ~40 lines. Uses existing `AppDataService`. Needs auth check (user must own or have permission).

**Auth consideration:** Storage is user-partitioned (`apps/{appId}/users/{userId}/data/`). The userId from auth context ensures data isolation. No new auth logic needed — same partition as `ultralight.load()`.

### 2B. Platform Handler — Memory KV Keys

**File:** `api/handlers/platform-mcp.ts`

Add to `resources/list`:

```typescript
{
  uri: 'ultralight://platform/memory/kv',
  name: 'Your Memory Key-Value Store',
  description: 'Cross-app structured memory. Read individual keys at ultralight://platform/memory/kv/{key}.',
  mimeType: 'application/json',
}
```

For `resources/read`:

```typescript
if (uri === 'ultralight://platform/memory/kv') {
  const memoryService = createMemoryService();
  const entries = await memoryService.query(userId, { scope: 'user', limit: 100 });
  const keys = entries.map(e => ({ key: e.key, updated_at: e.updated_at }));
  return jsonRpcResponse(id, {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ keys, count: keys.length }) }]
  });
}

const kvPrefix = 'ultralight://platform/memory/kv/';
if (uri.startsWith(kvPrefix)) {
  const key = uri.slice(kvPrefix.length);
  const memoryService = createMemoryService();
  const value = await memoryService.recall(userId, 'user', key);
  if (value === null) return jsonRpcErrorResponse(id, NOT_FOUND, `Memory key not found: ${key}`);
  return jsonRpcResponse(id, {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value) }]
  });
}
```

**Why:** KV memory is structured data that agents often need for context. Reading it as a resource avoids consuming a tool call.

**Effort:** ~35 lines. Uses existing `MemoryService`.

---

## Phase 3: Dynamic Resource Discovery (Medium-High Effort)

### 3A. Resource Templates (MCP Spec Feature)

The MCP spec supports **resource templates** — parameterized URI patterns that tell clients how to construct resource URIs dynamically.

Add to `resources/list` (platform handler):

```typescript
// Resource templates tell clients about parameterized URIs
const resourceTemplates = [
  {
    uriTemplate: 'ultralight://app/{appId}/data/{key}',
    name: 'App Storage Entry',
    description: 'Read a specific storage key from any app you own or have access to.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'ultralight://platform/memory/kv/{key}',
    name: 'Memory Entry',
    description: 'Read a specific key from your cross-app memory store.',
    mimeType: 'application/json',
  },
];
```

This requires supporting the `resourceTemplates` field in the `resources/list` response — check if the MCP SDK expects this.

**Effort:** Medium. Need to verify MCP spec for resource template format and ensure clients handle it.

### 3B. App-Declared Resources

Allow apps to declare custom resources in their `manifest.json`:

```json
{
  "functions": { ... },
  "resources": {
    "config": {
      "description": "Current app configuration",
      "mimeType": "application/json",
      "storage_key": "config"
    },
    "schema": {
      "description": "Data schema documentation",
      "mimeType": "text/markdown",
      "storage_key": "schema.md"
    }
  }
}
```

The per-app MCP handler would:
1. Parse `manifest.resources` on `resources/list`
2. Map declared resources to storage keys
3. Serve them via `resources/read` by loading from AppData

**Why:** App builders can expose specific data as readable resources without writing custom code. The platform handles the URI routing.

**Effort:** ~60 lines in mcp.ts + manifest schema update. Higher value because it's a developer-facing feature.

---

## Phase 4: Resource Subscriptions (High Effort — Future)

The MCP spec supports `resources/subscribe` and `notifications/resources/updated` for real-time updates. This would let agents subscribe to storage changes.

**Architecture requirement:** Needs persistent connection (SSE or WebSocket). Current HTTP POST model doesn't support server-initiated messages.

**Possible approach:**
1. Add SSE transport option to both MCP handlers (alongside existing HTTP POST)
2. On `resources/subscribe`, register userId + URI pattern in a subscription table
3. When `ultralight.store()` writes data, check subscriptions and push `notifications/resources/updated`
4. Client re-reads the resource via `resources/read`

**Effort:** High. Requires SSE transport, subscription management, notification dispatch. This is the "notifications" infrastructure discussed earlier.

**Defer to:** After Phases 1-3 are validated and usage patterns are understood.

---

## Implementation Order

| Phase | What | Files Changed | Effort | Impact |
|-------|------|---------------|--------|--------|
| 1A | Platform memory.md resource | platform-mcp.ts | ~15 lines | Medium — agents read memory passively |
| 1B | Per-app manifest.json resource | mcp.ts | ~20 lines | Medium — machine-readable schemas |
| 2A | Per-app storage as resources | mcp.ts | ~40 lines | **High** — agents browse app data |
| 2B | Platform memory KV as resources | platform-mcp.ts | ~35 lines | High — agents browse structured memory |
| 3A | Resource templates | platform-mcp.ts | ~30 lines | Medium — clients discover URI patterns |
| 3B | App-declared resources | mcp.ts + manifest schema | ~60 lines | **High** — developer-facing feature |
| 4 | Subscriptions | New transport layer | Major | Future — real-time updates |

**Total for Phases 1-2: ~110 lines across 2 files.** Everything uses existing services.

---

## URI Scheme Summary (After Phases 1-3)

### Platform Resources (`/mcp/platform`)

| URI | Content |
|-----|---------|
| `ultralight://platform/skills.md` | Platform docs (existing) |
| `ultralight://platform/library.md` | User's app library (existing) |
| `ultralight://platform/memory.md` | User's memory markdown (Phase 1A) |
| `ultralight://platform/memory/kv` | Memory KV key listing (Phase 2B) |
| `ultralight://platform/memory/kv/{key}` | Individual memory value (Phase 2B) |

### Per-App Resources (`/mcp/:appId`)

| URI | Content |
|-----|---------|
| `ultralight://app/{appId}/skills.md` | Auto-generated function docs (existing) |
| `ultralight://app/{appId}/manifest.json` | Structured function schemas + metadata (Phase 1B) |
| `ultralight://app/{appId}/data` | Storage key listing (Phase 2A) |
| `ultralight://app/{appId}/data/{key}` | Individual storage value (Phase 2A) |
| `ultralight://app/{appId}/resources/{name}` | App-declared custom resources (Phase 3B) |

---

## Auth & Security Notes

- All resources use the same auth flow as tools (Bearer token → userId extraction)
- Per-app storage is already user-partitioned — no new auth logic needed
- Memory KV uses existing scoping (`user` scope = cross-app, `app:{appId}` = app-scoped)
- App-declared resources should respect visibility settings (private apps require permission)
- Resource reads should NOT count toward tool call rate limits (separate metering if needed)
- Consider adding `resources/read` to request logging for usage analytics

---

## Skills.md Update (Already Done)

The Skills.md has been updated to document:
- MCP Resources section with current URIs
- When to use Resources vs. Tools guidance
- Manifest.json generates auto-resources note
- Agent guidance summary includes Resources line

After implementing new resources, update the Skills.md tables to include the new URIs.
