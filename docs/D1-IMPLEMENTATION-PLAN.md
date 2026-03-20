# D1 Implementation Plan: Relational Data Layer for Ultralight

> **Status:** Implemented
> **Author:** Architecture Review
> **Date:** 2026-03-20
> **Scope:** Add Cloudflare D1 (SQLite) as the structured data layer for all Ultralight MCP apps. R2 remains for code/assets. SQL-only API from day one.

---

## Executive Summary

Replace the R2-backed KV data layer (`ultralight.store/load/query`) with a Cloudflare D1-backed relational SQL API (`ultralight.db.run/all/first/exec`). Each published app gets its own D1 database. All user data is isolated by a mandatory `user_id` column enforced at the SDK level. Storage billing stays per-user via metering tables within each D1. R2 continues to serve code bundles, static assets, and large blobs.

**Key Decisions (locked):**
- One D1 database per app (transfers cleanly on marketplace sale)
- SQL-only developer API (no KV abstraction — agents write SQL natively)
- `migrations/` folder with numbered SQL files, auto-run on deploy
- Lazy D1 provisioning (created on first `ultralight.db` call)
- Per-user metering with micropayment billing beyond free tier
- Agent-readable `ultralight-spec/` conventions directory as single source of truth

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase 1 — Foundation: D1 Provisioning & Binding](#2-phase-1--foundation)
3. [Phase 2 — SDK: `ultralight.db` API Surface](#3-phase-2--sdk)
4. [Phase 3 — Migration System](#4-phase-3--migration-system)
5. [Phase 4 — User Isolation (Application-Level RLS)](#5-phase-4--user-isolation)
6. [Phase 5 — Metering & Billing](#6-phase-5--metering--billing)
7. [Phase 6 — Worker & Data Layer Changes](#7-phase-6--worker--data-layer)
8. [Phase 7 — GPU Runtime D1 Access](#8-phase-7--gpu-runtime-d1-access)
9. [Phase 8 — Marketplace Transfer](#9-phase-8--marketplace-transfer)
10. [Phase 9 — Agent-Readable Spec (`ultralight-spec/`)](#10-phase-9--agent-spec)
11. [Phase 10 — Desktop Agent Integration](#11-phase-10--desktop-agent)
12. [File-by-File Change Map](#12-file-change-map)
13. [Migration Path for Existing Sample Apps](#13-sample-app-migration)
14. [Risk Register](#14-risk-register)
15. [Appendix: D1 Limits & Constraints](#15-appendix)

---

## 1. Architecture Overview

### Before (Current)

```
App Code → sandbox.ts → ultralight.store/load/query
                              ↓
                     appdata.ts (AppDataService)
                              ↓
                     Worker (native R2 bindings)
                              ↓
                     R2 Bucket: ultralight-apps
                     Path: apps/{appId}/users/{userId}/data/{key}.json
```

**Problem:** Every "query" is a full key scan — list all keys, batch-load all values, filter in memory. No indexes, no joins, no aggregations. O(n) on every read that isn't a direct key lookup.

### After (D1)

```
App Code → sandbox.ts → ultralight.db.run/all/first/exec
                              ↓
                     d1-data.ts (D1DataService)
                              ↓
                     Worker (native D1 bindings)
                              ↓
                     D1 Database: ultralight-{appId}
                     Tables: developer-defined via migrations/

App Code → sandbox.ts → ultralight.store/load (unchanged for code/assets)
                              ↓
                     R2 Bucket: ultralight-apps (code bundles only)
```

### Side-by-Side Layer Responsibilities

| Layer | Before | After |
|-------|--------|-------|
| **R2** | Code + assets + all app data | Code + assets + large blobs only |
| **D1** | (doesn't exist) | All structured app data |
| **Worker** | R2 data ops + code cache | D1 query proxy + R2 code cache |
| **Supabase** | Auth, app registry, billing, metering | Auth, app registry, billing, metering + D1 database IDs |
| **KV** | Code cache | Code cache (unchanged) |

---

## 2. Phase 1 — Foundation: D1 Provisioning & Binding

### 2.1 Supabase Schema Changes

Add a `d1_database_id` column to the `apps` table to track which D1 database belongs to which app.

```sql
-- migration: add_d1_database_tracking.sql

ALTER TABLE apps ADD COLUMN d1_database_id TEXT DEFAULT NULL;
ALTER TABLE apps ADD COLUMN d1_status TEXT DEFAULT NULL
  CHECK (d1_status IN ('pending', 'provisioning', 'ready', 'error'));
ALTER TABLE apps ADD COLUMN d1_provisioned_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE apps ADD COLUMN d1_last_migration_version INTEGER DEFAULT 0;

COMMENT ON COLUMN apps.d1_database_id IS 'Cloudflare D1 database UUID, null until first ultralight.db call';
COMMENT ON COLUMN apps.d1_status IS 'Provisioning state: pending→provisioning→ready or error';
```

### 2.2 D1 Provisioning Service

New file: `api/services/d1-provisioning.ts`

```typescript
// D1 Provisioning Service
// Lazy-creates a D1 database per app via Cloudflare API.
// Called on first ultralight.db.* invocation.

interface D1ProvisionResult {
  databaseId: string;
  databaseName: string;
  status: 'ready' | 'error';
  error?: string;
}

export async function provisionD1ForApp(appId: string): Promise<D1ProvisionResult> {
  // 1. Check if already provisioned (read apps.d1_database_id from Supabase)
  // 2. If pending/provisioning, wait with exponential backoff (another request is creating it)
  // 3. Set d1_status = 'provisioning' (optimistic lock via UPDATE ... WHERE d1_status IS NULL)
  // 4. Call Cloudflare API: POST /accounts/{account_id}/d1/database
  //    Body: { name: `ultralight-${appId}` }
  // 5. Store d1_database_id in apps table
  // 6. Run initial system tables (_migrations, _usage)
  // 7. Run app migrations/ if any exist
  // 8. Set d1_status = 'ready'
  // Returns: { databaseId, databaseName, status }
}

export async function getD1DatabaseId(appId: string): Promise<string | null> {
  // Fast path: read from apps table cache or direct Supabase query
}

export async function deleteD1ForApp(appId: string): Promise<void> {
  // Called on app deletion. DELETE /accounts/{account_id}/d1/database/{database_id}
}
```

**Cloudflare API calls needed:**
- `POST /accounts/{CF_ACCOUNT_ID}/d1/database` — create database
- `DELETE /accounts/{CF_ACCOUNT_ID}/d1/database/{id}` — delete database
- `POST /accounts/{CF_ACCOUNT_ID}/d1/database/{id}/query` — execute SQL (used by Worker)

### 2.3 Environment Variables (New)

```env
# Add to API server environment
CF_ACCOUNT_ID=<cloudflare account id>
CF_API_TOKEN=<cloudflare api token with D1 permissions>
```

### 2.4 Worker Binding Changes

The Worker needs D1 access. Since each app has its own D1, the Worker can't use static `wrangler.toml` bindings (those are fixed at deploy time). Instead, the Worker will proxy D1 queries through the Cloudflare REST API, or we use a **dispatch Worker** pattern.

**Recommended approach:** The API server calls the Cloudflare D1 HTTP API directly for provisioning and migration. For runtime queries (hot path), the Worker uses the D1 HTTP API with the database ID passed per-request.

Updated `wrangler.toml`:
```toml
name = "ultralight-data"
main = "src/index.ts"
compatibility_date = "2024-12-01"

# R2 bucket binding (unchanged)
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "ultralight-apps"

# KV namespace for code cache (unchanged)
[[kv_namespaces]]
binding = "CODE_CACHE"
id = "d348ee797036460faf4b3e014921f0b0"

[vars]
ENVIRONMENT = "production"

# NEW: D1 access via HTTP API (database ID passed per-request)
# CF_ACCOUNT_ID and CF_API_TOKEN set via wrangler secret
```

**Alternative (better performance):** Use Cloudflare's `D1` binding with a **gateway Worker** that dynamically binds to the right D1 via the `env.D1_<name>` pattern. However, Cloudflare currently requires D1 bindings to be declared statically in wrangler.toml. So for dynamic per-app databases, the HTTP API is the only option until Cloudflare ships dynamic D1 bindings.

**Decision:** Use the D1 HTTP API (`/accounts/{id}/d1/database/{db_id}/query`) from the Worker. This adds ~10-20ms latency vs native bindings but supports unlimited databases. We can optimize later if Cloudflare ships dynamic bindings.

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `api/services/d1-provisioning.ts` | **CREATE** | Lazy D1 creation, status tracking, deletion |
| `migration-add-d1-tracking.sql` | **CREATE** | Supabase schema migration |
| `worker/wrangler.toml` | **MODIFY** | Add CF_ACCOUNT_ID, CF_API_TOKEN secrets |
| `worker/src/index.ts` | **MODIFY** | Add D1 query proxy endpoints |

---

## 3. Phase 2 — SDK: `ultralight.db` API Surface

### 3.1 New SDK Interface

Exposed on the `ultralight` global in the Deno sandbox:

```typescript
interface UltralightDB {
  /**
   * Execute a SQL statement that modifies data (INSERT, UPDATE, DELETE).
   * Returns: { success, meta: { changes, last_row_id, duration } }
   *
   * IMPORTANT: The SDK automatically injects user_id into every query.
   * Developers MUST include user_id in their WHERE clauses and INSERTs.
   * The SDK validates this at runtime and throws if user_id is missing.
   */
  run(sql: string, params?: unknown[]): Promise<D1RunResult>;

  /**
   * Execute a SELECT query. Returns all matching rows.
   * The SDK automatically appends `AND user_id = ?` if not present.
   */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Execute a SELECT query. Returns only the first row (or null).
   */
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;

  /**
   * Execute raw SQL (DDL, multi-statement). Used for migrations.
   * NOT available to app code at runtime — only during deploy.
   * Throws if called from app code.
   */
  exec(sql: string): Promise<D1ExecResult>;

  /**
   * Execute multiple statements in a batch (transaction).
   * All succeed or all fail. More efficient than individual calls.
   */
  batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<D1RunResult[]>;
}

interface D1RunResult {
  success: boolean;
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

interface D1ExecResult {
  success: boolean;
  count: number; // number of statements executed
}
```

### 3.2 SDK Implementation in Sandbox

In `api/runtime/sandbox.ts`, add `ultralight.db` to the SDK object:

```typescript
// In the sdk object (around line 1348):

db: {
  run: async (sql: string, params?: unknown[]) => {
    validateUserIdInQuery(sql, 'write');
    const result = await config.d1DataService.run(sql, injectUserId(params, config.userId));
    capturedConsole.log(`[SDK] db.run(${sql.slice(0, 60)}...)`);
    return result;
  },

  all: async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> => {
    const safeSql = ensureUserIdFilter(sql, config.userId);
    const result = await config.d1DataService.all<T>(safeSql, injectUserId(params, config.userId));
    capturedConsole.log(`[SDK] db.all(${sql.slice(0, 60)}...) → ${result.length} rows`);
    return result;
  },

  first: async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> => {
    const safeSql = ensureUserIdFilter(sql, config.userId);
    const result = await config.d1DataService.first<T>(safeSql, injectUserId(params, config.userId));
    capturedConsole.log(`[SDK] db.first(${sql.slice(0, 60)}...)`);
    return result;
  },

  exec: async (_sql: string) => {
    throw new Error('ultralight.db.exec() is not available at runtime. Use migrations/ for schema changes.');
  },

  batch: async (statements: Array<{ sql: string; params?: unknown[] }>) => {
    // Validate every statement has user_id
    for (const stmt of statements) {
      validateUserIdInQuery(stmt.sql, 'batch');
    }
    const result = await config.d1DataService.batch(
      statements.map(s => ({ sql: s.sql, params: injectUserId(s.params, config.userId) }))
    );
    capturedConsole.log(`[SDK] db.batch(${statements.length} statements)`);
    return result;
  },
},
```

### 3.3 RuntimeConfig Extension

```typescript
// In sandbox.ts RuntimeConfig interface:

export interface RuntimeConfig {
  // ... existing fields ...

  // D1 data service (null until app has D1 provisioned)
  d1DataService: D1DataService | null;
}
```

### 3.4 What Happens to `ultralight.store/load/query`?

**They get removed.** Since we haven't launched yet, there's no backward compatibility concern. All sample apps in `apps/mcps/` get rewritten to use `ultralight.db.*`.

The `store`, `load`, `query`, `batchStore`, `batchLoad`, `batchRemove`, `list` methods on the `ultralight` global are **deleted** from the SDK. The `appDataService` (R2-backed) is removed from RuntimeConfig.

R2 continues to be used internally for:
- Code bundles (`apps/{appId}/{version}/_bundle.json`)
- User memory (`users/{userId}/memory.json`)
- Pages (`users/{userId}/pages/{slug}.html`)
- GPU code delivery (`/internal/gpu/code/{appId}/{version}`)

But apps no longer have direct R2 data access.

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `api/services/d1-data.ts` | **CREATE** | D1DataService — query proxy to Worker/CF API |
| `api/runtime/sandbox.ts` | **MODIFY** | Add `ultralight.db.*`, remove `ultralight.store/load/query` |
| `shared/types/index.ts` | **MODIFY** | Add D1 result types, remove KV query types |

---

## 4. Phase 3 — Migration System

### 4.1 Developer-Side Convention

Apps that need structured data include a `migrations/` folder:

```
my-app/
├── index.ts              # App code
├── manifest.json         # Metadata (optional)
├── migrations/
│   ├── 001_initial.sql
│   ├── 002_add_category.sql
│   └── 003_add_indexes.sql
└── ultralight.gpu.yaml   # GPU config (if GPU app)
```

Each migration file:
```sql
-- migrations/001_initial.sql
-- Creates the core tables for the budget tracker app.

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'uncategorized',
  description TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'income')),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date);
CREATE INDEX idx_transactions_user_category ON transactions(user_id, category);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  limit_amount REAL NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, category)
);

CREATE INDEX idx_budgets_user ON budgets(user_id);
```

### 4.2 System Tables (Auto-Created in Every D1)

```sql
-- Created automatically when a D1 is provisioned

CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _usage (
  user_id TEXT NOT NULL,
  rows_read_total INTEGER NOT NULL DEFAULT 0,
  rows_written_total INTEGER NOT NULL DEFAULT 0,
  storage_bytes_estimate INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id)
);
```

### 4.3 Migration Runner

New file: `api/services/d1-migrations.ts`

```typescript
export async function runMigrations(
  databaseId: string,
  migrations: Array<{ version: number; filename: string; sql: string; checksum: string }>
): Promise<MigrationResult> {
  // 1. Query _migrations table to find last applied version
  // 2. Filter to only unapplied migrations (version > last_applied)
  // 3. For each unapplied migration (in order):
  //    a. Execute the SQL
  //    b. INSERT into _migrations (version, filename, checksum, applied_at)
  // 4. Return { applied: number, errors: string[] }
  //
  // IMPORTANT: Each migration runs in its own transaction.
  // If a migration fails, subsequent migrations are skipped.
  // The developer must fix the failing migration and re-deploy.
}

export function parseMigrationFiles(
  files: Record<string, string> // filename → content
): Array<{ version: number; filename: string; sql: string; checksum: string }> {
  // Parse filenames like "001_initial.sql" → version 1
  // Sort by version number
  // Compute SHA-256 checksum of each file's content
  // Return sorted migration list
}
```

### 4.4 Integration with Upload Handler

In `api/handlers/upload.ts`, when an app is uploaded:

1. Parse `migrations/` folder from the upload bundle
2. Store migration files in R2 alongside the code bundle: `apps/{appId}/{version}/migrations/001_initial.sql`
3. If D1 is already provisioned (`d1_status = 'ready'`), run new migrations immediately
4. If D1 is not yet provisioned, migrations will run on first `ultralight.db` call (lazy)

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `api/services/d1-migrations.ts` | **CREATE** | Migration parser + runner |
| `api/handlers/upload.ts` | **MODIFY** | Extract + store migration files, trigger migration runner |

---

## 5. Phase 4 — User Isolation (Application-Level RLS)

### 5.1 The Core Problem

All users of an app share one D1 database. Every table MUST have a `user_id TEXT NOT NULL` column, and every query MUST filter by it. This is enforced at two levels:

**Level 1: SDK Validation (runtime, in sandbox.ts)**
```typescript
function validateUserIdInQuery(sql: string, context: string): void {
  const normalized = sql.toLowerCase().replace(/\s+/g, ' ');

  // For INSERT/REPLACE: must reference user_id column
  if (/^\s*(insert|replace)\s/i.test(normalized)) {
    if (!normalized.includes('user_id')) {
      throw new Error(
        `[Ultralight] All INSERT statements must include user_id. ` +
        `Add user_id to your column list and use the value from ultralight.user.id`
      );
    }
  }

  // For SELECT/UPDATE/DELETE: must have WHERE user_id = ?
  if (/^\s*(select|update|delete)\s/i.test(normalized)) {
    if (!normalized.includes('user_id')) {
      throw new Error(
        `[Ultralight] All queries must filter by user_id. ` +
        `Add WHERE user_id = ? to your query.`
      );
    }
  }
}
```

**Level 2: Migration Validation (deploy-time, in upload handler)**
```typescript
function validateMigrationSchema(sql: string): string[] {
  const errors: string[] = [];

  // Check every CREATE TABLE has user_id column
  const createTableRegex = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\)/gi;
  let match;
  while ((match = createTableRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const columns = match[2];

    // Skip system tables
    if (tableName.startsWith('_')) continue;

    if (!columns.includes('user_id')) {
      errors.push(`Table "${tableName}" must include a "user_id TEXT NOT NULL" column`);
    }
  }

  return errors;
}
```

### 5.2 How `user_id` Flows

```
MCP Request (authenticated)
  → mcp.ts extracts userId from JWT
  → passes to sandbox.ts as config.userId
  → sandbox.ts makes userId available as ultralight.user.id
  → developer uses ultralight.user.id in SQL params
  → SDK validates user_id is present in every query
```

Developer code pattern:
```typescript
// Every query explicitly uses ultralight.user.id
const items = await ultralight.db.all(
  'SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
  [ultralight.user.id, 20]
);

await ultralight.db.run(
  'INSERT INTO items (id, user_id, name, value) VALUES (?, ?, ?, ?)',
  [crypto.randomUUID(), ultralight.user.id, args.name, args.value]
);
```

### 5.3 What About Developer-as-User?

When a developer tests their own app, they're just another user. Their `user_id` is their Ultralight account ID. Their data goes into the same D1 as everyone else's, filtered by their `user_id`. Their usage counts toward their own metering bucket (Phase 5).

### Files Modified

| File | Action | Description |
|------|--------|-------------|
| `api/runtime/sandbox.ts` | **MODIFY** | Add `validateUserIdInQuery`, `ensureUserIdFilter` |
| `api/handlers/upload.ts` | **MODIFY** | Add migration schema validation |

---

## 6. Phase 5 — Metering & Billing

### 6.1 What Gets Metered

| Metric | How Measured | Free Tier | Overage Rate |
|--------|-------------|-----------|-------------|
| Storage (per user per app) | `_usage.storage_bytes_estimate` | 50MB | 0.36 Light/MB/hour |
| Read operations | `_usage.rows_read_total` | 50K/month | 0.01 Light/1K reads |
| Write operations | `_usage.rows_written_total` | 10K/month | 0.05 Light/1K writes |

### 6.2 Per-Request Metering

After every D1 query, the Worker returns `meta.rows_read` and `meta.rows_written`. The API server:

1. Increments `_usage` for the calling `user_id` within the D1 itself (one extra query per request — cheap because it's in the same database)
2. Periodically (every 5 minutes via cron) aggregates `_usage` across all users and reports to Supabase for billing

```sql
-- Run after each query (batched with the user's query for efficiency):
INSERT INTO _usage (user_id, rows_read_total, rows_written_total, last_updated)
VALUES (?, ?, ?, datetime('now'))
ON CONFLICT(user_id) DO UPDATE SET
  rows_read_total = rows_read_total + excluded.rows_read_total,
  rows_written_total = rows_written_total + excluded.rows_written_total,
  last_updated = datetime('now');
```

### 6.3 Rate Limiting & Bot Protection

**Per-user-per-app rate limits (enforced in mcp.ts before D1 call):**

| Tier | Reads/min | Writes/min | Max concurrent |
|------|-----------|------------|---------------|
| Free | 100 | 20 | 3 |
| Pro | 500 | 100 | 10 |
| Scale | 2000 | 500 | 25 |

**Zero balance = 402:**
```typescript
// In mcp.ts, before executing app code:
if (user.balance_light <= 0 && !isWithinFreeTier(user, app)) {
  return jsonRpcError(request.id, -32001, 'Insufficient balance. Top up at ultralight.cloud/settings');
}
```

### 6.4 Supabase Schema Changes for D1 Billing

```sql
-- migration: add_d1_billing_columns.sql

ALTER TABLE users ADD COLUMN d1_rows_read_total BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN d1_rows_written_total BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN d1_billing_last_synced_at TIMESTAMPTZ DEFAULT NOW();

-- RPC: Bulk sync usage from D1 _usage tables to Supabase
CREATE OR REPLACE FUNCTION sync_d1_usage(
  p_user_id UUID,
  p_app_id TEXT,
  p_rows_read BIGINT,
  p_rows_written BIGINT,
  p_storage_bytes BIGINT
) RETURNS VOID AS $$
BEGIN
  UPDATE users SET
    d1_rows_read_total = d1_rows_read_total + p_rows_read,
    d1_rows_written_total = d1_rows_written_total + p_rows_written,
    d1_billing_last_synced_at = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
```

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `api/services/d1-metering.ts` | **CREATE** | Per-user-per-app usage tracking, free tier checks |
| `api/services/d1-billing.ts` | **CREATE** | Cron job: sync _usage to Supabase, charge overage |
| `api/services/data-quota.ts` | **MODIFY** | Update to check D1 usage instead of R2 data bytes |
| `api/handlers/mcp.ts` | **MODIFY** | Add D1 rate limit checks, 402 enforcement |
| `migration-add-d1-billing.sql` | **CREATE** | Supabase schema migration |

---

## 7. Phase 6 — Worker & Data Layer Changes

### 7.1 New Worker Endpoints

Add D1 query proxy endpoints to `worker/src/index.ts`:

```typescript
// New endpoints in the Worker:

// POST /d1/query — Execute a single SQL statement against an app's D1
// Body: { databaseId, sql, params, userId }
// Returns: { results, meta: { changes, last_row_id, duration, rows_read, rows_written } }

// POST /d1/batch — Execute multiple statements in a transaction
// Body: { databaseId, statements: [{ sql, params }], userId }
// Returns: { results: [{ ... }] }
```

The Worker calls the Cloudflare D1 HTTP API:
```typescript
async function queryD1(
  env: Env,
  databaseId: string,
  sql: string,
  params: unknown[]
): Promise<D1QueryResult> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  return response.json();
}
```

### 7.2 R2 Data Endpoints: Deprecation Path

The existing R2 data endpoints (`/data/store`, `/data/load`, etc.) remain functional but are only used internally for:
- Code bundle operations (`/code/fetch`, `/code/invalidate`)
- Memory service
- Pages

The `appdata.ts` service is no longer called from the sandbox. It can be removed once all internal callers migrate.

### 7.3 Caching Strategy

D1 queries don't need the same caching as R2 because:
- D1 already has internal caching at Cloudflare's edge
- Queries return exactly the rows needed (no full-scan + filter)
- Write-read consistency is handled by D1's WAL

The in-memory `AppDataCache` class in `appdata.ts` is **removed**. If we need caching later, we can add a query result cache keyed by (databaseId, sql, params hash, userId) with a short TTL.

### Files Modified

| File | Action | Description |
|------|--------|-------------|
| `worker/src/index.ts` | **MODIFY** | Add `/d1/query` and `/d1/batch` endpoints |
| `worker/wrangler.toml` | **MODIFY** | Add CF_ACCOUNT_ID, CF_API_TOKEN secrets |
| `api/services/appdata.ts` | **DEPRECATE** | No longer used by sandbox; kept for internal R2 ops |

---

## 8. Phase 7 — GPU Runtime D1 Access

### 8.1 Current GPU Architecture

GPU functions run on RunPod. They receive code via the `/internal/gpu/code/{appId}/{version}` endpoint. Currently, GPU apps don't have direct data access — they return results to the API server.

### 8.2 Adding D1 Access to GPU Functions

GPU functions need data access too. Two options:

**Option A: Pass D1 credentials to RunPod container (not recommended)**
- Security risk: D1 API token on external infrastructure
- Latency: RunPod → Cloudflare API → D1

**Option B: Proxy through API server (recommended)**
- GPU function calls `ultralight.db.*` → SDK makes HTTP call back to API server → API server queries D1 via Worker
- Same security model as Deno sandbox
- User isolation enforced at API server level

Implementation in GPU runtime:
```python
# In the GPU container's ultralight SDK (Python):
import requests

class UltralightDB:
    def __init__(self, api_url, auth_token, app_id, user_id):
        self.api_url = api_url
        self.headers = {
            'Authorization': f'Bearer {auth_token}',
            'X-App-Id': app_id,
            'X-User-Id': user_id,
        }

    def all(self, sql, params=None):
        resp = requests.post(f'{self.api_url}/internal/d1/query', json={
            'sql': sql, 'params': params or []
        }, headers=self.headers)
        return resp.json()['results']

    def run(self, sql, params=None):
        resp = requests.post(f'{self.api_url}/internal/d1/query', json={
            'sql': sql, 'params': params or [], 'mode': 'run'
        }, headers=self.headers)
        return resp.json()
```

### 8.3 New Internal Endpoint

```typescript
// In api/handlers/app.ts — new internal route:
// POST /internal/d1/query
// Auth: X-GPU-Secret header (same as existing GPU code proxy)
// Body: { appId, userId, sql, params, mode: 'all' | 'first' | 'run' }
// Returns: { results, meta }
```

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `api/handlers/app.ts` | **MODIFY** | Add `/internal/d1/query` route |
| `api/services/gpu/executor.ts` | **MODIFY** | Pass D1 proxy URL + auth to GPU containers |
| `api/services/gpu/types.ts` | **MODIFY** | Add D1 config to GPU execution context |

---

## 9. Phase 8 — Marketplace Transfer

### 9.1 What Transfers on App Sale

When an app is sold on the marketplace, these must transfer:

| Asset | Transfer Method |
|-------|----------------|
| App record (Supabase) | `UPDATE apps SET owner_id = buyer_id` (existing) |
| Code bundle (R2) | No change needed — R2 paths use `appId`, not `userId` |
| D1 database | No change needed — D1 is bound to `appId`, not `userId` |
| D1 database ID | Transfers with the app record (`apps.d1_database_id`) |
| User data in D1 | Stays in place — data belongs to users, not the developer |
| GPU endpoint | Transfers with app record (existing) |

**This is the beauty of per-app D1:** The database transfers automatically when the app record transfers. No need to export/import data, migrate schemas, or re-provision.

### 9.2 Post-Transfer Cleanup

After a sale, the new owner can:
1. View but not modify existing user data (user_id isolation)
2. Deploy new versions with schema migrations
3. View aggregated usage metrics

### 9.3 Changes to Marketplace Service

Minimal — the existing `acceptBid()` function already transfers the app record. Since `d1_database_id` is a column on `apps`, it transfers automatically.

One addition: log D1 transfer in provenance:
```typescript
// In marketplace.ts acceptBid():
// Add d1_database_id to the provenance record
provenance.push({
  owner_id: buyer.id,
  acquired_at: new Date().toISOString(),
  price_light: bidAmount,
  method: 'marketplace_bid',
  d1_database_id: app.d1_database_id, // NEW: track D1 transfer
});
```

### Files Modified

| File | Action | Description |
|------|--------|-------------|
| `api/services/marketplace.ts` | **MODIFY** | Add D1 ID to provenance record |

---

## 10. Phase 9 — Agent-Readable Spec (`ultralight-spec/`)

### 10.1 Directory Structure

```
ultralight-spec/
├── README.md                    # Overview for humans and agents
├── conventions/
│   ├── d1-schema.md            # Table naming, required columns, data types
│   ├── migrations.md           # Migration file format, naming, execution rules
│   ├── user-isolation.md       # user_id requirements, validation rules
│   ├── api-surface.md          # ultralight.db.run/all/first signatures + examples
│   ├── metering.md             # Free tier thresholds, overage rates, rate limits
│   ├── marketplace.md          # What transfers on sale, data ownership rules
│   ├── app-structure.md        # Required files, folder layout, manifest.json
│   ├── gpu-d1-access.md        # How GPU apps access D1 via proxy
│   └── security.md             # Parameterized queries, injection prevention
├── templates/
│   ├── migration-001.sql       # Starter migration with all required columns
│   ├── crud-patterns.sql       # Copy-paste INSERT/SELECT/UPDATE/DELETE
│   └── index-template.ts       # Starter app code with D1 patterns
└── examples/
    ├── budget-tracker/         # Full example: migrations/ + index.ts
    ├── inventory-app/          # Full example with joins
    └── multi-table-app/        # Example with 3+ related tables
```

### 10.2 Key Convention Files

**`conventions/d1-schema.md`:**
```markdown
# D1 Schema Conventions

## Required Columns (every table)

Every user-facing table MUST include:

| Column | Type | Constraint | Purpose |
|--------|------|-----------|---------|
| `id` | TEXT | PRIMARY KEY | UUID, generated via `crypto.randomUUID()` |
| `user_id` | TEXT | NOT NULL | User isolation — every query filters by this |
| `created_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Audit trail |
| `updated_at` | TEXT | NOT NULL DEFAULT (datetime('now')) | Audit trail |

## Required Indexes

Every table MUST have at minimum:
- `CREATE INDEX idx_{table}_user ON {table}(user_id);`

## Naming Conventions

- Table names: `snake_case`, plural (`transactions`, `budget_items`)
- Column names: `snake_case` (`created_at`, `user_id`)
- Index names: `idx_{table}_{columns}` (`idx_transactions_user_date`)
- Migration files: `{NNN}_{description}.sql` (`001_initial.sql`)

## Data Types (SQLite)

| Use | Type | Notes |
|-----|------|-------|
| IDs | TEXT | UUID strings |
| Strings | TEXT | No VARCHAR in SQLite |
| Numbers | REAL | For decimals/money |
| Integers | INTEGER | For counts/flags |
| Booleans | INTEGER | 0 or 1 |
| Dates | TEXT | ISO 8601 format |
| JSON | TEXT | Stored as JSON string, parsed in app |
```

**`conventions/api-surface.md`:**
```markdown
# ultralight.db API

## Available Methods

### `ultralight.db.run(sql, params?)`
Execute INSERT, UPDATE, DELETE. Returns `{ success, meta }`.

### `ultralight.db.all(sql, params?)`
Execute SELECT, returns all rows as array.

### `ultralight.db.first(sql, params?)`
Execute SELECT, returns first row or null.

### `ultralight.db.batch(statements)`
Execute multiple statements atomically.

## Rules

1. **Always use parameterized queries.** Never string-interpolate values into SQL.
   ```typescript
   // CORRECT
   await ultralight.db.all('SELECT * FROM items WHERE user_id = ? AND category = ?', [ultralight.user.id, category]);

   // WRONG — SQL injection risk, will be rejected
   await ultralight.db.all(`SELECT * FROM items WHERE user_id = '${userId}'`);
   ```

2. **Always include user_id in every query.** The SDK validates this at runtime.

3. **Use ultralight.user.id for the current user's ID.** Never hardcode user IDs.

4. **Use crypto.randomUUID() for primary keys.**

5. **db.exec() is not available at runtime.** Schema changes go in migrations/ only.
```

### 10.3 How Agents Consume the Spec

The `ultralight-spec/` directory lives at the root of the Ultralight repo. When agents build apps:

1. **Ultralight Desktop Agent:** The system prompt includes instructions to read `ultralight-spec/conventions/` before generating any app code. The agent has filesystem access to grep these files.

2. **External Agents (Claude, Cursor, etc.):** When building Ultralight apps, the CLI's `ul scaffold` command generates a starter project that includes a `CONVENTIONS.md` file (symlinked or copied from the spec) that the agent reads.

3. **Platform MCP (`ul.scaffold`):** The scaffold tool in `platform-mcp.ts` generates projects with the spec conventions baked in.

### Files Created

| File | Action | Description |
|------|--------|-------------|
| `ultralight-spec/README.md` | **CREATE** | Overview |
| `ultralight-spec/conventions/*.md` | **CREATE** | 8 convention files |
| `ultralight-spec/templates/*.sql` | **CREATE** | Starter templates |
| `ultralight-spec/templates/index-template.ts` | **CREATE** | Starter app code |
| `ultralight-spec/examples/*/` | **CREATE** | Full working examples |

---

## 11. Phase 10 — Desktop Agent Integration

### 11.1 System Prompt Enhancement

In the Ultralight Desktop agent's system prompt (or CLAUDE.md equivalent):

```markdown
## Ultralight Platform Context

You are an AI agent running inside Ultralight Desktop. When building or modifying Ultralight apps:

1. **Always read `ultralight-spec/conventions/`** before generating app code.
2. All app data uses Cloudflare D1 (SQLite). Use `ultralight.db.run/all/first/batch`.
3. Every table MUST have `user_id TEXT NOT NULL`. Every query MUST filter by `user_id`.
4. Schema changes go in numbered `migrations/` files, never in app code.
5. Use `crypto.randomUUID()` for IDs. Use `ultralight.user.id` for the current user.
6. Always use parameterized queries (`?` placeholders). Never string-interpolate SQL.
7. For GPU apps, D1 access works via `ultralight.db.*` (same API, proxied automatically).

### Quick Reference
- Store data: `await ultralight.db.run('INSERT INTO items (id, user_id, name) VALUES (?, ?, ?)', [crypto.randomUUID(), ultralight.user.id, name])`
- Read data: `const items = await ultralight.db.all('SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC', [ultralight.user.id])`
- Update: `await ultralight.db.run('UPDATE items SET name = ? WHERE id = ? AND user_id = ?', [newName, id, ultralight.user.id])`
- Delete: `await ultralight.db.run('DELETE FROM items WHERE id = ? AND user_id = ?', [id, ultralight.user.id])`
```

### 11.2 Scaffold Tool Update

The `ul.scaffold` platform MCP tool (in `platform-mcp.ts`) generates D1-native starter code:

```typescript
// Updated scaffold output:
// 1. index.ts with ultralight.db.* patterns
// 2. migrations/001_initial.sql with proper schema
// 3. manifest.json with function descriptions
// 4. test_fixture.json with test cases
```

### 11.3 Lint Tool Update

The `ul.lint` platform MCP tool validates:
- Every migration file has `user_id TEXT NOT NULL` on every table
- Every `ultralight.db.*` call uses parameterized queries
- No `ultralight.db.exec()` calls in app code
- Migration files are numbered sequentially with no gaps

### Files Modified

| File | Action | Description |
|------|--------|-------------|
| `api/handlers/platform-mcp.ts` | **MODIFY** | Update `ul.scaffold` output, add D1 lint checks |
| `cli/mod.ts` | **MODIFY** | Update scaffold command to generate D1 patterns |
| `cli/skills.md` | **MODIFY** | Update documentation for D1 API |

---

## 12. File-by-File Change Map

### New Files (13)

| File | Phase | Purpose |
|------|-------|---------|
| `api/services/d1-provisioning.ts` | 1 | Lazy D1 creation per app |
| `api/services/d1-data.ts` | 2 | D1DataService — query execution |
| `api/services/d1-migrations.ts` | 3 | Migration parser + runner |
| `api/services/d1-metering.ts` | 5 | Per-user-per-app usage tracking |
| `api/services/d1-billing.ts` | 5 | Cron: sync usage to Supabase, charge overage |
| `migration-add-d1-tracking.sql` | 1 | Supabase: add d1_database_id to apps |
| `migration-add-d1-billing.sql` | 5 | Supabase: add usage columns to users |
| `ultralight-spec/README.md` | 9 | Spec overview |
| `ultralight-spec/conventions/*.md` (8 files) | 9 | Convention documents |
| `ultralight-spec/templates/*` (3 files) | 9 | Starter templates |

### Modified Files (14)

| File | Phase | Changes |
|------|-------|---------|
| `api/runtime/sandbox.ts` | 2, 4 | Add `ultralight.db.*`, remove KV methods, add user_id validation |
| `shared/types/index.ts` | 2 | Add D1 result types, deprecate KV types |
| `worker/src/index.ts` | 6 | Add `/d1/query` and `/d1/batch` endpoints |
| `worker/wrangler.toml` | 1, 6 | Add CF secrets for D1 API access |
| `api/handlers/mcp.ts` | 5 | D1 rate limit checks, 402 enforcement, D1 service injection |
| `api/handlers/upload.ts` | 3, 4 | Extract migrations, validate schemas |
| `api/handlers/app.ts` | 7 | Add `/internal/d1/query` route for GPU |
| `api/handlers/platform-mcp.ts` | 10 | Update scaffold + lint for D1 |
| `api/services/marketplace.ts` | 8 | Add D1 ID to provenance |
| `api/services/gpu/executor.ts` | 7 | Pass D1 proxy config to GPU containers |
| `api/services/gpu/types.ts` | 7 | Add D1 config type |
| `api/services/data-quota.ts` | 5 | Update for D1 metering |
| `cli/mod.ts` | 10 | Update scaffold command |
| `cli/skills.md` | 10 | Update docs |

### Deprecated Files (2)

| File | Phase | Reason |
|------|-------|--------|
| `api/services/appdata.ts` | 2 | Replaced by D1DataService (keep for internal R2 ops) |
| `api/services/storage-quota.ts` | 5 | Merged into D1 metering (R2 still tracked for code) |

### Rewritten Files (12 — Sample Apps)

All 12 apps in `apps/mcps/` rewritten from KV to SQL:

| App | Current Pattern | New Pattern |
|-----|----------------|-------------|
| `smart-budget/` | `ultralight.store('transactions/' + id, tx)` | `ultralight.db.run('INSERT INTO transactions ...')` |
| `home-inventory/` | `ultralight.store('items/' + id, item)` | `ultralight.db.run('INSERT INTO items ...')` |
| `goal-tracker/` | `ultralight.store('goals/' + id, goal)` | `ultralight.db.run('INSERT INTO goals ...')` |
| `fitness-tracker/` | `ultralight.store('workouts/' + id, w)` | `ultralight.db.run('INSERT INTO workouts ...')` |
| `recipe-box/` | `ultralight.store('recipes/' + id, r)` | `ultralight.db.run('INSERT INTO recipes ...')` |
| `story-builder/` | `ultralight.store('worlds/' + id, w)` | `ultralight.db.run('INSERT INTO worlds ...')` |
| `reading-list/` | `ultralight.store('books/' + id, b)` | `ultralight.db.run('INSERT INTO books ...')` |
| `study-coach/` | `ultralight.store('topics/' + id, t)` | `ultralight.db.run('INSERT INTO topics ...')` |
| `tweets/` | `ultralight.store('tweets/' + id, t)` | `ultralight.db.run('INSERT INTO tweets ...')` |
| `sending/` | `ultralight.store(key, data)` | `ultralight.db.run('INSERT INTO ...')` |
| `embeds/` | `ultralight.store(key, data)` | `ultralight.db.run('INSERT INTO ...')` |
| `digest/` | `ultralight.store(key, data)` | `ultralight.db.run('INSERT INTO ...')` |

Each rewritten app also gets a `migrations/001_initial.sql` file.

---

## 13. Sample App Migration — Before & After

### `smart-budget` — Before (KV/R2)

```typescript
// Add transaction (current)
await ultralight.store('transactions/' + yearMonth + '/' + id, transaction);

// Query transactions (current — full scan!)
const results = await ultralight.query('transactions/' + targetMonth + '/', {
  filter: (item: any) => {
    if (category && item.category !== category) return false;
    return true;
  },
  sort: { field: 'date', order: 'desc' },
  limit: 50,
});
```

### `smart-budget` — After (D1/SQL)

```sql
-- migrations/001_initial.sql
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'uncategorized',
  description TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'income')),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tx_user ON transactions(user_id);
CREATE INDEX idx_tx_user_date ON transactions(user_id, date);
CREATE INDEX idx_tx_user_cat ON transactions(user_id, category);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  limit_amount REAL NOT NULL,
  period TEXT NOT NULL DEFAULT 'monthly',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, category)
);
CREATE INDEX idx_budgets_user ON budgets(user_id);
```

```typescript
// Add transaction (new)
await ultralight.db.run(
  `INSERT INTO transactions (id, user_id, amount, category, description, type, date)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [crypto.randomUUID(), ultralight.user.id, amount, category, description || '', txType, txDate]
);

// Query transactions (new — indexed, fast!)
const transactions = await ultralight.db.all(
  `SELECT * FROM transactions
   WHERE user_id = ? AND date LIKE ? || '%'
   ${category ? 'AND category = ?' : ''}
   ORDER BY date DESC LIMIT ?`,
  [ultralight.user.id, targetMonth, ...(category ? [category] : []), limit || 50]
);

// Monthly summary with aggregation (new — single query instead of full scan!)
const summary = await ultralight.db.all(
  `SELECT category, type,
          COUNT(*) as count,
          SUM(amount) as total
   FROM transactions
   WHERE user_id = ? AND date LIKE ? || '%'
   GROUP BY category, type`,
  [ultralight.user.id, targetMonth]
);
```

**Performance improvement:** The summary query goes from O(n) full scan + in-memory aggregation to O(log n) indexed query with server-side aggregation. For an app with 10K transactions, this is ~100x faster.

---

## 14. Risk Register

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **D1 10GB limit per database** | Medium | Monitor per-app usage. Popular apps get proactive alerts. If needed, shard by user_id range across multiple D1s. |
| **D1 write throughput (~1K/sec)** | Medium | Acceptable for 99% of MCP apps. Monitor. Heavy-write apps could batch via `ultralight.db.batch()`. |
| **Cloudflare D1 HTTP API latency** | Low | ~10-20ms overhead vs native bindings. Acceptable. Monitor for regressions. Migrate to native bindings if CF ships dynamic binding support. |
| **SQL injection via malformed app code** | High | Parameterized queries enforced at SDK level. `ultralight.db.exec()` blocked at runtime. Migration SQL validated at deploy time. |
| **User data leakage between users** | Critical | `user_id` validation at SDK level + deploy-time schema validation. Every table must have `user_id`. Every query must filter by it. |
| **Migration failures on deploy** | Medium | Migrations run sequentially. First failure stops the chain. Developer notified with specific error. Partial migrations leave the DB in a consistent state (each migration is its own transaction). |
| **Lazy provisioning cold start** | Low | First `ultralight.db` call takes 2-5 seconds (create D1 + run migrations). Subsequent calls are fast. Could add "warm up" button in dashboard. |
| **D1 API rate limits from Cloudflare** | Low | Cloudflare's D1 API has generous limits. Batch operations reduce call count. If hit, implement request queuing. |

---

## 15. Appendix: D1 Limits & Constraints

### Cloudflare D1 Limits (as of 2026)

| Limit | Value |
|-------|-------|
| Max database size | 10 GB |
| Max databases per account | 50,000 (Workers Paid) |
| Max rows read per query | 1,000,000 |
| Max rows written per query | 100,000 |
| Max SQL statement length | 100 KB |
| Max bound parameters | 100 |
| Max columns per table | 100 |
| Max batch statements | 100 |
| Write throughput | ~1,000 writes/second |
| Read throughput | ~10,000 reads/second |

### D1 Pricing (Cloudflare)

| Metric | Free | Paid ($5/mo Workers plan) |
|--------|------|--------------------------|
| Rows read | 5M/day | 25B/month included |
| Rows written | 100K/day | 50M/month included |
| Storage | 5 GB total | 5 GB included, $0.75/GB-month |

### SQLite vs PostgreSQL (Key Differences for Developers)

| Feature | SQLite (D1) | PostgreSQL (Supabase) |
|---------|------------|----------------------|
| Types | Dynamic typing | Strict typing |
| JSON | `json_extract()` | Native JSONB |
| Arrays | Not supported | Native ARRAY |
| UPSERT | `ON CONFLICT DO UPDATE` | Same |
| Full-text search | FTS5 | tsvector |
| Auto-increment | `INTEGER PRIMARY KEY` | `SERIAL` |

---

## Implementation Order & Dependencies

```
Phase 1: Foundation (D1 Provisioning)
  ├── No dependencies
  └── Blocks: everything else

Phase 2: SDK (ultralight.db)
  ├── Depends on: Phase 1
  └── Blocks: Phase 3, 4, 5, 7, 10, 13

Phase 3: Migration System
  ├── Depends on: Phase 1, 2
  └── Blocks: Phase 10, 13

Phase 4: User Isolation
  ├── Depends on: Phase 2
  └── Blocks: Phase 9, 10

Phase 5: Metering & Billing
  ├── Depends on: Phase 2
  └── Can run in parallel with Phase 3, 4

Phase 6: Worker Changes
  ├── Depends on: Phase 1
  └── Can run in parallel with Phase 2

Phase 7: GPU D1 Access
  ├── Depends on: Phase 2, 6
  └── Independent of Phase 3, 4, 5

Phase 8: Marketplace Transfer
  ├── Depends on: Phase 1
  └── Minimal changes, can run anytime after Phase 1

Phase 9: Agent Spec
  ├── Depends on: Phase 2, 3, 4 (needs finalized API to document)
  └── Blocks: Phase 10

Phase 10: Desktop Agent Integration
  ├── Depends on: Phase 9
  └── Final phase

Phase 13: Sample App Migration
  ├── Depends on: Phase 2, 3
  └── Good test of the full system
```

### Parallelization Opportunities

```
Sprint 1 (Foundation):     Phase 1 + Phase 6 (in parallel)
Sprint 2 (Core):           Phase 2 + Phase 5 (in parallel)
Sprint 3 (Safety):         Phase 3 + Phase 4 (in parallel)
Sprint 4 (Ecosystem):      Phase 7 + Phase 8 + Phase 9 (in parallel)
Sprint 5 (Polish):         Phase 10 + Phase 13 (in parallel)
```

---

## Conclusion

This plan transforms Ultralight's data layer from a KV-over-object-store to a proper relational database, giving developers SQL's full power (joins, aggregations, indexes, transactions) while maintaining the platform's core properties: per-app isolation, automatic marketplace transfer, per-user billing, and agent-native development.

The architecture is clean because it maps 1:1 — one app, one database, one transfer unit. The agent spec ensures every app built through Ultralight Desktop follows the exact same patterns, eliminating the "works on my machine" problem before it exists.

R2 stays for what it's good at (blobs, code, assets). D1 handles what R2 was struggling with (structured queries, relationships, aggregations). Supabase continues to be the platform's own database. Three storage layers, each doing what it does best.
