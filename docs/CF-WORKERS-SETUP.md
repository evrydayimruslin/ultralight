# Cloudflare Workers Data Layer Setup Guide

This guide covers the Ultralight Worker deployment — a native R2 data layer that accelerates app storage operations by ~10x vs HTTP-signed S3 calls.

## Architecture (Option C)

```
User/Agent → DO API Server (control plane + execution)
                 ↓                    ↓
            Auth, rate limits,    CF Worker (data layer)
            permissions, sandbox  Native R2, KV cache
```

- **DO API Server**: Handles auth, rate limiting, permissions, routing, and code execution (local sandbox)
- **CF Worker**: Handles R2 storage operations with native bindings (~5-15ms vs ~50-200ms per op)
- **Feature flag**: Set `WORKER_DATA_URL` + `WORKER_SECRET` env vars to enable; remove to fall back to direct R2

### Why not full sandbox execution?

Cloudflare Workers blocks `new Function()` / `eval()` in production for security.
The `UnsafeEval` binding only works in local dev. Full sandbox execution requires
**Workers for Platforms** ($25/month) — planned for a future upgrade.

---

## Prerequisites

- Node.js v20+ (wrangler requires it)
- Cloudflare account with **Workers Paid plan** ($5/month)
- Existing R2 bucket (e.g., `ultralight-apps`)

---

## Step 1: Install Wrangler CLI & Login

```bash
nvm use 20   # if using nvm
npm install -g wrangler
wrangler login
```

Opens a browser to authenticate with Cloudflare (Apple SSO, GitHub, etc. all work).

---

## Step 2: Generate a Shared Secret

```bash
openssl rand -hex 32
```

Save this value — needed for both Worker secret and DO env var.

---

## Step 3: Create the KV Namespace

```bash
cd worker
wrangler kv namespace create CODE_CACHE
```

Copy the output `id` and update `worker/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CODE_CACHE"
id = "your-kv-id-here"
```

---

## Step 4: Verify R2 Bucket Name

In `worker/wrangler.toml`, confirm the R2 bucket name matches your existing bucket:

```toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "ultralight-apps"
```

Find your bucket name at: Cloudflare Dashboard → R2 → Overview

---

## Step 5: Install Dependencies & Deploy

```bash
cd worker
npm install
wrangler secret put WORKER_SECRET
# Paste the secret from Step 2

wrangler deploy
```

Wrangler prints the Worker URL:
```
https://ultralight-data.your-account.workers.dev
```

---

## Step 6: Verify the Worker

```bash
# Health check (no auth)
curl https://ultralight-data.your-account.workers.dev

# → {"status":"ok","service":"ultralight-data-worker"}

# Auth check (should reject)
curl -X POST https://ultralight-data.your-account.workers.dev/data/list \
  -H "Content-Type: application/json" \
  -d '{"appId":"test"}'

# → {"error":"Unauthorized"}

# Authenticated store/load test
SECRET="your-secret-here"
URL="https://ultralight-data.your-account.workers.dev"

curl -X POST "$URL/data/store" \
  -H "Content-Type: application/json" \
  -H "X-Worker-Secret: $SECRET" \
  -d '{"appId":"test","key":"hello","value":"world"}'
# → {"ok":true}

curl -X POST "$URL/data/load" \
  -H "Content-Type: application/json" \
  -H "X-Worker-Secret: $SECRET" \
  -d '{"appId":"test","key":"hello"}'
# → {"value":"world"}
```

---

## Step 7: Configure DO API Server

Add these environment variables to DigitalOcean App Platform:

| Variable | Value | Description |
|----------|-------|-------------|
| `WORKER_DATA_URL` | `https://ultralight-data.your-account.workers.dev` | Worker URL from Step 5 |
| `WORKER_SECRET` | (same secret from Step 2) | Shared secret for auth |

Set at: DigitalOcean → Apps → ultralight → Settings → App-Level Environment Variables

When both vars are set, all `ultralight.store()`, `.load()`, `.list()`, `.remove()`, `.query()`, and batch operations route through the Worker's native R2 bindings.

---

## Step 8: Test End-to-End

1. Deploy DO with env vars from Step 7
2. Call any MCP tool that uses storage
3. Check Worker logs: `cd worker && wrangler tail`
4. Look for R2 operations being served by the Worker

---

## Worker Endpoints

All data endpoints require `X-Worker-Secret` header and `POST` method:

| Endpoint | Body | Response |
|----------|------|----------|
| `POST /data/store` | `{appId, userId?, key, value}` | `{ok: true}` |
| `POST /data/load` | `{appId, userId?, key}` | `{value: ...}` |
| `POST /data/remove` | `{appId, userId?, key}` | `{ok: true}` |
| `POST /data/list` | `{appId, userId?, prefix?}` | `{keys: [...]}` |
| `POST /data/batch-store` | `{appId, userId?, items: [{key, value}]}` | `{ok: true}` |
| `POST /data/batch-load` | `{appId, userId?, keys: [...]}` | `{items: [{key, value}]}` |
| `POST /data/batch-remove` | `{appId, userId?, keys: [...]}` | `{ok: true}` |
| `POST /code/fetch` | `{appId, storageKey}` | `{code, source}` |
| `POST /code/invalidate` | `{appId}` | `{ok: true}` |
| `GET /health` | — | `{status: "ok"}` |

---

## Rollback

To disable the Worker data layer instantly:
- Remove `WORKER_DATA_URL` from DO env vars (or set it to empty)
- The DO server falls back to direct R2 HTTP access (original behavior)

No code changes or redeployment needed.

---

## Cost

- **Workers Paid plan**: $5/month (includes 10M requests/month)
- **KV**: First 100K reads/day free, then $0.50/M reads
- **R2**: Already paying — native bindings don't add cost, they eliminate HTTP signing overhead

---

## Future: Workers for Platforms

When ready to move code execution to Workers ($25/month upgrade):
- Files in `worker/src/_future-wfp/` contain the full sandbox engine
- Provides true V8 isolate sandboxing (128MB memory, 30s CPU)
- `UnsafeEval` binding enables `new Function()` in user worker isolates
- Auto-scaling across Cloudflare's global edge network
