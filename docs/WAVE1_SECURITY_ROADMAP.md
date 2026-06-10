# Wave 1 Security Roadmap

This is the execution roadmap for Wave 1: stop-ship security hardening.

Wave 1 is no longer one broad auth/security cleanup bucket. It now breaks into
eleven PRs that follow the actual seams in the codebase: bearer transport,
desktop embed handoff, CORS policy, logout invalidation, credential throttling,
and runtime validation.

Wave 1 engineering closeout status: `implemented locally, release signoff still
pending staging/production deploy smoke`.

## Exit Criteria

- No product path relies on `?token=` bearer auth
- Desktop embeds no longer receive long-lived credentials in the URL
- Production CORS is allowlist-based and centralized
- Logout invalidates the server-side ability to silently recover a prior
  browser session
- Sensitive auth, token, config, upload, and billing routes are rate-limited
- High-risk auth, OAuth, billing, and config inputs are validated before side
  effects begin

## Current Surface Map

### Legacy bearer transport surfaces

- Desktop embed path:
  - `desktop/src/components/WebPanel.tsx`
  - `web/layout.ts`
- MCP copy/share path:
  - `web/layout.ts`
  - `api/handlers/mcp.ts`
- Generic dashboard/public shell path:
  - `api/handlers/app.ts`
  - `web/layout.ts`
- Shared page links are now a separate fragment-bootstrap flow:
  - `api/handlers/app.ts`
  - `api/handlers/auth.ts`
  - `api/handlers/platform-mcp.ts`
  - `api/services/page-share-session.ts`

### Effective CORS owners and drift

- Production choke point:
  - `api/src/worker-entry.ts`
- Historical Deno entrypoint is now archived for reference only:
  - `archive/legacy-runtime/api-main.ts`
- Handler-local wildcard behavior existed in:
  - `api/handlers/http.ts`
  - `api/handlers/platform-mcp.ts`

### Logout/session invalidation gaps

- `/auth/signout` only cleared cookies:
  - `api/handlers/auth.ts`
- Browser shell already treats cookie-session mode as first-party auth:
  - `web/layout.ts`
- Desktop logout only clears local secure storage:
  - `desktop/src/components/ChatView.tsx`
  - `desktop/src/lib/storage.ts`

### Rate-limit and validation hotspots

- Auth/OAuth:
  - `api/handlers/auth.ts`
  - `api/handlers/oauth.ts`
- Token, BYOK, Supabase, developer, config:
  - `api/handlers/user.ts`
  - `api/handlers/developer.ts`
  - `api/handlers/apps.ts`
  - `api/handlers/config.ts`
- Billing, payouts, uploads, admin:
  - `api/handlers/user.ts`
  - `api/handlers/upload.ts`
  - `api/handlers/admin.ts`

## Recommended Landing Order

1. `PR1.0` Auth transport decision and legacy transport telemetry
2. `PR1.1` Desktop/embed bridge token primitives
3. `PR1.2` Desktop `WebPanel` and embed-shell migration
4. `PR1.3` MCP/HTTP/public page bearer-query removal
5. `PR1.4` Centralized CORS allowlists
6. `PR1.5` Real logout and browser session invalidation
7. `PR1.6` Auth and OAuth route rate limits
8. `PR1.7` Token, BYOK, developer, and config mutation rate limits
9. `PR1.8` Auth, OAuth, and session-bootstrap validation
10. `PR1.9` Billing, Supabase-linking, and upload validation closure
11. `PR1.10` Security regression tests, smoke checks, and CI enforcement

## PR1.0: Auth Transport Decision And Legacy Transport Telemetry

Status: implemented

Goal: lock the target auth model and make compatibility usage visible before
removal work begins.

Scope:

- document the canonical transport decision
- add safe telemetry for:
  - query-token reads
  - tokenized URL generation
  - body-based token bootstrap
- update deprecation-ledger telemetry status

Primary files:

- `docs/AUTH_TRANSPORT_DECISION.md`
- `api/services/auth-transport.ts`
- `api/handlers/auth.ts`
- `api/handlers/app.ts`
- `api/handlers/http.ts`
- `api/handlers/mcp.ts`
- `api/handlers/platform-mcp.ts`

Acceptance criteria:

- every known legacy bearer transport has telemetry or an explicit documented
  gap
- follow-on PRs can point to one transport source of truth

## PR1.1: Desktop And Embed Bridge Token Primitives

Status: implemented

Goal: create the safe replacement for long-lived tokenized iframe URLs.

Scope:

- define a short-lived signed bridge token format
- add an authenticated issue endpoint for desktop clients
- add an exchange endpoint for embedded shell bootstrap
- keep the bridge token TTL-bound, audience-bound, and scope-bound

Key files:

- `api/handlers/auth.ts`
- `api/services/desktop-oauth-sessions.ts` or a new dedicated embed-bridge
  store/helper
- `desktop/src/lib/auth.ts`

Dependencies:

- PR1.0 complete
- auth transport decision accepted

Acceptance criteria:

- desktop can obtain a bridge token without producing a bearer token URL
- bridge tokens do not expose the user’s long-lived access token
- issuing and exchange flows are test-covered

Implemented shape:

- `POST /auth/embed/bridge` issues an opaque short-lived bridge token for
  authenticated desktop callers
- `POST /auth/embed/exchange` exchanges that bridge token into the embedded
  page's first-party cookie session context
- the bridge token TTL is clamped to the remaining JWT lifetime so it cannot
  outlive the desktop access token

## PR1.2: Desktop `WebPanel` And Embed-Shell Migration

Status: implemented in code, desktop smoke pending

Goal: move the live desktop embed surfaces onto the bridge transport.

Scope:

- stop `WebPanel` from generating `?token=` iframe URLs
- add bridge-token bootstrap for embedded shell pages
- make embed-mode shell boot cleanly in cookie-session sentinel mode

Key files:

- `desktop/src/components/WebPanel.tsx`
- `web/layout.ts`
- `api/handlers/app.ts`

Acceptance criteria:

- desktop embed URLs no longer contain long-lived credentials
- dashboard/settings/profile embeds still load
- desktop smoke covers sign-in, embed load, and sign-out

Implemented shape:

- `desktop/src/components/WebPanel.tsx` now requests a short-lived bridge token
  before loading embedded dashboard/settings/profile pages
- `web/layout.ts` exchanges `#bridge_token=` into the first-party cookie
  session sentinel and strips auth artifacts from the URL immediately
- the public app shell in `api/handlers/app.ts` now recognizes the bridge flow
  for desktop embeds instead of expecting long-lived iframe URL tokens

## PR1.3: MCP/HTTP/Public Page Bearer-Query Removal

Status: implemented locally, deploy/smoke pending

Goal: remove bearer-query transport from product-facing non-embed surfaces.

Scope:

- stop generating tokenized MCP endpoint URLs
- remove or gate query-token fallback in:
  - `api/handlers/mcp.ts`
  - `api/handlers/http.ts`
- stop returning URLs that embed user bearer credentials
- keep page-share tokens conceptually separate from bearer auth

Key files:

- `web/layout.ts`
- `api/handlers/mcp.ts`
- `api/handlers/http.ts`
- `api/handlers/app.ts`

Acceptance criteria:

- copied MCP URLs are bare URLs
- `/mcp/:appId` and `/http/:appId/*` are header-auth only unless a scoped
  short-lived replacement ships first
- user bearer tokens are no longer emitted into returned page URLs

Implemented shape:

- `api/handlers/mcp.ts` and `api/handlers/http.ts` now treat bearer auth as
  header-only for product traffic; the legacy query-token telemetry readers
  have been removed from those paths
- `web/layout.ts` app endpoint copy flows now emit bare `/mcp/:appId` URLs and
  tell users to send their API key in the `Authorization` header
- `api/handlers/app.ts` generic dashboard and public shell flows no longer emit
  tokenized custom UI URLs or bootstrap auth from `#token=` / `?token=`; they
  only strip those legacy artifacts if an old URL is opened
- shared markdown page links now use `/share/p/:userId/:slug#share_token=...`
  and exchange that fragment secret into a page-scoped HttpOnly session cookie
  before redirecting to `/p/:userId/:slug`
- the `query-token-auth` launch guardrail is now at `0`, so no product path
  still relies on request-URL token transport

## PR1.4: Centralized CORS Allowlists

Status: implemented locally, deploy/smoke pending

Goal: replace permissive CORS with one explicit allowlist policy.

Scope:

- add a shared CORS helper
- move Worker and legacy entrypoint behavior onto that helper
- remove handler-local wildcard responses
- define production/staging allowlists in runtime config

Primary files:

- `api/services/cors.ts`
- `api/src/worker-entry.ts`
- `archive/legacy-runtime/api-main.ts`
- `api/handlers/http.ts`
- `api/handlers/platform-mcp.ts`
- `api/wrangler.toml`

Acceptance criteria:

- production/staging origins are configuration-driven
- no credentialed path reflects arbitrary origins or uses `*`
- preflights are consistent across entrypoint and HTTP handler paths

## PR1.5: Real Logout And Browser Session Invalidation

Status: implemented locally, smoke/docs follow-through pending

Goal: make logout end the server-side ability to silently recover the browser
session.

Scope:

- define the revocation model for browser logout
- revoke upstream refresh capability or invalidate a first-party session record
- add method and payload discipline to `/auth/signout`
- align desktop logout language with actual token semantics

Key files:

- `api/handlers/auth.ts`
- `api/services/auth-cookies.ts`
- `web/layout.ts`
- `desktop/src/components/ChatView.tsx`

Acceptance criteria:

- `/auth/signout` does more than clear cookies
- runbook and smoke docs describe the real semantics
- browser logout prevents silent refresh of the prior session state

## PR1.6: Auth And OAuth Route Rate Limits

Status: implemented locally, deploy/smoke pending

Goal: close the most obvious credential-abuse gaps first.

Scope:

- add explicit limits for:
  - `/auth/login`
  - `/auth/session`
  - `/auth/refresh`
  - `/auth/merge`
  - `/auth/desktop-poll`
  - `/oauth/register`
  - `/oauth/authorize`
  - `/oauth/token`
  - `/oauth/revoke`
- fail closed where abuse protection is security-critical

Key files:

- `api/services/auth-rate-limit.ts`
- `api/handlers/auth.ts`
- `api/handlers/oauth.ts`

Acceptance criteria:

- auth/OAuth routes carry explicit limits and retry metadata
- abuse-critical paths stop defaulting to fail-open enforcement

Implemented shape:

- `api/services/auth-rate-limit.ts` now defines explicit throttling policies for
  login, session bootstrap, refresh, merge, desktop polling, OAuth register,
  authorize, token, revoke, callback completion, and consent form posts
- `api/handlers/auth.ts` and `api/handlers/oauth.ts` now apply those policies
  through one shared helper, including `X-RateLimit-*` headers and `Retry-After`
- auth-critical throttles now run fail-closed so backend rate-limit failures
  return 503 instead of silently permitting abuse

## PR1.7: Token, BYOK, Developer, And Config Mutation Rate Limits

Status: implemented

Goal: extend throttling to the rest of the credential and config surface.

Scope:

- add explicit limits for:
  - `/api/user/tokens`
  - `/api/user/byok*`
  - `/api/user/supabase*`
  - `/api/developer/apps*`
  - `/api/mcp-config/:appId`
  - `/api/apps/:appId/settings`
  - app env and Supabase-assignment mutations

Key files:

- `api/handlers/user.ts`
- `api/handlers/developer.ts`
- `api/handlers/apps.ts`
- `api/handlers/config.ts`
- a new shared guard helper for sensitive mutations

Acceptance criteria:

- token/config/developer mutations are explicitly limited
- route inventory reflects concrete limits for these mutation bands

Implemented shape:

- `api/services/sensitive-route-rate-limit.ts` now defines explicit fail-closed
  throttling policies for BYOK writes, personal token issuance/revocation,
  saved Supabase config mutations, Supabase OAuth connect flows, developer app
  mutations, MCP config generation, app settings/env/Supabase mutations,
  billing/connect writes, marketplace money-moving writes, upload creation and
  draft writes, and admin mutation routes
- `api/handlers/user.ts`, `api/handlers/upload.ts`, `api/handlers/admin.ts`,
  `api/handlers/apps.ts`, `api/handlers/developer.ts`, and
  `api/handlers/config.ts` now apply those policies through one shared helper
  with `X-RateLimit-*` and `Retry-After` headers
- route keys are scoped to user ID where available and fall back to client IP
  only for public callback/config generation paths and service-secret admin
  flows

## PR1.8: Auth, OAuth, And Session-Bootstrap Validation

Status: implemented

Goal: stop permissive parsing on the auth surface.

Scope:

- add reusable body/query validation for:
  - `/auth/session`
  - `/auth/refresh`
  - `/auth/signout`
  - `/oauth/register`
  - `/oauth/authorize`
  - `/oauth/token`
  - `/oauth/revoke`
- whitelist dynamic OAuth client fields against supported values
- reject malformed or unsupported auth payloads before side effects begin

Key files:

- `api/handlers/auth.ts`
- `api/handlers/oauth.ts`
- new shared typed validation helpers

Acceptance criteria:

- auth/OAuth inputs are validated before exchange, registration, or revocation
- unknown or malformed client/auth inputs fail fast with explicit 4xx responses

Implemented shape:

- `api/services/auth-request-validation.ts` now centralizes strict JSON and
  form/query parsing for session bootstrap, refresh, signout, dynamic client
  registration, OAuth authorize, token exchange, and revocation
- the same shared validator layer now also validates
  `POST /auth/embed/exchange` and `POST /auth/page-share/exchange`, including
  strict owner/slug/share-token payload checks for shared page bootstrap
- `api/handlers/auth.ts` no longer treats invalid JSON as an empty object for
  `/auth/session` and `/auth/refresh`, and signout now rejects malformed or
  unsupported body fields before revocation work begins
- `api/handlers/oauth.ts` now whitelists supported dynamic client grant,
  response, and auth-method values, validates redirect URIs and PKCE inputs,
  and rejects malformed token/revocation payloads before touching auth-code or
  token state

## PR1.9: Billing, Supabase-Linking, And Upload Validation Closure

Status: implemented

Goal: close the most dangerous non-auth validation gaps that still affect
security and launch readiness.

Scope:

- validate billing checkout, payout, and connect payloads
- validate Supabase linking inputs and prove ownership before assignment
- validate upload metadata and app-assignment payloads consistently
- remove permissive `readJsonBody<T>`-style casting on these routes

Key files:

- `api/handlers/user.ts`
- `api/handlers/upload.ts`
- `api/handlers/apps.ts`
- `api/services/ai.ts` for BYOK verification behavior

Acceptance criteria:

- billing and Supabase assignment routes reject invalid input before mutation
- app-level Supabase links cannot assign arbitrary foreign config IDs
- validation helpers are shared instead of copy/pasted

Implemented shape:

- `api/services/request-validation.ts` now holds shared request-body and field
  validation primitives used across Wave 1 validator services
- `api/services/platform-request-validation.ts` now validates:
  - Supabase OAuth project linking payloads
  - app-level saved-Supabase assignment payloads
  - hosting checkout payloads
  - Stripe Connect onboarding payloads
  - withdrawal payloads
  - upload form metadata and programmatic upload options
- `POST /api/user/supabase/oauth/connect` now validates `project_ref` and
  optional `app_id`, then confirms the target app is actually owned by the
  caller before attaching the generated config
- `PUT /api/apps/:appId/supabase` now validates `config_id` and proves the
  saved Supabase config belongs to the app owner before assignment
- `POST /api/user/hosting/checkout`, `POST /api/user/connect/onboard`, and
  `POST /api/user/connect/withdraw` now reject malformed or unsupported JSON
  before any billing or Stripe side effects begin
- `POST /api/upload` and programmatic `handleUploadFiles(...)` now validate
  upload metadata, visibility, slug, `functions_entry`, and optional `gap_id`
  before the upload pipeline runs
- `api/services/admin-request-validation.ts` now validates gap creation/update,
  assessment recording/approval, admin balance top-ups, and app curation
  payloads before those service-secret mutations run
- `api/services/marketplace-request-validation.ts` now validates marketplace
  bid, ask, accept/reject/cancel, buy-now, and metrics-visibility payloads
  before any money-moving or listing mutations begin

## PR1.10: Security Regression Tests, Smoke Checks, And CI Enforcement

Status: implemented

Goal: make Wave 1 durable once the cleanup lands.

Scope:

- add tests for:
  - no bearer-token-in-URL auth on supported surfaces
  - CORS allowlist behavior
  - logout invalidation
  - auth/session validation failures
- update smoke docs and CI checks

Primary files:

- `scripts/checks/run-guardrail-checks.mjs`
- auth/CORS/logout tests in `api/services` or handler-level test files
- `docs/SMOKE_CHECKLISTS.md`
- `docs/RELEASE_RUNBOOK.md`

Acceptance criteria:

- regressions in tokenized URLs or wildcard/reflective CORS fail CI
- logout and auth-validation behavior have automated coverage where feasible
- remaining manual checks are explicit and short

Implemented shape:

- `scripts/checks/run-guardrail-checks.mjs` now scans for tokenized URL
  transport/bootstrap patterns with broader coverage than the initial
  `?token=`-only matcher, alongside wildcard CORS, placeholder runtime strings,
  and backup artifacts
- the committed guardrail baseline in
  `scripts/checks/guardrail-baseline.json` is now aligned to the current
  reviewed Wave 1 debt inventory; after the bearer/bootstrap cleanup the
  `query-token-auth` count is now `0`
- auth regression coverage now includes strict validation for
  `POST /auth/embed/exchange` and `POST /auth/page-share/exchange` in
  `api/services/auth-request-validation.test.ts`, and both handlers use the
  shared validator instead of permissive JSON parsing
- validation coverage now also includes dedicated tests for admin request
  validation, marketplace request validation, and page-share session cookies
- desktop auth helper tests in `desktop/src/lib/auth.test.ts` now assert that
  embed URLs do not place auth in `?token=...`
- `docs/SMOKE_CHECKLISTS.md` and `docs/RELEASE_RUNBOOK.md` now require the
  launch-guardrail check, explicit CORS sanity checks, logout smoke, and URL
  token checks before release signoff

## Sequencing Notes

- `PR1.1`, `PR1.2`, and `PR1.3` are the highest-risk user-facing auth changes.
  They should land with telemetry-backed removal and narrow smoke coverage.
- `PR1.4` is safe to land early because it centralizes policy without changing
  the auth model.
- `PR1.6` and `PR1.7` should share one small guard helper rather than
  re-implementing throttles file by file.
- `PR1.8` should land before `PR1.9` so the validation pattern is established
  on the auth surface first.
