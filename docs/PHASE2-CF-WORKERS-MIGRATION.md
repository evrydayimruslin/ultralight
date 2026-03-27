# Phase 2: Cloudflare Workers Migration — Implementation Plan

## Context

The API currently runs as a Deno app on DigitalOcean App Platform. To achieve edge colocation (API + D1 + R2 + Dynamic Workers all at the same location), we need to migrate to Cloudflare Workers.

**Current stack:** Deno 2.2 → Docker → DigitalOcean App Platform
**Target stack:** Cloudflare Workers + Scheduled Workers + existing data Worker

## Complexity Assessment

The API is 84 TypeScript files. The main blockers are:

1. **`Deno.serve()`** — 1 occurrence, replace with Workers fetch handler
2. **`Deno.env.get()`** — 154 occurrences across 39 files, replace with `env.*` bindings
3. **Background jobs** — 14 interval-based services, must move to Scheduled Workers (cron triggers)
4. **R2 access** — currently HTTP-signed requests, switch to native R2 binding
5. **D1 access** — currently HTTP API calls, can switch to native D1 binding

**Good news:** No filesystem I/O. All data access is via HTTP (Supabase, R2, D1). The request handler uses standard `fetch()` API (already Workers-compatible). The existing `worker/` directory already has a CF Worker with R2+KV bindings.

## Architecture: Three Workers

```
┌─ Worker 1: API (main) ────────────────────┐
│  Handles: all HTTP routes                  │
│  Bindings: R2_BUCKET, KV (CODE_CACHE),     │
│            D1 databases, LOADER (Dynamic)  │
│  Replaces: Deno app on DigitalOcean        │
└────────────────────────────────────────────┘

┌─ Worker 2: Scheduled (cron) ──────────────┐
│  Handles: background jobs on cron triggers │
│  - Hosting billing (hourly)                │
│  - D1 billing (hourly)                     │
│  - Embedding processing (every 5 min)      │
│  - Auto-healing (every 30 min)             │
│  - Payout processing (weekly)              │
│  - Async job cleanup (every 60s)           │
│  - GPU build processing                    │
│  Bindings: same as API Worker              │
└────────────────────────────────────────────┘

┌─ Worker 3: Data (existing) ───────────────┐
│  Already deployed, handles R2/D1 proxy     │
│  May be MERGED into Worker 1 post-migration│
└────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1: Create Unified wrangler.toml (Day 1)

Create `api/wrangler.toml` for the main API Worker:

```toml
name = "ultralight-api"
main = "src/worker-entry.ts"
compatibility_date = "2026-03-01"
compatibility_flags = ["nodejs_compat"]

# Bindings
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "ultralight-apps"

[[kv_namespaces]]
binding = "CODE_CACHE"
id = "d348ee797036460faf4b3e014921f0b0"

[[kv_namespaces]]
binding = "FN_INDEX"
id = "..." # New KV namespace for function indexes

[[worker_loaders]]
binding = "LOADER"

# Environment variables (from secrets)
[vars]
BASE_URL = "https://ultralight-api.workers.dev"

# Cron triggers for scheduled worker
[triggers]
crons = [
  "* * * * *",      # every minute: async job cleanup
  "*/5 * * * *",    # every 5 min: embedding processor
  "0 * * * *",      # hourly: hosting billing, D1 billing
  "*/30 * * * *",   # every 30 min: auto-healing
  "0 0 * * 0",      # weekly: payout processing
]
```

### Step 2: Create Worker Entry Point (Day 1-2)

**New file:** `api/src/worker-entry.ts`

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Set env globally so existing code can access it
    globalThis.__env = env;

    // Import and call existing router
    const { createApp } = await import('./handlers/app.ts');
    const handler = createApp();

    // Apply CORS + security headers (same as current main.ts)
    const response = await handler(request);
    return applyHeaders(response);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    globalThis.__env = env;

    // Route cron jobs based on trigger
    switch (event.cron) {
      case '* * * * *':
        await runAsyncJobCleanup();
        break;
      case '*/5 * * * *':
        await runEmbeddingProcessor();
        break;
      case '0 * * * *':
        await runHostingBilling();
        await runD1Billing();
        break;
      // ...
    }
  }
};
```

### Step 3: Replace Deno.env.get() (Day 2-3)

Create a compatibility layer — 154 occurrences across 39 files:

**New file:** `api/lib/env.ts`
```typescript
// Universal env access — works in both Deno and CF Workers
export function getEnv(key: string): string {
  // CF Workers: env is set on globalThis by worker-entry.ts
  if (globalThis.__env?.[key]) return globalThis.__env[key];
  // Deno fallback (for local dev)
  if (typeof Deno !== 'undefined') return Deno.env.get(key) || '';
  return '';
}
```

Then search-and-replace `Deno.env.get('KEY')` → `getEnv('KEY')` across all files. This is mechanical — no logic changes.

**Files to update (39 files, 154 occurrences):**
- api/main.ts
- api/handlers/auth.ts, chat.ts, platform-mcp.ts, mcp.ts, upload.ts, app.ts
- api/services/*.ts (storage, d1-data, async-jobs, etc.)
- api/runtime/sandbox.ts

### Step 4: Replace R2 HTTP Signing with Native Binding (Day 3)

**File:** `api/services/storage.ts`

Current: R2Service uses AWS Sig V4 HTTP signing (100+ lines of crypto)
Target: Use native `env.R2_BUCKET` binding (5 lines per operation)

```typescript
// Before (signed HTTP)
async fetchFile(key: string): Promise<Uint8Array> {
  const headers = await this.signRequest('GET', `/${key}`);
  const response = await fetch(url, { headers });
  return new Uint8Array(await response.arrayBuffer());
}

// After (native binding)
async fetchFile(key: string): Promise<Uint8Array> {
  const obj = await globalThis.__env.R2_BUCKET.get(key);
  if (!obj) throw new Error(`File not found: ${key}`);
  return new Uint8Array(await obj.arrayBuffer());
}
```

Keep the HTTP implementation as fallback for local Deno dev.

### Step 5: Convert Background Jobs to Scheduled Workers (Day 3-4)

Extract the job logic from setInterval wrappers into standalone functions:

```typescript
// Before (setInterval in api/main.ts)
export function startHostingBillingJob() {
  setTimeout(() => {
    setInterval(async () => {
      await processHostingBilling();
    }, 60 * 60 * 1000); // hourly
  }, 15_000);
}

// After (scheduled handler)
export async function runHostingBilling() {
  await processHostingBilling(); // same core logic
}
```

The `processHostingBilling()` function stays the same. Only the scheduling wrapper changes.

**14 jobs to convert:**

| Job | Current Interval | Cron Schedule |
|-----|-----------------|---------------|
| asyncJobCleanup | 60s | `* * * * *` |
| embeddingProcessor | 5 min | `*/5 * * * *` |
| hostingBilling | 1 hour | `0 * * * *` |
| d1Billing | 1 hour | `0 * * * *` |
| autoHealing | 30 min | `*/30 * * * *` |
| payoutProcessor | 24 hours | `0 0 * * *` |
| gpuBuildProcessor | 30s | `* * * * *` |
| subscriptionExpiry | 1 hour | `0 * * * *` |

### Step 6: Add D1 Native Bindings (Day 4-5)

**File:** `api/services/d1-data.ts`

Currently calls Cloudflare HTTP API for D1 queries. With native D1 binding, queries become local calls:

```typescript
// Before (HTTP API)
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${dbId}/query`,
  { method: 'POST', headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` }, body: JSON.stringify({ sql, params }) }
);

// After (native binding)
const db = globalThis.__env[`D1_${dbId}`]; // pre-configured binding
const result = await db.prepare(sql).bind(...params).all();
```

**Challenge:** Each app has its own D1 database. Dynamic D1 bindings aren't supported — bindings must be declared in wrangler.toml. Options:
- **Option A:** Keep HTTP API for per-app D1 (works, slightly slower)
- **Option B:** Use a pool of D1 bindings and map apps to them
- **Option C:** Migrate all apps to shared D1 with user_id isolation

**Recommendation:** Option A for now (keep HTTP), migrate to Option C later. The HTTP API adds ~50ms per query — acceptable for Phase 2.

### Step 7: Add Dynamic Worker Loader Binding (Day 5)

Already in wrangler.toml from Step 1. The `LOADER` binding enables `env.LOADER.load()` for recipe execution.

Update `api/runtime/codemode-executor.ts` to use Dynamic Workers when available:

```typescript
export async function executeCodeMode(code, fns, timeout) {
  const loader = globalThis.__env?.LOADER;

  if (loader) {
    // CF Workers path — true isolation
    return executeDynamicWorker(loader, code, fns, timeout);
  } else {
    // Deno/local dev path — AsyncFunction (existing)
    return executeAsyncFunction(code, fns, timeout);
  }
}
```

### Step 8: Dual Deploy + Testing (Day 5-7)

1. Deploy to CF Workers alongside existing DO deployment
2. Route test subdomain (e.g., `api-edge.ultralight.com`) to CF Worker
3. Run full test suite against both endpoints
4. Compare latency, correctness, error rates
5. Gradual traffic migration: 10% → 50% → 100%
6. Decommission DO deployment

### Step 9: KV Migration for Function Index (Day 7)

Move function index from R2 to KV (faster reads):

```typescript
// Before (R2 — ~20ms)
const text = await r2.fetchTextFile(`users/${userId}/function-index.json`);

// After (KV — ~5ms at edge)
const index = await env.FN_INDEX.get(`user:${userId}`, 'json');
```

## Risk Mitigation

**1. npm imports in CF Workers:**
The codebase uses `import('npm:@supabase/supabase-js@2')` — Deno-specific npm resolution. CF Workers use standard npm imports with `node_modules`. Solution: change imports to standard `import { createClient } from '@supabase/supabase-js'` and bundle with wrangler.

**2. Request size limits:**
CF Workers have 128MB request size limit (free) or unlimited (paid). Current limit is 50MB — compatible.

**3. Execution time:**
CF Workers have 30s CPU time limit (paid plan). Most requests complete in <5s. Long-running operations (GPU builds, embedding generation) should use `ctx.waitUntil()` or stay on external infrastructure.

**4. Supabase compatibility:**
`@supabase/supabase-js` works in CF Workers (it uses fetch internally). No changes needed.

## Files Summary

| File | Action | Step |
|------|--------|------|
| `api/wrangler.toml` | CREATE | 1 |
| `api/src/worker-entry.ts` | CREATE | 2 |
| `api/lib/env.ts` | CREATE | 3 |
| 39 files with Deno.env.get | MODIFY | 3 |
| `api/services/storage.ts` | MODIFY | 4 |
| 8 background job files | MODIFY | 5 |
| `api/main.ts` | MODIFY (keep for local dev) | 2, 5 |
| `api/services/d1-data.ts` | OPTIONAL MODIFY | 6 |
| `api/runtime/codemode-executor.ts` | MODIFY | 7 |
| `api/services/function-index.ts` | MODIFY | 9 |

## Timeline

- **Day 1-2:** wrangler.toml + worker entry point + env compatibility layer
- **Day 3:** R2 native bindings + start background job conversion
- **Day 4-5:** Complete job conversion + D1 review + Dynamic Worker binding
- **Day 5-7:** Dual deploy + testing + traffic migration
- **Day 7:** KV migration for function index

**Total: ~7-10 days for a 10x developer.**

## Post-Migration Benefits

- API responds from edge closest to user (~10-50ms latency vs ~100-200ms)
- R2/KV reads are local (~5ms vs ~50ms signed HTTP)
- Dynamic Workers available for recipe isolation
- Background jobs run reliably on cron (no lost intervals on deploy)
- Foundation for Phase 3 (in-process MCP calls)
