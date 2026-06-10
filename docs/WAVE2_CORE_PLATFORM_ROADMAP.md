# Wave 2 Core Platform Roadmap

Wave 2 is the convergence wave. The purpose is to take the security-sensitive
plumbing that still exists in multiple near-duplicate forms across `run`,
`http`, `mcp`, and the API router, and collapse it into shared, testable
building blocks with explicit failure policy.

This roadmap is intentionally granular. Each PR is small enough to review on
its own, but together they move the platform toward one execution preflight,
one caller-context story, one runtime setup path, and one predictable
settlement/error model.

## Current State

As of April 20, 2026, the main Wave 2 hotspots are:

- `run`, `http`, and `mcp` still diverge in caller-context extraction, BYOK
  loading, and post-execution settlement.
- publish/originality, weekly calls, rate limiting, and some billing-related
  paths still include fail-open behavior that is too permissive for a
  launch-ready platform.
- `handlers/app.ts` still owns too many unrelated responsibilities even after
  the first cycle break.
- Supabase REST access and Stripe/billing side effects are still too scattered.

## Implemented In This Batch

These PR slices are already implemented locally and verified:

### PR2.1 Response Helper Extraction

Status: `implemented locally`

Purpose:
- remove the direct `handlers/* -> handlers/app.ts` import edge for basic JSON
  response helpers
- break the dominant API handler/router SCC without changing route behavior

Landed changes:
- added [response.ts](../api/handlers/response.ts)
- moved `json`, `error`, and `toResponseBody` to the new leaf helper
- rewired handler imports away from `app.ts`

Acceptance:
- no handler imports `./app.ts` for simple response utilities
- API dependency-cycle baseline no longer contains the `handlers/app.ts` knot

Verification:
- `cd api && npm run typecheck`
- `cd api && npm run analyze:deps`

### PR2.2 Runtime Supabase Access Layer

Status: `implemented locally`

Purpose:
- stop runtime code from reaching into `handlers/user.ts` to resolve Supabase
  configs
- make saved-config lookup and decryption callable from services, tests, and
  runtime builders without handler coupling

Landed changes:
- added [user-supabase-configs.ts](../api/services/user-supabase-configs.ts)
- moved `getSupabaseEnv`, `listSupabaseConfigs`,
  `getDecryptedSupabaseConfig`, and `getDecryptedPlatformSupabase` into a
  service layer
- kept handler-level compatibility exports so existing dynamic imports do not
  break while callers migrate
- added focused tests in
  [user-supabase-configs.test.ts](../api/services/user-supabase-configs.test.ts)

Acceptance:
- runtime paths can resolve Supabase config without importing `handlers/user.ts`
- config lookup and decrypt behavior are covered by isolated tests

Verification:
- `cd api && npm test`
- targeted config tests are part of the default `api` test script

### PR2.3 Shared App Runtime Resource Builders

Status: `implemented locally`

Purpose:
- deduplicate app entry-code lookup, env var decryption, Supabase runtime
  config resolution, D1 provisioning, and manifest permission parsing
- give later Wave 2 PRs one stable runtime setup seam to build on

Landed changes:
- added [app-runtime-resources.ts](../api/services/app-runtime-resources.ts)
- added focused tests in
  [app-runtime-resources.test.ts](../api/services/app-runtime-resources.test.ts)
- migrated these handlers to the shared helpers:
  - [run.ts](../api/handlers/run.ts)
  - [http.ts](../api/handlers/http.ts)
  - [mcp.ts](../api/handlers/mcp.ts)
  - [app.ts](../api/handlers/app.ts)

Acceptance:
- the supported entry-file probe order lives in one place
- env/Supabase/D1/manifest setup no longer forks independently in `run` and
  `http`
- `mcp` reuses the shared env, Supabase, D1, and permission helpers while
  preserving its richer cache and per-user-secret flow

Verification:
- `cd api && npm run typecheck`
- `cd api && npm test`

### PR2.9 GPU Provider Leaf Extraction

Status: `implemented locally`

Purpose:
- remove the GPU barrel-cycle pattern where leaf modules imported
  `services/gpu/index.ts` even though that barrel re-exported them

Landed changes:
- added
  [provider-singleton.ts](../api/services/gpu/provider-singleton.ts)
- rewired:
  - [builder.ts](../api/services/gpu/builder.ts)
  - [executor.ts](../api/services/gpu/executor.ts)
  - [benchmark.ts](../api/services/gpu/benchmark.ts)
- reduced [index.ts](../api/services/gpu/index.ts)
  to re-exports instead of owning the singleton implementation

Acceptance:
- no GPU leaf imports `./index.ts`
- GPU service graph is acyclic

Verification:
- `cd api && npm run analyze:deps`

## Wave 2 PR Slices

The full Wave 2 slice list is below. As of April 20, 2026, the code work for
every listed PR is implemented locally and verified in the `api` package.

### PR2.4 Caller Context Normalization

Status: `implemented locally`

Purpose:
- unify API-token and JWT parsing across `run`, `http`, and `mcp`
- centralize user lookup, tier hydration, display metadata, and BYOK loading
- make anonymous fallback explicit instead of being silently different per path

Expected files:
- `api/services/request-caller-context.ts` or equivalent
- `api/handlers/run.ts`
- `api/handlers/http.ts`
- `api/handlers/mcp.ts`

Acceptance:
- one helper owns bearer parsing for JWT and personal API tokens
- one helper returns the normalized caller shape used by all three runtimes
- BYOK loading behavior is uniform and test-covered

Verification:
- `cd api && npm run typecheck`
- `cd api && npm test`

Landed changes:
- added [request-auth.ts](../api/services/request-auth.ts)
  and
  [request-caller-context.ts](../api/services/request-caller-context.ts)
- rewired [auth.ts](../api/handlers/auth.ts),
  [run.ts](../api/handlers/run.ts),
  [http.ts](../api/handlers/http.ts),
  and [mcp.ts](../api/handlers/mcp.ts)
  onto the shared auth/caller model
- removed bespoke JWT metadata decoding and duplicate BYOK/user-profile fetches
  from the hot `mcp` and `http` paths
- tightened the shared AI contract by adding optional `error` to
  [shared/types/index.ts](../shared/types/index.ts)
  and
  [packages/types/index.d.ts](../packages/types/index.d.ts)

### PR2.5 Post-Execution Settlement Convergence

Status: `implemented locally`

Purpose:
- remove duplicated post-execution billing/logging/usage settlement logic
- give GPU and sandbox execution one explicit completion pipeline

Scope:
- weekly-call charging decision point
- GPU settlement
- MCP/HTTP call logging
- shared output/error/result envelope shaping where feasible

Expected files:
- `api/services/execution-settlement.ts`
- `api/handlers/http.ts`
- `api/handlers/mcp.ts`
- `api/handlers/run.ts`

Acceptance:
- success/failure logging and billing happen through shared typed helpers
- ownership of “who gets charged/logged” is explicit and consistent
- fire-and-forget side effects are limited and intentional

Verification:
- `cd api && npm run typecheck`
- `cd api && npm test`

Landed changes:
- added
  [execution-settlement.ts](../api/services/execution-settlement.ts)
  and focused tests in
  [execution-settlement.test.ts](../api/services/execution-settlement.test.ts)
- moved sandbox caller-charge settlement, response telemetry, and call logging
  out of [mcp.ts](../api/handlers/mcp.ts)
- rewired GPU settlement/logging in
  [mcp.ts](../api/handlers/mcp.ts),
  [http.ts](../api/handlers/http.ts),
  and [run.ts](../api/handlers/run.ts)
  onto the shared helper
- added run-surface execution logging and fixed the previous anonymous GPU
  settlement bug in `run.ts`

### PR2.6 Publish And Originality Fail-Closed Hardening

Status: `implemented locally`

Purpose:
- remove fail-open behavior from the private-to-public publish gate unless the
  failure is explicitly classified as safe to bypass

Primary hotspot:
- [platform-mcp.ts](../api/handlers/platform-mcp.ts)
  originality gate around publish visibility changes

Expected outcome:
- originality and integrity failures return typed results
- unexpected service failures stop publish instead of logging and continuing
- asynchronous integrity-result persistence remains best-effort only after the
  gate itself succeeds

Verification:
- `cd api && npm run typecheck`
- `cd api && npm test`

Landed changes:
- hardened
  [originality.ts](../api/services/originality.ts)
  with explicit `best_effort` vs `fail_closed` mode and typed
  `service_unavailable` outcomes
- added focused coverage in
  [originality.test.ts](../api/services/originality.test.ts)
- rewired publish gates in
  [upload.ts](../api/handlers/upload.ts),
  [apps.ts](../api/handlers/apps.ts),
  and
  [platform-mcp.ts](../api/handlers/platform-mcp.ts)
  to use strict originality mode
- removed the explicit fail-open catch from the visibility-change publish path

### PR2.7 Enforcement Fail-Open Cleanup

Status: `implemented locally`

Purpose:
- align weekly calls, rate limiting, storage quota, D1 metering, and billing
  checks with the failure policy from Wave 0

Primary hotspots:
- [weekly-calls.ts](../api/services/weekly-calls.ts)
- [ratelimit.ts](../api/services/ratelimit.ts)
- `api/services/d1-metering.ts`
- `api/services/hosting-billing.ts`

Acceptance:
- critical money/abuse-control paths either fail closed or surface a typed
  degraded-mode response
- permissive fallbacks are reserved for explicitly low-risk endpoints
- enforcement mode is caller-selectable only where product policy demands it

Verification:
- `cd api && npm run typecheck`
- `cd api && npm test`

Landed changes:
- switched high-cost weekly-call gates in
  [http.ts](../api/handlers/http.ts)
  and
  [platform-mcp.ts](../api/handlers/platform-mcp.ts)
  to fail closed with explicit service-unavailable responses
- added strict-option variants plus focused coverage for
  [d1-metering.ts](../api/services/d1-metering.ts)
  in
  [d1-metering.test.ts](../api/services/d1-metering.test.ts)
- made
  [hosting-billing.ts](../api/services/hosting-billing.ts)
  surface degraded-mode results instead of silently succeeding when key billing
  reads or clock updates fail
- taught
  [worker-entry.ts](../api/src/worker-entry.ts)
  to log degraded hosting-billing cron outcomes explicitly

### PR2.8 Router And Internal Proxy Extraction

Status: `implemented locally`

Purpose:
- keep shrinking `handlers/app.ts` until it is mostly routing, not a mixed
  router/proxy/html/runtime utility module

Targets:
- GPU code proxy helper
- internal D1 query proxy helper
- public app runner helpers where they still mix execution, cache, and HTML
  page assembly

Acceptance:
- `app.ts` depends on leaf helpers; leaf helpers do not depend on `app.ts`
- route matching stays readable and reviewable

Verification:
- `cd api && npm run typecheck`
- `cd api && npm run analyze:deps`

Landed changes:
- added
  [internal-proxy.ts](../api/handlers/internal-proxy.ts)
  for the GPU bundle proxy and internal D1 proxy handlers
- removed those helpers from
  [app.ts](../api/handlers/app.ts)
  and rewired the router to import them as leaves

### PR2.10 Shared Platform Client Helpers And Failure Taxonomy

Status: `implemented locally`

Purpose:
- stop open-coding Supabase REST and Stripe side-effect handling everywhere
- standardize typed failure classes for auth, permissions, billing, integrity,
  and quota outcomes

Expected files:
- `api/services/platform-clients/supabase-rest.ts`
- `api/services/platform-clients/stripe.ts`
- typed failure/result modules used by handlers and settlement helpers

Acceptance:
- repeated REST boilerplate is removed from hot paths
- typed service/failure outcomes are available to convergence helpers without
  inventing route-local error classes

Verification:
- `cd api && npm run typecheck`
- `cd api && npm test`

Landed changes:
- added
  [supabase-rest.ts](../api/services/platform-clients/supabase-rest.ts)
  as a shared admin Supabase REST client wrapper
- added
  [platform-failures.ts](../api/services/platform-failures.ts)
  for shared `service_unavailable` and integrity failure typing
- adopted the shared client/failure helpers in
  [execution-settlement.ts](../api/services/execution-settlement.ts)
  and
  [originality.ts](../api/services/originality.ts)

## Verification Summary

Wave 2 local verification currently passes:

- `cd api && npm run typecheck`
- `cd api && npm test`
- `source ~/.nvm/nvm.sh && nvm use >/dev/null && cd api && npm run analyze:deps`
- stateful failures can be classified and observed consistently

## Wave 2 Exit Criteria

Wave 2 is complete when all of the following are true:

- `run`, `http`, and `mcp` share a caller-context and runtime-resource setup
  story
- the API dependency-cycle baseline remains empty
- GPU leaf modules no longer import the GPU barrel
- publish/integrity and billing/usage enforcement do not fail open on
  unexpected backend errors
- the default `api` typecheck, tests, and dependency analysis all pass

## Manual Tasks Deferred To The End

Keep all human-in-the-loop work at the back of the queue until the remaining
code PRs above are landed.

Final manual tasks for Wave 2:

1. Push the Wave 2 branch and let CI run `api` typecheck, tests, and dependency
   analysis in the remote environment.
2. Deploy to staging.
3. Run the Wave 2-focused staging smoke pass:
   - one `run` execution for a non-GPU app
   - one `http` execution for a published HTTP app
   - one `mcp` tool invocation for a BYOK-enabled account
   - one GPU execution to confirm provider wiring and settlement still work
   - one publish attempt that should fail if originality/integrity services are
     unavailable after PR2.6 lands
4. Only after staging passes, fold the remaining Wave 2 doc status from
   `implemented locally` to `verified in staging`.

Until those final steps are done, Wave 2 should be treated as locally complete
but not fully signed off.
