# Edge Architecture Plan — Full Cloudflare Migration

## Overview

Migrate Ultralight from DigitalOcean + Supabase to a fully colocated Cloudflare edge architecture. Four pillars:

1. **KV Function Index** — per-user function index in Workers KV, cached locally on desktop
2. **CF Workers Migration** — move API from DigitalOcean to Cloudflare Workers
3. **In-Process MCP Calls** — MCPs become pre-compiled libraries, not HTTP services
4. **Flash Inference Default** — Gemini Flash Lite as default model for speed

Target: ~2-3s for a complete agent task (down from ~9s current).

---

## Pillar 1: KV Function Index

### What
Per-user search index of all their app functions, stored in Workers KV and cached locally on the desktop.

### Why
- Eliminates the discovery call (saves one LLM inference round ~1.5s)
- Zero context bloat (index is server/client-side data, not in system prompt)
- Instant function lookup (~5ms KV read vs ~650ms Supabase query)

### How

**Server side:**
- On app upload/like/unlike: rebuild user's function index
- Store in Workers KV: `user:{userId}:fn_index` → JSON of all functions with types
- Index shape:
```json
{
  "functions": {
    "app_ges2af_approvals_list": {
      "appId": "d90a446c-...",
      "appSlug": "app-ges2af",
      "fnName": "approvals_list",
      "description": "List pending approvals",
      "params": { "status": "string?", "limit": "number?" }
    }
  },
  "widgets": [
    { "name": "email_inbox", "appId": "d90a446c-...", "label": "Email Approvals" }
  ],
  "types": "declare const codemode: { ... }",
  "updatedAt": "2026-03-26T..."
}
```

**Desktop side:**
- On app launch: fetch index from server, cache in localStorage
- On chat start: inject `types` from cached index into system prompt
- Agent has typed functions from message #1, no discovery call needed
- Background sync: re-fetch index every 5 minutes or on app connect/disconnect

**Codemode handler:**
- Reads function index from KV (5ms) instead of querying Supabase (200ms)
- Builds tool functions from cached index
- Falls back to Supabase query if KV miss

### Impact
- Eliminates Call 1 (discovery): saves ~2s (650ms call + 1.5s inference round)
- Every codemode call faster: 5ms index read vs 200ms Supabase query

---

## Pillar 2: CF Workers Migration

### What
Move the API server from DigitalOcean App Platform (Deno) to Cloudflare Workers.

### Why
- Colocate API with D1, R2, KV, Dynamic Workers — zero network hops between services
- Edge deployment — API runs close to users globally
- Native access to Dynamic Workers Loader binding

### How

**Phase 1: Dual deploy**
- Deploy the API as a CF Worker alongside the existing DO deployment
- Route a test subdomain to the CF Worker
- Validate all endpoints work identically

**Phase 2: Migration**
- Convert Deno-specific code to CF Workers runtime (mostly compatible — both are V8)
- Replace `Deno.serve()` with Workers `fetch()` handler
- Replace Supabase client calls with direct D1 queries where possible
- Keep Supabase for auth, user management, complex queries
- Move app data queries to D1

**Phase 3: Cutover**
- Point production domain to CF Worker
- Decommission DO deployment

**Key changes:**
- `api/main.ts`: Deno HTTP server → Workers fetch handler
- `api/handlers/*.ts`: mostly unchanged (already use fetch API)
- `api/runtime/sandbox.ts`: replace AsyncFunction → Dynamic Workers
- wrangler.toml: D1 bindings, R2 bindings, KV namespaces, Worker Loader

### Impact
- API latency: ~50ms network hop eliminated (API and D1 colocated)
- Dynamic Workers: native binding instead of HTTP proxy
- Global edge deployment: API close to users everywhere

---

## Pillar 3: In-Process MCP Calls

### What
MCPs become pre-compiled ES modules loaded directly into Dynamic Worker isolates. No HTTP between recipe execution and app functions.

### Why
- Current: each MCP call inside a recipe = HTTP round-trip (~500ms)
- Target: direct function call (~50ms)
- 3-call recipe: 1.5s → 150ms

### How

**Compile at upload time:**
- When user runs `ultralight upload`, the API compiles the TypeScript to an ES module bundle
- Store compiled bundle in KV: `app:{appId}:v{version}:bundle`
- Current: compilation happens on EVERY function call (esbuild ~200ms each time)

**Load into Dynamic Worker:**
```javascript
const worker = env.LOADER.load({
  mainModule: "recipe.js",
  modules: {
    "recipe.js": agentRecipeCode,
    "email-ops.js": cachedBundle,      // pre-compiled from KV
    "resort-manager.js": cachedBundle, // pre-compiled from KV
  },
  env: {
    EMAIL_OPS_DB: d1Binding,           // per-app D1 database
    RESORT_DB: d1Binding,              // per-app D1 database
  },
  globalOutbound: null,                // no raw network
});
```

**Function call wrapper:**
Each codemode function wraps the app module call with:
1. Permission check (user has access to this app + function)
2. Rate limit check
3. Construct `ultralight` SDK with correct D1 binding and user context
4. Call the app function
5. Return result

**Security model:**
- Each app's D1 database is a separate binding — app A can't access app B's data
- Permission checks happen in the wrapper, same checks as current HTTP model
- Dynamic Worker isolate has no filesystem, no env vars, no raw network
- User context injected per-call, not stored in the isolate

**MCP HTTP endpoint stays:**
- External clients (OpenClaw, API callers) still use POST /mcp/{appId}
- The HTTP endpoint becomes an adapter that does the same in-process call
- Internal recipe calls bypass HTTP entirely

**Changes to MCP conventions — none for authors:**
- Same TypeScript functions, same ultralight.db/ai/env APIs
- Same manifest.json, same upload flow
- Compilation format changes (IIFE → ES module) but this is invisible
- Same D1 databases, same R2 storage

### Impact
- Per-function call: ~500ms → ~50ms
- 3-call recipe: ~1.5s → ~150ms
- Compilation overhead eliminated (pre-compiled at upload)

---

## Pillar 4: Flash Inference Default

### What
Default model for new chats: `google/gemini-3.1-flash-lite-preview:nitro`
User can change model starting from the second message.

### Why
- Flash Lite inference: ~500ms per round vs ~1.5s for Sonnet
- For simple tasks (list emails, show data) Flash is sufficient
- User can upgrade to Sonnet/Opus for complex reasoning tasks
- First message speed is critical for perceived performance

### How

**Desktop changes:**
- `storage.ts`: default model = `google/gemini-3.1-flash-lite-preview:nitro`
- Add model selector to chat header (visible after first message)
- First message always uses Flash (fastest time to first response)
- Subsequent messages: user can switch to any model

**Server changes:** None — model is passed from desktop to OpenRouter.

### Impact
- First response: ~1.5s faster (Flash vs Sonnet inference)
- Subsequent messages: user chooses speed vs quality tradeoff

---

## Combined Impact

| Metric | Current | After All 4 Pillars |
|--------|---------|-------------------|
| System prompt size | ~300 tokens | ~300 tokens (+ types from local cache) |
| Discovery call | 650ms + 1.5s inference | Eliminated (types pre-cached) |
| Per MCP function call | ~500ms (HTTP) | ~50ms (in-process) |
| 3-call recipe execution | ~1.5s | ~150ms |
| LLM inference per round | ~1.5s (Sonnet) | ~500ms (Flash) |
| Total for simple task | ~9s | ~1.5-2s |

---

## Implementation Order

### Phase 1: Quick Wins (days)
1. Flash model default + model selector UI
2. KV function index (server-side build + desktop cache)
3. Pre-compile app bundles at upload time

### Phase 2: CF Workers Migration (1-2 weeks)
4. Deploy API as CF Worker (dual deploy)
5. Add D1 bindings, KV namespaces, R2 bindings
6. Worker Loader binding for Dynamic Workers
7. Cutover from DO

### Phase 3: In-Process Execution (1 week)
8. Dynamic Worker recipe execution (replace AsyncFunction)
9. Load pre-compiled app modules into Dynamic Worker
10. Per-app D1 bindings in Dynamic Worker
11. Function call wrappers with permission checks

### Phase 4: Polish (ongoing)
12. Edge deployment optimization
13. Search quality improvements
14. Caching strategies (module cache, result cache)
15. Monitoring and observability (Tail Workers)

---

## Architecture Diagram

```
┌─ User's Desktop ──────────────────────────────────┐
│  localStorage: function index (cached from KV)     │
│  Agent: ul_codemode → ONE recipe call              │
│  Model: Flash (default) or user-selected           │
└──────────────┬─────────────────────────────────────┘
               │ one HTTP call
               ▼
┌─ Cloudflare Edge Node (nearest to user) ──────────┐
│                                                    │
│  Worker (API + Codemode Handler)                   │
│    ├── KV: function index (5ms read)               │
│    ├── KV: pre-compiled app bundles                │
│    │                                               │
│    ├── Dynamic Worker (recipe execution)            │
│    │     ├── recipe.js (agent's code)              │
│    │     ├── email-ops.js (pre-compiled)           │
│    │     ├── resort-manager.js (pre-compiled)      │
│    │     │                                         │
│    │     ├── codemode.approvals_list() → 50ms      │
│    │     │     └── D1: email-ops database          │
│    │     ├── codemode.rooms_list() → 50ms          │
│    │     │     └── D1: resort-manager database     │
│    │     └── return composed result                │
│    │                                               │
│    └── Response to desktop                         │
│                                                    │
│  D1: per-app databases (isolated, edge-local)      │
│  R2: app source code, user files                   │
│  KV: indexes, compiled bundles, caches             │
└────────────────────────────────────────────────────┘

External MCP clients (OpenClaw, API):
  POST /mcp/{appId} → same Worker → same in-process execution
  (HTTP adapter, same result, backward compatible)

GPU Functions:
  RunPod (separate, not edge-colocated)
  Called via HTTP from Dynamic Worker when needed
```
