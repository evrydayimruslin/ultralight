# Interface Relaunch — Investigation & Design Options

Status: **investigation → decisions locking** (2026-06-12). Nothing here is implemented; this is
the deliberation artifact for reintroducing developer-shipped HTML UIs ("Interface") on Agent
pages, superseding the Widgets feature removed from launch scope in Phase 1 (P2, commits
`b0f5d4d` + `41e7a5a`).

**Locked 2026-06-12:** decision #4 — **multiple interfaces per agent**, declared as a manifest
`interfaces[]` array (see §4.4). Remaining decisions are adopted as working assumptions per the
recommendations in §8 unless revisited. Implementation plan: see
`docs/INTERFACE_RELAUNCH_PR_ROADMAP.md`.

---

## 1. What existed (verified from git history)

The removed launch-web Widgets pipeline (`e8ca2bb`, `64ecb46`, `fdaca18`, deleted in `b0f5d4d`):

- **Manifest**: `widgets[]` of `WidgetDeclaration` (shared/contracts/widget.ts — still at HEAD).
  HTML was NOT static: a developer **`ui_function` executed in the sandbox per render**, returning
  `app_html`. Plus `data_function`, `dependencies[]` (cross-app), `cards[]`, agentic fields
  (`context_function`, `agent_actions`, state snapshots).
- **Render path**: SPA → `POST /api/launch/tools/:id/widgets/:widgetId/render` → full
  `handleRun` pipeline (sandbox spin-up, billing, receipts) → HTML string → SPA injected a bridge
  `<script>` into the HTML → postMessage `ul-widget-load` into an iframe
  `sandbox="allow-scripts"` pointed at same-origin `/__widget-frame/` → `document.write`.
- **Frame CSP** (old `_headers`): `default-src 'none'; script-src 'unsafe-inline';
  style-src 'unsafe-inline' https:; img-src data: blob: https:; frame-ancestors 'self'` —
  network (`connect-src` → fallback `'none'`) was fully blocked; all I/O rode the postMessage
  bridge (`ulAction(fn,args)`, `ulOpenWidget`, `ulWidget.reportState/registerAction`,
  resize protocol clamped 80–600px).
- **Billing**: `widget_pull` — 1 pull = `widget_pulls_per_cloud_unit` cloud units (DB column,
  default 1), receipts resource `widget_pulls`, call-logger `source="widget_pull"`, audit columns
  on `mcp_call_logs` (`widget_action`, `widget_surface_id`, …).
- **Agentic generated interfaces** (`85f082b`, `8a309c6`): LLM planner emitting a typed
  `AgenticInterfaceSpec` rendered by *platform-native* components (not developer HTML) — desktop
  feature, out of scope here, basin dormant (shared/contracts/agentic-interface.ts).

## 2. What survives at HEAD (dormant basin — reusable)

| Asset | Where | State |
|---|---|---|
| `WidgetDeclaration` + context-source/action types | shared/contracts/widget.ts | intact |
| `widgets?`/`context_sources?` on `AppManifest` + `validateManifestWidgets()` | shared/contracts/manifest.ts (~1593–1842) | intact, still runs |
| `widget_pulls_per_cloud_unit` config | api/services/billing-config.ts + migration `20260505120000` | intact |
| `widget_pulls` receipts resource | api/services/call-receipts.ts | intact |
| `source="widget_pull"` + pull metadata | api/services/call-logger.ts | intact |
| Widget action audit columns | migration `20260523170000` | intact |
| Old docs | docs/IN-CHAT-WIDGETS-IMPLEMENTATION.md, docs/AGENTIC_WIDGETS_PR_ROADMAP.md, docs/AGENTIC_INTERFACE_GENERATION_PR_ROADMAP.md | intact |

Deleted (would be rebuilt, not restored): launch facade widget endpoints + `LaunchWidget*`
contracts, `apps/launch-web/src/lib/widget-runtime.ts`, `public/__widget-frame/`,
`scripts/checks/check-widget-contracts.mjs`.

## 3. Why the old design wasn't good enough

1. **Cost & latency**: every render executed developer code through the full runtime
   (sandbox load + ~10–13 structural Supabase RTs pre-PR5, 0.5–2s before user code). The
   expensive thing wasn't serving HTML — it was *generating* it per view.
2. **Process isolation**: opaque-origin iframe on the *same site* as the SPA shares a renderer
   process (Chrome site isolation is per eTLD+1) → Spectre-class reads of launch-web memory,
   which holds the **raw Supabase JWT in localStorage**. Opaque origin protects cookies/storage,
   not process memory.
3. **HTML over postMessage + `document.write`**: no HTTP caching, no per-document response
   headers of its own beyond the frame shell, size limits, escaping pitfalls.
4. **postMessage with `targetOrigin:"*"` both ways**, origin-ambiguous (opaque origin posts as
   `"null"`); no MessageChannel capability handshake.
5. **Speculative billing**: `widget_pull` pricing shipped with zero usage data.
6. **Scope creep**: agentic surfaces/state snapshots/composer arrived before the basic surface
   had users.

## 4. Proposed architecture (superior implementation)

### 4.1 Artifact model — static, deploy-time (the big change)
Developer ships a **single self-contained HTML file** (inline CSS/JS, cap ~1 MiB) in the app
upload; manifest declares it. Stored in R2 (`ultralight-apps` bucket) at a **content-addressed
path** `interfaces/{appId}/{sha256}.html`. Rendering an interface = serving a static file
(~free, instant) instead of executing developer code. Dynamic data comes through bridge →
existing billed function runs. A `render_function` (old model) can be added later as an opt-in
dynamic mode if demanded — do not build in v1.

### 4.2 Serving & isolation — dedicated sandbox Worker (4th deployable)
New tiny Worker, e.g. `ultralight-interfaces.<account>.workers.dev`:
- `GET /i/:appId/:hash` → R2 read (binding) → response with headers:
  - `Content-Security-Policy: sandbox allow-scripts allow-forms; default-src 'none';
    script-src 'unsafe-inline'; style-src 'unsafe-inline' https:; img-src data: blob: https:;
    font-src data: https:; form-action 'none'; frame-ancestors <launch-web origins>`
  - `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=31536000, immutable`
    (content-addressed), no cookies ever.
- Host page embeds `<iframe sandbox="allow-scripts allow-forms" src="https://sandbox…/i/…">`.

Why this is sound (researched, sources in §9):
- `pages.dev` and `workers.dev` are both **on the Public Suffix List** → the sandbox worker is a
  **different site** from `ultralight-launch-web.pages.dev` → separate renderer process, no
  cookie/SameSite adjacency to the SPA (fixes flaw #2). It shares eTLD+1 with the API worker
  (`<account>.workers.dev`), which is acceptable: the API origin keeps no browser-readable
  credentials (`__Host-` refresh cookie is host-only/HttpOnly; browsers hitting `/` get 302'd
  to launch-web). A vanity usercontent domain can replace it later without design change.
- `sandbox` attribute (no `allow-same-origin`) → opaque origin; CSP **`sandbox` directive in the
  header** keeps the document sandboxed even when navigated to directly (closes the
  open-in-new-tab hole). This is the Claude-artifacts / oaiusercontent pattern.
- `connect-src` falls back to `default-src 'none'` → **no network from interface JS at all**;
  the only data path is the bridge. Exfiltration can only target the agent's own allowlisted
  functions — the same trust boundary as using the agent.

### 4.3 Bridge — MessageChannel handshake, narrow v1 API
Parent (launch-web) creates a `MessageChannel`, posts `port2` to the frame after verifying
`event.source === iframe.contentWindow` on the frame's hello (opaque origin ⇒ origin checks are
useless; the port is the unforgeable capability). All subsequent traffic on the port,
schema-validated, size-capped, rate-limited. v1 surface:
- `ul.call(functionName, args)` → parent fetches existing
  `POST /api/launch/agents/:id/functions/:fn/run` (account-session bearer; P5 caller-permission +
  grant gating already applies; sensitive-route rate limits apply).
- `ul.context` (initial context: agent slug, viewer signed-in y/n, theme tokens).
- `ul.resize(height)` (clamped, like before 80–600px → propose 120–900px).
- Nothing else. No agentic state/actions/registerAction in v1.

Anonymous viewers: interface renders (static, free); bridge `ul.call` returns a typed
`SIGN_IN_REQUIRED` error the interface can render around. Function calls only for signed-in
viewers with the normal install/grant relationship.

### 4.4 Manifest — new minimal `interfaces[]` field (leave `widgets[]` dormant) — LOCKED: multiple
```jsonc
"interfaces": [
  {
    "id": "dashboard",                        // unique within the array
    "label": "Dashboard",                     // shown in the tab/picker
    "description": "Live overview",          // optional
    "entry": "interfaces/dashboard.html",     // file in the uploaded bundle
    "functions": ["list_items", "add_item"],  // bridge allowlist (subset of manifest functions)
    "min_height": 320                          // optional
  },
  {
    "id": "settings",
    "label": "Settings",
    "entry": "interfaces/settings.html",
    "functions": ["get_config", "set_config"]
  }
]
```
Each entry gets its own content-addressed R2 object and immutable URL; the agent page shows a
picker (or sub-tabs) when more than one is declared. Validation: unique non-empty `id`s
(slug-safe), `entry` required and path-safe, `functions` non-empty and warn on names absent from
the manifest's own functions.
- New `validateManifestInterface()` next to `validateManifestExternalFunctions()`
  (shared/contracts/manifest.ts:923–1010 is the template).
- **Add to the carry-forward preserve-list** in
  api/services/app-manifest-generation.ts:158–167 (`carryForwardExternalFunctions()` pattern) —
  the Phase-1 review HIGH (upload pipeline stripping `external_functions`) is the known trap.
- Regenerate packages/types; extend OpenAPI spec in `buildLaunchOpenApiSpec()`.

Old `WidgetDeclaration` is deliberately NOT reused: it is desktop-dashboard-shaped
(ui_function-rendered, cards, agentic). One page-level interface per agent in v1.

### 4.5 Facade & web
- `LaunchAgentSummary.interfaces?: Array<{ id, label, description?, url, functions[], minHeight? }>` populated in
  `toLaunchAgentSummary()` (api/handlers/launch.ts:5309–5335); URL points at the sandbox worker
  with the current content hash.
- launch-web: extend `AgentPageTabId` (foundation-pages.tsx:397) with `"interface"`; new
  `AgentInterfaceSurface` hosting iframe + bridge. Add sandbox origin to the SPA CSP `frame-src`
  (apps/launch-web/public/_headers) — NOT to `connect-src`/CORS (parent does API fetches itself;
  the sandbox origin never calls the API directly, so `CORS_ALLOWED_ORIGINS` stays unchanged).
- Upload pipeline: accept `interface/index.html`, enforce single-file + size cap, write
  content-addressed R2 object, stamp hash into stored manifest metadata.

### 4.6 Billing & metering
- **Render: free.** True marginal cost is ~$0.000001/render (see §5); charging viewers per view
  is hostile and the old `widget_pull` price was speculative.
- **Bridge calls: standard existing billing** — function_prices per function, cloud-unit receipts,
  P5 grant caps. No new billing machinery needed for v1.
- **Meter renders anyway** (cheap log or reuse the dormant `widget_pulls` receipt resource at
  0-price) so we have usage data and a pre-existing knob (`widget_pulls_per_cloud_unit`) if
  charging ever becomes warranted.
- Viewer-spend transparency: interfaces can trigger billed calls on click — show per-call or
  cumulative credit cost affordance in the host chrome (the desktop runtime had
  `estimateWidgetPullCost`; port the idea, not the code).

## 5. Cloudflare cost analysis (verified 2026-06-12, official docs)

Pricing facts (paid Workers plan we already have, $5/mo):
- Requests: 10M/mo included, then **$0.30/M** (billed even on cache hits — Workers run before
  cache). CPU: 30M CPU-ms included, then **$0.02/M CPU-ms**. Duration/waiting on fetch: free.
- **Egress: $0** on Workers, R2, KV. R2: $0.015/GB-mo storage, reads $0.36/M, writes $4.50/M.
  KV: reads $0.50/M after 10M, writes $5/M after 1M, 25 MiB value cap. D1: $0.001/M rows read.
- Workers static assets are free-unlimited but deploy-time only → unusable for runtime developer
  uploads; R2-behind-Worker is the right store. Don't use `r2.dev` (rate-limited, dev-only).
- Pages is in maintenance mode ("start with Workers", Apr 2025 blog) — fine for the existing SPA,
  but the new sandbox deployable should be a Worker.
- Workers for Platforms ($25/mo + $0.02/script/mo over 1,000) only matters if interfaces ever
  become developer *code* (their own Workers). Not needed for static HTML.
- Cloudflare for SaaS: first 100 custom hostnames free, $0.10/mo after — only relevant for a
  future bring-your-own-domain story.

Marginal monthly cost model (1 render = 1 sandbox-worker request + 1 R2 read + ~2 CPU-ms;
plus ~3 bridge function calls at ~10 CPU-ms each on the API worker):

| Renders/mo | Requests | Worst-case $ | Realistic $ |
|---|---|---|---|
| 100k | 0.4M | ≤ $0.25 | ~$0 |
| 1M | 4M | ≤ $2.35 | ~$0 |
| 10M | 40M | ~$23 | ~$15 |

Storage: 10k interfaces × 100 KB = 1 GB ≈ **$0.015/mo** in R2. Bandwidth: $0 at every tier.

**The real scaling constraint is not Cloudflare dollars — it's Supabase.** Both workers point at
the prod Supabase NANO/free project; each bridge function call costs structural Supabase RTs.
Render traffic (static) adds zero Supabase load — another argument for the static model — but a
popular interactive interface multiplies function-run traffic. Watch the Supabase plan before
worrying about CF overage.

Old-model comparison: function-rendered HTML costs a full runtime execution per view
(CPU + 10–13 Supabase RTs + possible AI spend) — three to four orders of magnitude more than
static serving, and it's why `widget_pull` billing existed at all.

## 6. Pricing recommendation

1. **v1: render free, bridge calls billed through existing function pricing.** Zero new billing
   code; developers monetize their interface the same way they monetize their agent; platform
   margin rides existing cloud-unit/inference economics.
2. Meter renders at 0-price via the dormant `widget_pulls` receipts so launch data exists.
3. Revisit only if (a) renders exceed ~5M/mo (real CF cost appears) or (b) hosting becomes a
   developer-tier feature ("custom interface" as a paid developer perk — product decision, not a
   cost recovery need).

## 7. Implementation plan (phases, all gated like prior launch phases)

> Superseded by the high-resolution PR plan in `docs/INTERFACE_RELAUNCH_PR_ROADMAP.md`; the
> phase sketch below is kept for context.

- **A. Contracts & manifest** — `interface` field + validation + carry-forward + types regen +
  OpenAPI + `LaunchAgentSummary.interface`. Tests: manifest regeneration survival (follow
  app-manifest-generation.test.ts:71–117), facade response shape.
- **B. Storage & upload** — upload-pipeline acceptance (single file, ≤1 MiB), content-addressed
  R2 write, hash in manifest metadata, deploy-time validation errors.
- **C. Sandbox worker** — new deployable (own wrangler.toml, R2 binding read-only path-scoped if
  possible), CSP/header suite, immutable caching, 404/410 behavior on stale hashes,
  CI deploy job (mirror api-deploy.yml), smoke script (fetch + header assert).
- **D. Web host surface** — Interface tab on `/agents/:slug`, iframe + MessageChannel bridge,
  `SIGN_IN_REQUIRED` flow, resize protocol, spend affordance, `frame-src` CSP update, empty/error
  states; analytics/metering hook.
- **E. Hardening & release** — bridge rate limits + message schema validation, adversarial review
  (XSS/exfil/clickjack/phish checklist from §4.2), docs page for developers
  (ultralight-spec convention doc like skills-as-functions.md), LAUNCH_RELEASE_PACKET entry.

Sequencing note: A+B land invisibly; C+D flip the feature on. Comparable total size to Phase 1.

## 8. Open decisions (deliberate before implementing)

| # | Decision | Recommendation | Status |
|---|---|---|---|
| 1 | Artifact model | Static deploy-time HTML only in v1; `render_function` deferred | working assumption |
| 2 | Sandbox host | New Worker on `<account>.workers.dev` (PSL ⇒ cross-site vs Pages SPA); vanity usercontent domain later | working assumption |
| 3 | Manifest shape | New minimal `interfaces[]` field; `widgets[]` basin stays dormant | working assumption |
| 4 | Multiplicity | **Multiple interfaces per agent, manifest `interfaces[]` array** | **LOCKED 2026-06-12** |
| 5 | Anonymous viewers | Render yes; `ul.call` requires session (typed error otherwise) | working assumption |
| 6 | Charging | Free render + standard function billing; 0-price metering on | working assumption |
| 7 | Bridge v1 surface | `ul.call` / `ul.context` / `ul.resize` only | working assumption |
| 8 | Size cap / format | Single self-contained file per interface, ≤1 MiB | working assumption |
| 9 | Curation gate | Reuse existing listing/visibility; no extra review queue in v1 (revisit at launch review) | working assumption |
| 10 | Naming | "Interface" (tab + manifest field `interfaces`) | working assumption |

## 9. Sources

- Workers pricing/limits: developers.cloudflare.com/workers/platform/pricing/ , …/limits/ ,
  …/static-assets/billing-and-limitations/
- Pages status: blog.cloudflare.com/full-stack-development-on-cloudflare-workers/ (2025-04-08)
- R2 / KV / D1 pricing: developers.cloudflare.com/r2/pricing/ , /kv/platform/pricing/ ,
  /d1/platform/pricing/
- WFP / CF-for-SaaS: …/cloudflare-for-platforms/…/pricing , …/cloudflare-for-saas/plans/
- Sandboxing: MDN iframe + CSP `sandbox` directive; Artur Janc, *COI threat model*; Chrome site
  isolation (per-eTLD+1); val.town `val.run` post-mortem; Figma plugin-security write-ups;
  reverse-engineering of Claude artifacts (claudeusercontent.com); PSL
  (publicsuffix.org/list — `workers.dev`/`pages.dev`/`r2.dev` verified present 2026-06-12)
