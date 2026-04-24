# Launch Hardening Implementation Plan

This document turns the current launch-readiness audit into an implementation
program. The goal is not just to clean code, but to converge the platform onto
one secure, operable, maintainable architecture with clear contracts and an
explicit deprecation path.

## Outcomes

- One canonical auth transport model across browser, desktop, SDK, CLI, MCP,
  and HTTP surfaces
- One shared execution preflight for app lookup, auth context, env resolution,
  D1 resolution, and billing context
- One canonical contract source for public types and JSON-RPC envelopes
- One clear production architecture with archived or isolated non-live paths
- One deprecation queue for compatibility shims, with telemetry and removal
  criteria

## Program Principles

- Security-sensitive plumbing should be shared by default.
- Compatibility code must be measurable, owned, and time-bounded.
- State-changing failures in auth, money, permissions, usage, and publish paths
  must fail closed or surface explicitly.
- Shared contracts should be generated or imported, not rewritten by hand.
- The repo should represent the live platform, not every possible future.

## Wave 0 Companion Docs

- [Launch route inventory](LAUNCH_ROUTE_INVENTORY.md)
- [Launch scorecard](LAUNCH_SCORECARD.md)
- [Compatibility deprecation ledger](COMPATIBILITY_DEPRECATION_LEDGER.md)
- [Engineering failure policy](ENGINEERING_FAILURE_POLICY.md)
- [Development tooling](DEVELOPMENT_TOOLING.md)
- [Auth transport decision](AUTH_TRANSPORT_DECISION.md)
- [Wave 1 security roadmap](WAVE1_SECURITY_ROADMAP.md)
- [Wave 2 core platform roadmap](WAVE2_CORE_PLATFORM_ROADMAP.md)
- [Wave 3 contract and type roadmap](WAVE3_CONTRACT_TYPE_ROADMAP.md)
- [Wave 4 legacy and architecture roadmap](WAVE4_LEGACY_ARCHITECTURE_ROADMAP.md)
- [Wave 5 product credibility roadmap](WAVE5_PRODUCT_CREDIBILITY_ROADMAP.md)
- [Wave 6 operations and launch roadmap](WAVE6_OPERATIONS_LAUNCH_ROADMAP.md)
- [Runtime architecture decision](RUNTIME_ARCHITECTURE_DECISION.md)
- [Platform MCP alias deprecation map](PLATFORM_MCP_ALIAS_DEPRECATION_MAP.md)
- [Widget contracts](WIDGET_CONTRACTS.md)
- [Contract boundary map](CONTRACT_BOUNDARY_MAP.md)

## Wave Summary

### Wave 0: Baseline And Guardrails

Purpose: create inventory, tooling, policy, and acceptance criteria so later
waves can land safely and be measured.

Key outcomes:

- Complete route inventory with auth, rate-limit, validation, and owner fields
- Launch scorecard mapped to the shipping checklist
- Stable Node 20+ local and CI toolchain
- Deprecation ledger for all active compatibility shims
- CI guardrails for forbidden launch-risk patterns

### Wave 1: Stop-Ship Security Hardening

Purpose: close the launch-blocking security gaps in auth transport, CORS, and
session handling.

Key outcomes:

- No auth-by-query-string in product paths
- Explicit production/staging CORS allowlists
- Real server-side logout/session invalidation
- Endpoint-level validation for high-risk auth and billing surfaces
- Sensitive endpoint rate limiting

### Wave 2: Core Platform Convergence

Purpose: unify the security- and billing-adjacent plumbing that is duplicated
today across `run`, `http`, and `mcp`.

Key outcomes:

- Shared execution-context builder
- Shared Supabase REST and Stripe helpers
- Fail-open and silent-failure paths reduced in auth, billing, originality, and
  usage metering
- Runtime SCCs removed from the API handler cluster and GPU barrel

### Wave 3: Contract And Type Unification

Purpose: reduce contract drift by making one shared type system the source of
truth for public and cross-package interfaces.

Key outcomes:

- `shared/types` or a split `shared/contracts/*` tree is canonical
- `packages/types` is generated from the canonical source
- SDK entrypoints are unified
- JSON-RPC, AI/chat, manifest, widget/tool, and runtime storage contracts are
  shared
- High-risk MCP apps are hardened away from `any`

### Wave 4: Legacy Removal And Architecture Simplification

Purpose: turn “just in case” compatibility into a managed deprecation queue and
remove clearly dead paths.

Key outcomes:

- Canonical production architecture documented and reflected in the repo
- Dead artifacts removed
- Non-live future-runtime paths archived or isolated
- Compatibility aliases and legacy config fallbacks reduced behind telemetry
- Root legacy migration files fenced off from current schema work

### Wave 5: Product Credibility And Code Quality

Purpose: make the codebase and product surfaces read like a maintained
platform, not an in-progress prototype.

Key outcomes:

- Placeholder and scaffold-time TODO language removed from user-facing and
  generated paths
- Widget bridge and widget discovery logic consolidated
- Structured logging replaces broad production `console.log` usage
- Loading, empty, and error states become consistent across UI surfaces

### Wave 6: Operations, Testing, And Launch Gates

Purpose: make launch operationally safe, testable, and repeatable.

Key outcomes:

- Staging and production resources separated where needed
- Backup-and-restore drill completed and documented
- Rollback guidance rehearsed for API, DB, and desktop release flows
- CI coverage expanded for auth, dependency cycles, unused code, contracts, and
  deprecations
- Launch stop-ship gates tied to smoke checks and checklist items

## Dependency Order

1. Wave 0 must land first.
2. Wave 1 starts immediately after the Wave 0 scorecard and auth-transport
   decision exist.
3. Wave 2 starts once the Wave 1 auth transport is decided.
4. Wave 3 can overlap late Wave 2, but should target stabilized interfaces.
5. Wave 4 begins only after compatibility telemetry exists.
6. Waves 5 and 6 close the program and enforce launch criteria.

## Detailed PR Roadmap

## Wave 0: Baseline And Guardrails

### Exit Criteria

- Every externally reachable route is inventoried with:
  - auth model
  - rate-limit status
  - server-side validation status
  - owner
  - launch risk tier
- Every known compatibility shim is tracked in a deprecation ledger
- Local and CI toolchains can run:
  - typecheck
  - unused-code analysis
  - dependency-cycle analysis
- The repo has a launch scorecard with pass/fail criteria for the shipping
  checklist

### Recommended Landing Order

Wave 0 should land in this order:

1. PR0.1 inventory and scorecard
2. PR0.3 compatibility ledger
3. PR0.5 failure-policy standard
4. PR0.2 tooling and analysis runtime
5. PR0.4 guardrail CI checks

Why this order:

- PR0.1 gives the program a shared map of the system.
- PR0.3 makes legacy scope visible before we start removing it.
- PR0.5 defines the standard needed for later auth/billing/error changes.
- PR0.2 creates the runtime needed for repo-wide enforcement.
- PR0.4 should come last so CI enforces rules we have already documented and
  agreed on.

### Branching And Review Shape

- Keep each Wave 0 PR small and single-purpose.
- Prefer docs-only PRs first, then tooling, then CI enforcement.
- Each PR should update this plan document only if sequencing or scope changes.
- Do not mix Wave 1 security behavior changes into Wave 0 PRs.

### PR0.1: Add Launch Hardening Inventory

Goal: create a single source of truth for routes, critical flows, and checklist
 coverage.

Scope:

- Add a route inventory document or machine-readable table under `docs/`
- Enumerate API, auth, MCP, HTTP, upload, admin, billing, and desktop-webembed
  surfaces
- Record auth mode, whether the route is public, whether server-side input
  validation exists, whether rate limiting exists, and whether the route is
  sensitive
- Add a launch scorecard document linked to the SINKING SHIP checklist

Suggested files:

- `docs/LAUNCH_ROUTE_INVENTORY.md`
- `docs/LAUNCH_SCORECARD.md`

Acceptance criteria:

- No externally reachable route is missing from the inventory
- Each route has an owner and risk tier
- Checklist items can be tied to evidence in the repo or marked as unresolved

Notes:

- This PR is documentation-heavy by design. It should not change behavior.

Detailed deliverables:

- `docs/LAUNCH_ROUTE_INVENTORY.md`
- `docs/LAUNCH_SCORECARD.md`
- a short link section added to this plan file or the release runbook pointing
  at the new inventory docs

Likely touched files:

- `docs/LAUNCH_ROUTE_INVENTORY.md` (new)
- `docs/LAUNCH_SCORECARD.md` (new)
- `docs/LAUNCH_HARDENING_IMPLEMENTATION_PLAN.md`
- optionally `docs/RELEASE_RUNBOOK.md` if we want the operator docs to link to
  the scorecard

Implementation tasks:

1. Enumerate all externally reachable API and web surfaces from:
   - `api/handlers/app.ts`
   - `api/handlers/*.ts`
   - `api/src/worker-entry.ts`
   - desktop web-embed entry surfaces
2. Group routes by domain:
   - auth
   - discovery
   - MCP/platform MCP
   - HTTP app endpoints
   - upload/build
   - user/settings/billing
   - admin/internal/service-to-service
   - desktop embed/web panel surfaces
3. For each route, record:
   - method and path
   - auth model
   - public/private/internal classification
   - whether request validation exists
   - whether rate limiting exists
   - whether the route changes money, auth, permissions, or publishing state
   - launch risk tier (`P0`/`P1`/`P2`/`P3`)
   - owner
4. Build the launch scorecard by mapping each SINKING SHIP item to one of:
   - passes with evidence
   - unresolved with repo gaps
   - operationally required but unverifiable from code

Review checklist:

- Inventory covers every route visible in `api/handlers/app.ts`
- Risk tiers are specific enough to guide later PR ordering
- Scorecard evidence points at actual files, workflows, or docs

Validation:

- Manual cross-check against `api/handlers/app.ts`
- Manual cross-check against auth, upload, user, admin, and chat handlers
- Reviewer can answer “which routes are unauthenticated and why?” from this PR

Ready-to-implement status:

- Ready immediately
- No blockers
- Best first PR for the program

### PR0.2: Standardize Tooling And Analysis Runtime

Goal: make repo-wide analysis reproducible locally and in CI.

Scope:

- Standardize on Node 20+ in repo tooling
- Fix or document the pnpm/Corepack path so desktop audits can run reliably
- Add scripts or docs for:
  - unused-code scan
  - dependency graph / SCC scan
  - targeted typecheck entrypoints

Suggested files:

- `api/.nvmrc` or equivalent root runtime guidance
- root or package `package.json` scripts if needed
- CI workflow updates to run the checks

Acceptance criteria:

- `knip` or the chosen unused-code tool can run in CI
- dependency-cycle analysis can run in CI or as a documented local script
- desktop dependency/audit path is deterministic on a fresh environment

Notes:

- Do not overfit on one tool. The real goal is repeatable analysis, not tool
  purity.

Detailed deliverables:

- one documented Node runtime policy for analysis tooling
- documented local commands for unused-code and dependency-cycle analysis
- CI steps that can run those commands
- stable desktop package-manager guidance for fresh environments

Likely touched files:

- `api/.nvmrc` if it needs confirmation only
- `api/package.json`
- `desktop/package.json`
- `.github/workflows/api-ci.yml`
- `.github/workflows/desktop-build.yml`
- `scripts/checks/*` or `scripts/analysis/*` (new)
- `docs/DEVELOPMENT_TOOLING.md` or a similar new doc

Implementation tasks:

1. Confirm Node 20 as the standard analysis runtime across `api` and `desktop`.
2. Decide where analysis commands live:
   - package scripts in `api/package.json` / `desktop/package.json`
   - or dedicated scripts under `scripts/analysis/`
3. Add reproducible commands for:
   - unused-code analysis
   - dependency-cycle/SCC analysis
   - focused repo typecheck entrypoints
4. Document desktop package-manager setup clearly enough to avoid the current
   pnpm/Corepack ambiguity.
5. Wire the commands into CI as non-flaky verification steps or gated optional
   checks if they are initially expensive.

Review checklist:

- A new engineer can run the analysis without guessing which Node version to
  use
- Desktop and API analysis commands are consistent with current CI
- The solution does not rely on a nonexistent root workspace package

Validation:

- Run the documented commands locally in a clean shell
- Verify CI references the same commands, not ad hoc inline variants
- Confirm desktop tooling guidance matches `.github/workflows/desktop-build.yml`

Dependencies:

- None for the first pass, but PR0.4 will depend on the commands defined here

Ready-to-implement status:

- Ready after PR0.1, though it can be developed in parallel if needed
- Medium risk because of package-manager/environment variance

### PR0.3: Add Compatibility Shim Ledger

Goal: stop legacy behavior from being invisible.

Scope:

- Add a deprecation ledger with one row per shim
- Include:
  - shim name
  - current purpose
  - where it lives
  - telemetry status
  - owner
  - removal prerequisite
  - target removal wave

Seed entries should include:

- query-token auth
- legacy browser token migration
- `skills_parsed` fallbacks
- old Supabase config fallbacks
- tool alias compatibility in `platform-mcp`
- legacy widget name handling
- legacy token/envvar decrypt/hash paths
- `_future-wfp` retention rationale

Suggested files:

- `docs/COMPATIBILITY_DEPRECATION_LEDGER.md`

Acceptance criteria:

- Every compatibility path cited in the launch audit is represented
- No shim remains ownerless or without a removal prerequisite

Detailed deliverables:

- a deprecation ledger with lifecycle metadata
- a severity field so the most dangerous shims are visually obvious
- explicit telemetry needs for shims that cannot be removed blindly

Likely touched files:

- `docs/COMPATIBILITY_DEPRECATION_LEDGER.md` (new)
- `docs/LAUNCH_HARDENING_IMPLEMENTATION_PLAN.md`
- optionally `LAUNCH_FOLLOWUPS.md` if deferred items should reference the new
  ledger instead of restating context

Implementation tasks:

1. Create one row per active compatibility path.
2. For each row record:
   - name
   - owning subsystem
   - file paths
   - current user-facing purpose
   - risk if removed incorrectly
   - telemetry needed before removal
   - target wave
   - owner
3. Seed the ledger from the audit, including:
   - query-token auth
   - browser token migration
   - `skills_parsed` fallbacks
   - old Supabase config fallback chain
   - `platform-mcp` alias compatibility
   - legacy widget names
   - legacy env-var/token decrypt and hash paths
   - `_future-wfp`
   - root legacy migration family

Review checklist:

- The ledger distinguishes dead artifacts from live compatibility shims
- High-risk auth/session shims are easy to spot
- Every shim has a removal prerequisite, not just a vague note

Validation:

- Cross-check against the legacy-path audit
- Reviewer can answer “what compatibility code is still in the hot path?” from
  this doc alone

Dependencies:

- PR0.1 is helpful but not strictly required

Ready-to-implement status:

- Ready immediately after PR0.1
- Low-risk doc PR with high leverage

### PR0.4: Add Guardrail CI Checks

Goal: prevent new launch regressions while the hardening work is in progress.

Scope:

- Add lightweight checks for forbidden patterns:
  - auth-by-query-string
  - wildcard CORS in production code
  - `.bak` files or backup-source files in live trees
  - placeholder runtime strings in product paths
- Make failures actionable and narrowly scoped

Suggested implementation:

- shell or Node scripts under `scripts/checks/`
- CI workflow step in existing API/desktop validation flows

Acceptance criteria:

- Introducing a new `?token=` auth path or wildcard CORS path fails CI
- The checks are documented and easy to bypass only with explicit code changes

Detailed deliverables:

- one or more lightweight scripts under `scripts/checks/`
- CI steps that invoke those scripts
- a short developer note explaining what each guardrail protects

Likely touched files:

- `scripts/checks/forbid-query-token-auth.*` (new)
- `scripts/checks/forbid-wildcard-cors.*` (new)
- `scripts/checks/forbid-backup-source-files.*` (new)
- `scripts/checks/forbid-placeholder-runtime-strings.*` (new)
- `.github/workflows/api-ci.yml`
- `.github/workflows/desktop-build.yml` if desktop-owned checks belong there
- `docs/DEVELOPMENT_TOOLING.md` or equivalent

Implementation tasks:

1. Choose script format:
   - shell with `rg`
   - or Node for more precise allowlists
2. Add checks for:
   - bearer-token query params in product auth paths
   - wildcard or reflected CORS patterns in production-serving code
   - `.bak` and backup source files in live trees
   - obvious placeholder runtime strings in product paths
3. Support allowlists for intentional, explicitly documented exceptions.
4. Wire the checks into CI as a separate stage so failures are clear and fast.

Review checklist:

- Checks are precise enough not to produce constant false positives
- Exceptions are explicit and reviewed, not accidental
- Guardrails align with the docs from PR0.1, PR0.3, and PR0.5

Validation:

- Run each script locally
- Intentionally introduce a forbidden pattern in a scratch change and verify
  the check fails
- Confirm CI output is understandable without opening the script source

Dependencies:

- PR0.2 should land first so these checks have a stable execution runtime
- PR0.5 should land first so the failure-policy-related checks match written
  standards

Ready-to-implement status:

- Ready after PR0.2 and PR0.5
- Moderate risk because bad guardrails can create CI noise

### PR0.5: Establish Logging And Failure-Policy Standards

Goal: define how critical failures should behave before Wave 1 and Wave 2 start
 changing behavior.

Scope:

- Write a short engineering standard for:
  - fail closed vs fail open
  - state-changing silent catches
  - fire-and-forget telemetry
  - structured logging categories
- Tie it to auth, billing, permissions, publish/originality, and usage paths

Suggested files:

- `docs/ENGINEERING_FAILURE_POLICY.md`

Acceptance criteria:

- Engineers can point to one document when deciding whether a catch block is
  acceptable
- The document is referenced by subsequent hardening PRs

Detailed deliverables:

- a short engineering standard for:
  - fail open vs fail closed
  - stateful vs non-stateful failure handling
  - fire-and-forget side effects
  - telemetry expectations
  - structured log category naming
- explicit examples from this repo so the standard is not abstract

Likely touched files:

- `docs/ENGINEERING_FAILURE_POLICY.md` (new)
- `docs/LAUNCH_HARDENING_IMPLEMENTATION_PLAN.md`
- optionally `docs/RELEASE_RUNBOOK.md` if operator-facing escalation rules need
  a cross-link

Implementation tasks:

1. Define policy categories:
   - auth/session
   - billing/money movement
   - permissions/publishing/originality
   - usage metering and quotas
   - telemetry-only side effects
2. For each category, specify:
   - whether failure should block the request
   - whether retries are acceptable
   - minimum logging/alerting expectations
   - whether fallback is allowed
3. Include examples of acceptable and unacceptable patterns from current code:
   - empty catches on cleanup are acceptable
   - silent state-changing failures are not
4. State how later PRs should document behavior changes when converting fail
   open paths to fail closed.

Review checklist:

- The policy is short enough to be used, not ignored
- It clearly distinguishes cleanup, optional UX fallback, and critical state
  mutation
- It gives later PRs a shared decision rubric

Validation:

- A reviewer can classify the main audit findings against the policy without
  debate about terminology
- Later PRs can cite exact policy sections in their descriptions

Dependencies:

- None, though PR0.3 makes the examples easier to choose

Ready-to-implement status:

- Ready immediately after PR0.3
- Low-risk doc PR with high downstream leverage

### Wave 0 Definition Of Done

Wave 0 is done when all of the following are true:

- The repo has inventory, scorecard, deprecation, and failure-policy docs
- Analysis tooling is reproducible locally and in CI
- Guardrail checks enforce the agreed launch-risk boundaries
- Wave 1 can start without first asking:
  - which routes are sensitive
  - which compatibility paths still exist
  - what counts as an acceptable fallback
  - which runtime/toolchain should be used for analysis

### Immediate Next PR To Implement

Start with `PR0.1: Add Launch Hardening Inventory`.

Why:

- it is unblocked
- it creates the system map every later PR will reference
- it is low-risk and does not interfere with the dirty working tree in product
  code
- it gives us the right frame to scope Wave 1 precisely

## Wave 1: Stop-Ship Security Hardening

### Exit Criteria

- No product path relies on `?token=` for auth
- Browser and desktop surfaces use approved auth handoff mechanisms only
- CORS is allowlist-based in production and staging
- Logout invalidates server-side session state or upstream refresh state
- Sensitive endpoints have explicit rate limiting
- High-risk auth and billing inputs are validated server-side

### Required Design Decision Before PR1.1

Decide the canonical auth transport model for each surface:

- Browser: HttpOnly cookies
- Desktop API calls: Authorization header
- Embedded desktop web panels: header injection or short-lived signed handoff,
  not long-lived query tokens
- MCP/HTTP app calls: Authorization header or short-lived share token with
  explicit scope and TTL

This decision should be written down first to avoid replacing one ad hoc model
with another.

Decision doc:

- [Auth transport decision](AUTH_TRANSPORT_DECISION.md)

Detailed PR roadmap:

- [Wave 1 security roadmap](WAVE1_SECURITY_ROADMAP.md)

Implementation note:

- The companion Wave 1 roadmap is now the source of truth for granular PR
  numbering and sequencing. The coarse PR1.1-PR1.6 sections below are retained
  as the higher-level wave summary.

### PR1.1: Canonical Auth Transport And Token Handoff

Goal: remove auth-by-query-string and replace it with approved transport
 mechanisms.

Scope:

- Remove or deprecate `?token=` support from MCP and HTTP handlers
- Stop web and desktop surfaces from generating tokenized URLs
- Introduce a safe handoff mechanism for the desktop embed/web-panel case
  if direct headers cannot be used
- Instrument any compatibility bridge that remains temporarily

Primary targets:

- `api/handlers/mcp.ts`
- `api/handlers/http.ts`
- `api/handlers/app.ts`
- `web/layout.ts`
- `desktop/src/components/WebPanel.tsx`
- any copy/share MCP endpoint UI in web surfaces

Acceptance criteria:

- No primary auth path uses a long-lived query token
- Shared/copyable URLs no longer contain bearer credentials
- Legacy query-token code, if temporarily retained, is telemetry-gated and
  documented in the deprecation ledger

Rollout notes:

- Land telemetry before hard removal if any existing clients still depend on
  query tokens
- Prefer staged warning logs before breaking compatibility

### PR1.2: Lock Down CORS

Goal: replace permissive or reflected CORS with explicit environment-based
 allowlists.

Scope:

- Define trusted origins for production and staging
- Replace reflected-origin logic and `*` responses in API entrypoints and HTTP
  handler responses
- Keep explicit behavior for routes that are intentionally public, but do not
  allow credentialed wildcards

Primary targets:

- `api/src/worker-entry.ts`
- `api/handlers/http.ts`
- any remaining legacy entrypoints still carrying CORS logic

Acceptance criteria:

- Production/staging origins are explicit configuration, not implicit
- No credentialed CORS response uses `*`
- Preflight behavior is consistent and test-covered

### PR1.3: Real Logout And Session Invalidation

Goal: make logout satisfy the checklist item for server-side invalidation.

Scope:

- Decide whether browser logout revokes refresh sessions upstream or invalidates
  a first-party session record
- Implement logout so it clears client state and invalidates the server-side
  ability to refresh
- Clarify desktop logout semantics and account-switch behavior

Primary targets:

- `api/handlers/auth.ts`
- related auth cookie/session helpers
- desktop auth/logout surfaces
- release/runbook docs if semantics change

Acceptance criteria:

- Logging out prevents silent session recovery with the prior refresh state
- Browser and desktop behavior is documented and tested
- Runbook language matches actual behavior

### PR1.4: Sensitive Endpoint Rate Limiting

Goal: close abuse gaps on auth and security-sensitive routes.

Scope:

- Add or tighten endpoint-level limits for:
  - `/auth/login`
  - `/auth/session`
  - `/auth/refresh`
  - `/auth/provisional`
  - token creation/regeneration routes
  - upload endpoints
  - other sensitive public endpoints discovered in the route inventory
- Ensure limits fail closed where abuse protection is security-critical

Primary targets:

- auth handlers
- user/token handlers
- upload handlers
- shared rate-limit service

Acceptance criteria:

- Sensitive endpoints have explicit limits documented in the route inventory
- Rate-limit behavior is test-covered and returns clear retry metadata
- Fail-open behavior is eliminated on abuse-critical routes

### PR1.5: Server-Side Validation For Auth And Billing Inputs

Goal: stop permissive parsing on high-risk surfaces.

Scope:

- Add schema-based validation or equivalent typed guards for:
  - auth callback/session payloads
  - token management routes
  - billing and checkout inputs
  - upload metadata
  - admin mutation routes
- Ensure error responses are explicit and non-leaky

Primary targets:

- `api/handlers/auth.ts`
- `api/handlers/user.ts`
- `api/handlers/upload.ts`
- `api/handlers/admin.ts`
- any helper functions that parse these bodies repeatedly

Acceptance criteria:

- High-risk request bodies are rejected before business logic runs
- Validation logic is centralized enough to avoid copy/paste drift
- New validators are referenced in the route inventory

### PR1.6: Security Regression Tests And CI Enforcement

Goal: make the Wave 1 changes durable.

Scope:

- Add tests for:
  - no bearer-token-in-URL auth on supported product paths
  - CORS allowlist behavior
  - logout invalidation behavior
  - auth/session validation failures
- Extend CI checks so security regressions are caught automatically

Acceptance criteria:

- A regression to wildcard CORS or `?token=` auth fails CI
- Auth/logout behavior is covered by automated tests where feasible
- Remaining manual verification steps are documented in smoke/runbook docs

## Risks And Sequencing Notes

- PR1.1 and PR1.3 are the two highest-risk changes because they affect
  user-facing auth flows. They should land with feature flags, telemetry, or
  staged removal where possible.
- PR1.2 is safer and can often land early.
- PR1.4 and PR1.5 should be informed by the Wave 0 route inventory so limits
  and validators reflect real route sensitivity.
- Do not begin broad compatibility removal until telemetry confirms real usage
  or non-usage.

## What Comes Next

Once Waves 0 and 1 are complete, the next execution tranche should be:

1. Wave 2 core-platform convergence
2. Wave 3 contract and type unification
3. Wave 4 legacy removal and architecture simplification
4. Wave 5 credibility and code-quality cleanup
5. Wave 6 operations, testing, and launch gates

Those waves should each get their own PR roadmap once the security and
inventory foundations are in place.
