# P1 Scaling Plan: MVP → Growth Readiness

> **Last updated**: 2026-02-21
> **Status**: P0 complete. Wave 1 complete. Wave 2 (CF Workers data layer) complete. Wave 3 (multi-instance + optimization) complete.

## What Changed Since v1 of This Plan

| Original Item | Status | What Happened |
|---------------|--------|---------------|
| P0: JWT signature verification | **Done** | `auth.ts` now calls Supabase `/auth/v1/user` to verify JWTs server-side |
| P0: Sandbox execution timeout | **Done** | 30s `Promise.race` timeout, timer cleanup, fetch guards (concurrency, size, per-request timeout) |
| P0: Resource limits | **Done** | Max 20 concurrent fetches, 15s per-request timeout, 10MB response limit, 5MB result limit |
| Cron scheduler (was P1 item 5A) | **Done** | Cron **fully deprecated and removed** |
| Permission cache | **Done** | `permission-cache.ts` (LRU, 60s TTL, 5000 entries) |
| Monetization/tier gating | **Done** | All Pro gates removed. Free = Pro. |
| `getUserTier()` in auth | **Done** | `authenticate()` fetches real tier from DB |
| Inter-app calls | **Done** | `ultralight.call()` in sandbox SDK |
| Test suite | **Done** | 200 tests (constraints, parser, sandbox, permission cache) |
| Wave 1: Parallelized Supabase | **Done** | auth+app lookup, gate checks, execution setup all parallelized |
| Wave 1: Instance upgrade | **Done** | `professional-xs` with 1GB RAM |
| Wave 1: Rate limit fail-closed | **Done** | Two-line fix in ratelimit.ts |
| Wave 1: BYOK redundant fetch | **Done** | Eliminated re-fetch in executeAppFunction |
| Wave 2: CF Workers data layer | **Done (Option C)** | Worker deployed at `ultralight-data.rgn4jz429m.workers.dev`. Native R2 bindings for app data (~10x faster). Feature flag: `WORKER_DATA_URL` + `WORKER_SECRET` env vars. |
| Wave 2: Code cache in KV | **Done** | Workers KV namespace `CODE_CACHE` with 5min TTL |
| Wave 3: instance_count: 2 | **Done** | `.do/app.yaml` updated, all in-memory state is multi-instance safe |
| Wave 3: query() concurrency | **Done** | Batch size increased to 50 (from unbounded/10) in `appdata.ts` |
| Wave 3: Read-through data cache | **Done** | `AppDataCache` singleton (2000 entries, 30s TTL) in `appdata.ts` |

### What's Still Open

- Full sandbox execution still on DO (Workers blocks `eval()` — need Workers for Platforms for that)
- App data queries still **O(N)** pattern (mitigated: 50-concurrent batching + 30s data cache + Worker native R2)
- No queryable storage (D1/Supabase) for apps needing SQL-style queries — longer-term item
- Need to set `WORKER_DATA_URL` + `WORKER_SECRET` in DO App Platform to activate Worker data layer

---

## What This Plan Now Covers

Four scaling initiatives (down from five — cron is gone), broken into phases you can ship independently. Each section explains **what it is**, **why it matters in plain terms**, and **what you need to do on your end**.

---

## 1. Cloudflare Workers for MCP Execution (The Big One)

### What it is

When someone calls an MCP tool, their code runs **inside your API server process**. Same CPU, same memory, same everything. The P0 timeout helps (kills async hangs after 30s), but a synchronous `while(true){}` still blocks the event loop for all users. And there's no memory isolation — one function allocating a giant array can OOM the whole server.

Cloudflare Workers gives each function execution its own **isolated V8 sandbox** on Cloudflare's edge network. Instead of everyone cooking in the same kitchen, each order gets its own kitchen with its own stove, timer, and fire extinguisher.

### Why it matters

| Problem | Current (Deno in-process) | With CF Workers |
|---------|--------------------------|-----------------|
| Sync infinite loop | Hangs entire server | Worker killed after 30s CPU time |
| Memory exhaustion | OOMs the server for everyone | Worker capped at 128MB, only it dies |
| Scaling | One `basic-xxs` instance | Auto-scales across 300+ edge locations |
| R2 latency | HTTP round-trips via S3 API (~50-200ms) | Native binding (~5-15ms) |
| Cold start | ~0ms (already loaded) | ~5-50ms (negligible for MCP) |

### What you need to do on your end (Cloudflare setup)

1. **Create a Workers project** — `npx wrangler init ultralight-sandbox` (or via dashboard)
2. **Bind your existing R2 bucket** (`ultralight-apps`) to the Worker as an R2 binding
3. **Create a KV namespace** called `CODE_CACHE` — for bundled code storage (replaces in-memory LRU)
4. **Set environment variables** in the Worker: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
5. **Create a shared secret** for authenticating calls from your DO API → Worker (a simple bearer token)

### Phases

#### Phase 1A: Worker Sandbox — The Execution Engine

Build a Cloudflare Worker that receives a POST from your API server and runs user code in isolation.

**Input** (POST body from API server):
```json
{
  "code": "<bundled IIFE string>",
  "functionName": "addTweet",
  "args": [{ "text": "hello" }],
  "appId": "app-xxx",
  "userId": "user-yyy",
  "envVars": { "API_KEY": "decrypted-value" },
  "supabase": { "url": "...", "anonKey": "...", "serviceKey": "..." },
  "baseUrl": "https://ultralight.ai",
  "authToken": "ul_xxx"
}
```

**Output**:
```json
{
  "success": true,
  "result": { "id": "tweet-123" },
  "logs": [{ "time": "...", "level": "log", "message": "[SDK] store(\"tweet_123\")" }],
  "durationMs": 142
}
```

**What moves to the Worker**: Everything currently in `executeInSandbox()` from `sandbox.ts`:
- The SDK object (`ultralight.store/load/remove/list/query/ai/call`)
- The stdlib globals (`_`, `uuid`, `base64`, `hash`, `dateFns`, `schema`, `markdown`, `str`, `jwt`, `http`)
- The `AsyncFunction` constructor + IIFE execution wrapper
- The `openFetch` with HTTPS enforcement
- Timer management and cleanup
- Console capture
- Result size guard

**What changes**:
- R2 storage calls in `AppDataService` go from HTTP-via-S3-API → native `env.R2_BUCKET.get(key)` / `.put(key, value)`. This is the biggest performance win — every `ultralight.store()`, `.load()`, `.query()` call drops from ~50-200ms to ~5-15ms.
- The Supabase client creation stays the same (it uses `fetch` internally, which Workers support natively)
- `ultralight.call()` stays the same — it's just a `fetch()` to your API server's MCP endpoint

**Key compatibility note**: Your sandbox code uses `AsyncFunction` constructor, `fetch`, `crypto.subtle`, `TextEncoder/Decoder`, `atob/btoa`, `URL`, `JSON`, `Promise`, `Map`, `Set` — **all of these are available in Workers**. No Deno-specific APIs. The IIFE bundle format from esbuild is also Workers-compatible. This is a port, not a rewrite.

#### Phase 1B: Wire API Server → Worker

Modify `executeAppFunction()` in `mcp.ts` to dispatch to the Worker instead of calling `executeInSandbox()` locally.

The API server continues to handle all pre-execution work:
1. Authentication (JWT/API token verification)
2. Rate limiting (per-endpoint + per-app)
3. Weekly call tracking
4. App lookup + permission checks
5. Code fetch from R2 (or code cache)
6. User profile + BYOK key decryption
7. Env var decryption
8. Supabase config resolution

Then it POSTs the assembled config to the Worker and returns the result.

**Implementation**: Add a feature flag `USE_WORKER_SANDBOX` env var. When set, `executeAppFunction()` calls the Worker. When unset, falls back to local `executeInSandbox()`. This lets you ship incrementally and roll back instantly.

```
// Pseudocode for the switch
if (Deno.env.get('USE_WORKER_SANDBOX')) {
  result = await dispatchToWorker({ code, functionName, args, envVars, ... });
} else {
  result = await executeInSandbox(config, functionName, args);
}
```

#### Phase 1C: Code Cache → Workers KV

Replace the in-memory `CodeCache` singleton (`codecache.ts`) with Workers KV:

- **On upload**: After esbuild bundles the code, write it to KV with key `code:{appId}:{version}` and to R2 as before (KV is the fast-path, R2 is the durable backup)
- **On execution**: Worker reads from KV first (~5ms global read), falls back to R2 on miss
- **On deploy/republish**: Write new version to KV (old version auto-expires via KV TTL)

This solves three problems at once:
1. **Cold start penalty**: No more empty cache after every deploy (KV persists)
2. **Multi-instance consistency**: KV is globally replicated, not per-process
3. **Latency**: KV reads are ~5ms from the nearest edge vs ~100-200ms for R2

---

## 2. Parallelize Sequential Supabase Calls

### What it is

Every MCP `tools/call` request makes **7-10 sequential HTTP calls** to Supabase before user code starts. Each call waits for the previous one to finish, even when they don't depend on each other's results.

Think of it like this: you need milk, eggs, and bread. Instead of sending three people to the store at the same time, you send one person for milk, wait for them to come back, then send someone for eggs, wait again, then send someone for bread.

### Why it matters

On the worst-case path (private app, JWT auth, BYOK, per-user secrets), framework overhead is **~700-800ms** before user code runs. With parallelization, that drops to **~300ms** — a 60% reduction. For a tool that's supposed to feel instant to an AI agent, this is the difference between "snappy" and "sluggish."

### What you need to do on your end

Nothing external — purely code reorganization.

### Current call sequence in `handleMcp()` (all sequential today)

```
[A] authenticate()                   line 437  ~50ms  (depends on: nothing)
[B] checkRateLimit(endpoint)         line 509  ~30ms  (depends on: A — needs userId)
[C] checkAndIncrementWeeklyCalls()   line 520  ~30ms  (depends on: A — needs userId + tier)
[D] appsService.findById()           line 532  ~30ms  (depends on: nothing)
[E] checkRateLimit(app:minute)       line 563  ~30ms  (depends on: A + D)
[F] checkRateLimit(app:day)          line 573  ~30ms  (depends on: A + D)
[G] getPermissionsForUser()          line 588  ~30ms  (depends on: A + D, cached after first call)
```

Then in `executeAppFunction()` (all sequential):
```
[H] R2 code fetch (cache miss)      line 1164  ~100-200ms  (depends on: D)
[I] userService.getUser()           line 1182  ~30ms       (depends on: A)
[J] getDecryptedApiKey()            line 1187  ~30ms       (depends on: I — REDUNDANT re-fetch)
[K] decryptEnvVars()                line 1222  ~0ms CPU    (depends on: nothing)
[L] per-user secrets fetch          line 1242  ~30ms       (depends on: A + D)
[M] getDecryptedSupabaseConfig()    line 1294  ~30ms       (depends on: D)
```

### Phases

#### Phase 2A: Parallelize auth + app lookup

`authenticate()` and `appsService.findById()` are completely independent. Auth needs the request headers; findById needs the appId from the URL.

```typescript
// Before (sequential, ~60ms):
const user = await authenticate(request);
// ... rate limit ...
const app = await appsService.findById(appId);

// After (parallel, ~30ms):
const [user, app] = await Promise.all([
  authenticate(request),
  appsService.findById(appId),
]);
```

Also inside `authenticate()` for the JWT path: `ensureUserExists()` and `getUserTier()` are both independent after the Supabase Auth verify call returns. They can run in parallel:

```typescript
// Before (sequential):
await ensureUserExists(user);
const tier = await getUserTier(user.id);

// After (parallel):
const [, tier] = await Promise.all([
  ensureUserExists(user).catch(() => {}),
  getUserTier(user.id).catch(() => 'free' as Tier),
]);
```

**Saves ~30-50ms per request.**

#### Phase 2B: Parallelize gate checks

After auth + app lookup resolve, these are all independent:

```typescript
// Before (sequential, ~120ms for 4 calls):
await checkRateLimit(userId, endpoint);
await checkAndIncrementWeeklyCalls(userId, tier);
await checkRateLimit(userId, `app:${appId}:minute`);
await checkRateLimit(userId, `app:${appId}:day`);

// After (parallel, ~30ms):
const [endpointRL, weeklyRL, appMinuteRL, appDayRL] = await Promise.all([
  checkRateLimit(userId, endpoint),
  checkAndIncrementWeeklyCalls(userId, tier),
  app.rate_limit_config ? checkRateLimit(...) : null,
  app.rate_limit_config ? checkRateLimit(...) : null,
]);
// Check results, return errors as needed
```

**Saves ~90ms per request.**

#### Phase 2C: Parallelize execution setup in `executeAppFunction()`

These four calls are independent:
- R2 code fetch (~100-200ms on cache miss — the bottleneck)
- `getUser()` for BYOK profile (~30ms)
- Per-user secrets fetch (~30ms, conditional)
- Supabase config fetch (~30ms, conditional)

```typescript
// Before (sequential, ~250ms+):
const code = await fetchCode(...);
const userProfile = await getUser(userId);
const apiKey = await getDecryptedApiKey(userId, ...);  // re-fetches user!
const envVars = await decryptEnvVars(...);
const secrets = await fetchUserSecrets(...);
const sbConfig = await getDecryptedSupabaseConfig(...);

// After (parallel, ~200ms — R2 is the long pole):
const [code, userProfile, envVars, secrets, sbConfig] = await Promise.all([
  fetchCode(...),
  userService.getUser(userId),
  decryptEnvVars(...),              // CPU only, but harmless in Promise.all
  fetchUserSecrets(...),            // conditional
  getDecryptedSupabaseConfig(...),  // conditional
]);
// Then decrypt API key from userProfile.byok_keys (no extra query)
```

**Saves ~100-200ms per request.**

#### Phase 2D: Eliminate redundant BYOK re-fetch

`getDecryptedApiKey()` at line 1187 internally calls `getRawByokKeys()`, which fetches `byok_keys` from the `users` table. But `getUser()` at line 1182 already returned the full user profile **including `byok_keys`**.

Fix: Extract `byok_keys` from the `getUser()` result and decrypt locally instead of making another Supabase query.

**Saves ~30ms and one Supabase call per BYOK-enabled request.**

### Optimized call graph after all Phase 2 work

```
REQUEST
    |
    |  ┌──────────────────┐  ┌──────────────────┐
    +─→│ authenticate()   │  │ findById(appId)  │  (parallel)
    |  └──────┬───────────┘  └──────┬───────────┘
    |         |                      |
    |  ┌──────┴──────────────────────┴──────────────────────┐
    +─→│ checkRateLimit || weeklyIncrement || appRL || perms │  (parallel)
    |  └──────┬─────────────────────────────────────────────┘
    |         |
    |  ┌──────┴──────────────────────────────────────────┐
    +─→│ R2 fetch || getUser || secrets || sbConfig      │  (parallel)
    |  └──────┬──────────────────────────────────────────┘
    |         |
    |         v
    |  [executeInSandbox]  (or Worker dispatch)
    |         |
    |         v
    |  [logMcpCall]  (fire-and-forget)
    |
    v  RESPONSE

Worst-case overhead: ~300ms (down from ~800ms)
```

---

## 3. Add Data Caching Layer

### What it is

When user code calls `ultralight.query('tweets/')` and there are 1,000 tweets, the system fires **1,001 HTTP requests** to R2 (1 list + 1,000 individual GETs). There's no caching, no indexing, no server-side filtering. Every `ultralight.load()` call is a fresh HTTP round-trip to Cloudflare R2.

### Why it matters in plain terms

Imagine a library where, to find a book, you have to walk to a warehouse across town, grab one book, walk back, walk to the warehouse again for the next book... A cache is like keeping a shelf of recently-used books right next to your desk. A real database is like having a librarian who can search the whole collection instantly.

### What you need to do on your end

If going the Workers route (Phase 1), R2 bindings already provide ~5-15ms reads — which may make caching unnecessary for `load()`. The main benefit shifts to `query()` optimization.

### Phases

#### Phase 3A: Optimize `query()` concurrency (Quick win)

The current `query()` implementation in `appdata.ts` fetches all matching objects with `Promise.all` in batches of 10. Increase to 50+ parallel fetches. This is a one-line change.

If on Workers with native R2 bindings, `query()` becomes much faster by default (~5-15ms per GET instead of ~50-200ms), making the batch size less critical.

#### Phase 3B: Add read-through cache for `load()`

Add a short-TTL cache for individual key lookups. Options:
- **If on Workers**: Workers KV as a read-through cache. On `store()`, write to both R2 (durable) and KV (fast). On `load()`, read KV first, fall back to R2.
- **If on DO single instance**: Simple in-memory `Map` with 30s TTL is fine for now.

Most app data reads are repeated within a session (e.g., loading config, preferences, counters). Even a 30-second cache eliminates the majority of round-trips.

#### Phase 3C: (Longer term) Supabase or D1 for queryable storage

For apps that need real queries (filtering by field value, sorting, pagination), the R2 KV model is fundamentally wrong. Options:
- **Cloudflare D1** (SQLite at the edge): ~5ms queries, SQL-based, natural fit for Workers
- **Supabase**: Users who connect their own Supabase project already get this via the SDK's `supabase.from()` client
- Keep R2 as the "simple KV" tier, offer D1/Supabase as the "queryable" tier

---

## 4. Upgrade Instance + Externalize State for Multi-Instance

### What it is

The entire platform runs on a **single `basic-xxs` container** — 512MB RAM, shared CPU, one instance, no redundancy. If it crashes, every user is down.

Before you can add a second instance, you need to fix the remaining in-memory state that would become inconsistent across instances.

### Why it matters in plain terms

One cashier at a store — if they take a break, the line stops. Adding a second cashier means customers flow twice as fast and there's always someone available. But first you need a shared cash register, otherwise each cashier has their own count and the books don't balance.

### What you need to do on your end

**Phase 4A**: In `.do/app.yaml`, change `instance_size_slug: basic-xxs` → `professional-xs` (1GB RAM, dedicated CPU) or `professional-s` (2GB). No code changes needed.

**Phase 4B+**: After externalizing state, change `instance_count: 1` → `2`.

### Remaining in-memory state (after cron removal)

| Component | File | What breaks with 2 instances |
|-----------|------|------------------------------|
| Code Cache | `codecache.ts` — `Map` with 1000 entries, 5min TTL | Instance A serves stale code after B handles a deploy |
| Permission Cache | `permission-cache.ts` — `Map` with 5000 entries, 60s TTL | Permission grant/revoke on instance A not seen by B for up to 60s |
| Rate Limit Fallback | `ratelimit.ts` — fails open on Supabase error | Not worse with 2 instances, but still a security gap |
| Session Sequences | `mcp.ts` — `Map` for call ordering counters | Duplicate sequence numbers in logs (cosmetic) |

Note: The cron scheduler was the **biggest blocker** for multi-instance (it would fire every job N times). With cron removed, the remaining state is much less dangerous — mostly cache staleness and cosmetic issues.

### Phases

#### Phase 4A: Upgrade instance size (Do now, no code changes)

Change `basic-xxs` → `professional-xs` or `professional-s`. Gives more RAM for concurrent user code executions and esbuild bundling.

#### Phase 4B: Rate limit fallback → fail-closed

Currently, `ratelimit.ts` lines 84-93 and 108-115 **allow all requests** when Supabase is unreachable. Change to deny requests instead:

```typescript
// Before (fail-open):
return { allowed: true, remaining: effectiveLimit, resetAt: ... };

// After (fail-closed):
return { allowed: false, remaining: 0, resetAt: ... };
```

This is a two-line change that closes a meaningful abuse vector.

#### Phase 4C: Code cache → Workers KV (same as Phase 1C)

If doing Workers, this is solved by Phase 1C. If not, replace the in-memory `Map` with a Redis `SETEX`/`GET` pattern. DigitalOcean managed Redis is ~$15/mo.

#### Phase 4D: Permission cache consistency

The permission cache already has `invalidateByApp()` and `invalidateByUserAndApp()` methods that are called on grant/revoke. With two instances, a grant on instance A won't invalidate instance B's cache until the 60s TTL expires.

Options (in order of simplicity):
1. **Accept 60s staleness** — for most use cases, a 60s delay on permission changes is fine
2. **Reduce TTL** — 15s instead of 60s, more Supabase queries but tighter consistency
3. **Redis pub/sub** — publish invalidation events, both instances subscribe

For early growth, option 1 is fine. Permission changes are rare compared to reads.

#### Phase 4E: Add second instance

After 4B and 4C, change `instance_count: 1` → `2` in `.do/app.yaml`. Session sequence duplicates are cosmetic and can be ignored or fixed later.

---

## Recommended Execution Order

```
WAVE 1: Quick Wins ✅ COMPLETE
├── Phase 2A: Parallelize auth + app lookup in handleMcp()       ✅
├── Phase 2B: Parallelize gate checks (rate limit + weekly)      ✅
├── Phase 2C: Parallelize execution setup in executeAppFunction() ✅
├── Phase 2D: Eliminate redundant BYOK re-fetch                  ✅
├── Phase 4A: Upgrade instance size (professional-xs)            ✅
└── Phase 4B: Rate limit fail-closed                             ✅

WAVE 2: Cloudflare Workers Data Layer (Option C) ✅ COMPLETE
├── Built Worker as R2 data-layer API (not sandbox executor)     ✅
├── Deployed to ultralight-data.rgn4jz429m.workers.dev           ✅
├── Code cache in Workers KV (5min TTL)                          ✅
├── createWorkerAppDataService() in api/services/appdata.ts      ✅
└── Feature flag: WORKER_DATA_URL + WORKER_SECRET env vars       ✅
    (set in DO App Platform to enable; remove to fall back)

WAVE 3: Multi-Instance + Optimization ✅ COMPLETE
├── Phase 4E: instance_count: 2 in .do/app.yaml               ✅
├── Phase 3A: query() batching (50 concurrent, up from unbounded/10) ✅
├── Phase 3B: Read-through data cache (30s TTL, 2000 entries)  ✅
├── WORKER_DATA_URL + WORKER_SECRET added to .do/app.yaml      ✅
└── Phase 3C: D1/Supabase for queryable storage (longer term)

FUTURE: Workers for Platforms ($25/month upgrade)
├── Full V8 isolate sandbox execution on CF edge
├── Files preserved in worker/src/_future-wfp/
└── Removes the last single-server bottleneck (code execution)
```

**Wave 1** ✅ Completed — parallelized Supabase calls (~800ms → ~300ms), upgraded instance, fail-closed rate limiting.

**Wave 2** ✅ Completed as **Option C** — Worker deployed as native R2 data layer (~10x faster storage ops). Full sandbox execution blocked by Workers eval restriction; preserved sandbox code for future Workers for Platforms migration.

**Wave 3** ✅ Completed — 2 instances enabled, query() concurrency 5x'd (10→50), read-through data cache added (30s TTL, 2000 entries). D1/Supabase for queryable storage deferred as a longer-term item.

---

## Architecture After P1 (Option C)

```
┌───────────────────────┐          ┌──────────────────────┐
│  DO API Server(s)      │          │  CF Worker             │
│  (Control + Execution) │          │  (Data Layer)          │
│                        │          │                        │
│  • JWT/token auth      │  POST    │  • Native R2 bindings  │
│  • Rate limiting       │ ───────▶ │  • store/load/remove   │
│  • App lookup          │          │  • list/batch ops      │
│  • Permissions         │  Result  │  • Code fetch + cache  │
│  • BYOK decrypt        │ ◀─────  │  • KV code cache       │
│  • Upload/bundle       │          │  • Shared secret auth  │
│  • Dashboard UI        │          │                        │
│  • MCP routing         │          └──────────────────────┘
│  • Code execution      │                    │
│    (local sandbox)     │                    │
│  • instance_count: 2   │                    │
└───────────────────────┘                    │
        │                                    │
        ▼                                    ▼
   ┌─────────┐    ┌───────────┐       ┌───────────┐
   │Supabase │    │ Workers   │       │ R2 Bucket  │
   │  (DB)   │    │ KV Cache  │       │ (Storage)  │
   └─────────┘    └───────────┘       └───────────┘
```

The API server handles all auth, business logic, and code execution (local sandbox).
The CF Worker provides a fast R2 data layer with native bindings (~5-15ms vs ~50-200ms).
Feature-flagged via `WORKER_DATA_URL` + `WORKER_SECRET` env vars — remove to fall back.

**Future**: Workers for Platforms ($25/month) enables moving code execution to CF edge
with true V8 isolate sandboxing. Files preserved in `worker/src/_future-wfp/`.
