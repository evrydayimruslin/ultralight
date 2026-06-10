# Wave 3 Contract And Type Roadmap

Wave 3 is the contract-convergence wave. Wave 2 gave the platform a more
shared runtime path; Wave 3 needs to give it one shared language for the data
that crosses package, runtime, and product boundaries.

This roadmap is intentionally high-resolution. The goal is not a vague
"improve typing" sweep. The goal is to remove contract drift in reviewable
slices: one canonical source, one generated downstream type package, one SDK
implementation surface, one shared JSON-RPC/MCP envelope model, and a staged
hardening plan for the highest-risk `any` and `unknown` hotspots.

## Current State

As of April 21, 2026, the main Wave 3 hotspots are:

- [shared/types/index.ts](../shared/types/index.ts)
  is the de facto source of truth, but it is a monolith that mixes public SDK
  contracts, runtime-only types, AI payloads, widget payloads, app rows, and
  MCP envelopes.
- [packages/types/index.d.ts](../packages/types/index.d.ts)
  was hand-maintained. Wave 3 now adds
  [scripts/contracts/generate-types-package.mjs](../scripts/contracts/generate-types-package.mjs),
  [packages/types/index.template.d.ts](../packages/types/index.template.d.ts),
  and generation scripts in
  [packages/types/package.json](../packages/types/package.json),
  but the new generated artifact flow still needs downstream adoption and the
  remaining app-hardening tranches.
- [sdk/src/index.ts](../sdk/src/index.ts)
  and [sdk/mod.ts](../sdk/mod.ts) are
  no longer need parallel maintenance. `sdk/src/index.ts` is now canonical and
  `sdk/mod.ts` is a wrapper, but the SDK public DTOs are still local to the
  SDK package rather than fully migrated into the wider shared-contract tree.
- JSON-RPC and MCP transport contracts are duplicated in
  [api/handlers/mcp.ts](../api/handlers/mcp.ts),
  and [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
  today. Wave 3 removes those handler-local declarations and adds CI
  guardrails so the clones do not come back.
- The highest-risk weak-type hotspots are concentrated in
  [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
  and a small set of MCP apps:
  - `platform-mcp.ts`: `any=15`, `unknown=132`
  - `apps/mcps/study-coach/index.ts`: `any=0`, `unknown=23`
  - `apps/mcps/email-ops/index.ts`: `any=4`, `unknown=27`
  - `apps/mcps/story-builder/index.ts`: `any=3`, `unknown=6`
  - `apps/mcps/resort-manager/index.ts`: `any=1`, `unknown=50`
  - `apps/mcps/digest/index.ts`: `any=0`, `unknown=3`
  - `apps/mcps/memory-wiki/index.ts`: `any=0`, `unknown=10`
- Generated/runtime-facing MCP code still teaches weak typing in the wrong
  places. The current platform scaffold path in
  [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
  used to emit `Promise<any>` and app code like
  [apps/mcps/story-builder/index.ts](../apps/mcps/story-builder/index.ts)
  used `(globalThis as any).ultralight`. Wave 3 has now corrected that pattern
  across the representative hotspot set. The deeper remaining work is now
  concentrated in `platform-mcp.ts` plus the deliberate `unknown` boundaries
  still left in `study-coach`, `email-ops`, and `resort-manager`. The
  remaining `any` hits in `platform-mcp.ts`, `email-ops`, and
  `resort-manager` are now comment- or string-literal matches, not active weak
  runtime typing.
- All 12 Wave 3 PR slices are now implemented locally. The remaining work is
  downstream review, commit/push, package/release handling, and any staging
  smoke that exercises the touched surfaces, not another contract refactor
  tranche.

## Wave 3 Principles

- Canonical contracts should live in source `.ts` modules, not in hand-edited
  generated declaration files.
- Compatibility re-exports are acceptable during migration, but only as a
  temporary layer with one canonical implementation beneath them.
- Public package contracts and runtime-only internal types should be separated
  so we do not accidentally publish internal persistence details as SDK API.
- We should prioritize strong types at the boundaries where bad contracts are
  most expensive: publish flows, platform tooling, SDK requests, JSON-RPC
  envelopes, generated MCP apps, and AI payload parsing.
- Wave 3 is not a "remove every `unknown` in the repo" exercise. `unknown`
  remains valid at untrusted boundaries until it is narrowed deliberately.

## Scope Boundaries

Wave 3 includes:

- shared contract-source refactors
- generated declarations for `packages/types`
- SDK entrypoint unification
- JSON-RPC/MCP transport contract sharing
- manifest, widget, AI/chat, and runtime contract extraction
- hardening the highest-risk MCP app and platform type hotspots
- CI guardrails against contract drift

Wave 3 does not include:

- broad domain-model redesign for database tables
- changing public API semantics just to make types prettier
- a repo-wide elimination of all `unknown` regardless of trust boundary
- product-logic refactors that belong to Waves 4 or 5 unless they are required
  to make the contract migration safe

## Contract Families

The canonical contract tree should be split by responsibility, not by package:

- `shared/contracts/jsonrpc.ts`
- `shared/contracts/mcp.ts`
- `shared/contracts/ai.ts`
- `shared/contracts/app.ts`
- `shared/contracts/manifest.ts`
- `shared/contracts/widget.ts`
- `shared/contracts/runtime.ts`
- `shared/contracts/user.ts`

[shared/types/index.ts](../shared/types/index.ts)
should remain as a compatibility barrel during the migration, but it should
become a re-export surface rather than the place where new shapes are defined.

## Wave 3 PR Slices

### PR3.1 Contract Inventory And Ownership Map

Status: `implemented locally`

Purpose:

- define which contracts are canonical, generated, compatibility-only, or
  internal-only
- decide what is truly public to the SDK and `packages/types`
- keep later PRs from mixing transport, runtime, and persistence concerns

Expected files:

- `docs/CONTRACT_BOUNDARY_MAP.md`
- [shared/types/index.ts](../shared/types/index.ts)
- [packages/types/README.md](../packages/types/README.md)
- `sdk/README.md` if one is added

Acceptance:

- every exported type family is classified as one of:
  - canonical source
  - generated artifact
  - compatibility re-export
  - internal-only
- the public export surface for the SDK and `packages/types` is explicitly
  listed
- the roadmap for deleting compatibility exports is recorded before refactors
  begin

Verification:

- docs review only
- `cd api && npm run typecheck`

Risks:

- without this boundary map, later PRs can accidentally publish internal-only
  shapes and make the migration harder to reverse

### PR3.2 Canonical Contract Module Split

Status: `implemented locally`

Purpose:

- split the monolith in `shared/types/index.ts` into domain modules without
  breaking existing imports
- create a stable canonical home for each contract family before generation and
  SDK unification begin

Expected files:

- `shared/contracts/jsonrpc.ts`
- `shared/contracts/mcp.ts`
- `shared/contracts/ai.ts`
- `shared/contracts/manifest.ts`
- `shared/contracts/widget.ts`
- `shared/contracts/runtime.ts`
- [shared/types/index.ts](../shared/types/index.ts)

Acceptance:

- new shared contracts live under `shared/contracts/*`
- key manifest, AI, widget, env, runtime, JSON-RPC, and MCP consumers can
  import the new modules directly
- migration can proceed incrementally without a flag-day import rewrite

Verification:

- `cd api && npm run typecheck`
- `cd api && npm test`
- targeted import smoke checks in packages that consume shared types

Risks:

- import churn can create circular references if contract modules import
  runtime code instead of remaining leaf modules

### PR3.3 Generated `packages/types` Pipeline

Status: `implemented locally`

Purpose:

- stop hand-maintaining `packages/types/index.d.ts`
- generate the published type package from the canonical shared contract source

Expected files:

- `scripts/contracts/generate-types-package.mjs`
- `packages/types/package.json`
- `packages/types/index.d.ts`
- `packages/types/README.md`
- a dedicated contract `tsconfig` if needed

Acceptance:

- `packages/types/index.d.ts` is generated from the canonical contract source
- `packages/types/package.json` has explicit generation/check scripts
- README marks the file as generated and points contributors to the canonical
  source
- CI can fail on drift instead of relying on reviewers to notice it

Verification:

- `node scripts/contracts/generate-types-package.mjs`
- `git diff --exit-code packages/types/index.d.ts`
- `cd api && npm run typecheck`

Risks:

- declaration generation can accidentally omit ambient or conditional types if
  the build path is underspecified; this PR needs focused verification

### PR3.4 SDK Entrypoint Unification

Status: `implemented locally`

Purpose:

- collapse `sdk/src/index.ts` and `sdk/mod.ts` into one maintained
  implementation surface
- ensure type and behavior drift cannot recur between npm and Deno-facing
  entrypoints

Expected files:

- [sdk/src/index.ts](../sdk/src/index.ts)
- [sdk/mod.ts](../sdk/mod.ts)
- [sdk/package.json](../sdk/package.json)
- optional SDK tests if missing

Acceptance:

- one file owns SDK implementation logic
- the secondary entrypoint is a thin wrapper or re-export surface
- Deno/npm entrypoints can no longer drift by parallel maintenance

Verification:

- SDK import smoke tests for both entrypoints
- `cd api && npm run typecheck`

Risks:

- Deno/npm export compatibility needs to be preserved, so this PR should avoid
  changing package semantics while it removes duplication

### PR3.5 Shared JSON-RPC And MCP Transport Contracts

Status: `implemented locally`

Purpose:

- remove duplicate transport-envelope declarations from handlers and the SDK
- centralize JSON-RPC ids, requests, responses, tool definitions, and result
  envelopes

Expected files:

- `shared/contracts/jsonrpc.ts`
- `shared/contracts/mcp.ts`
- [api/handlers/mcp.ts](../api/handlers/mcp.ts)
- [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
- [sdk/src/index.ts](../sdk/src/index.ts)
- optional helper:
  `api/services/mcp-response-format.ts`

Acceptance:

- `JsonRpcId`, `JsonRpcRequest`, and `JsonRpcResponse` are imported rather than
  redeclared in handlers and SDK code
- shared MCP tool/result envelope types replace local clones
- transport formatting helpers stop being re-authored in both MCP handlers

Verification:

- `cd api && npm run typecheck`
- `cd api && npm test`
- grep-based assertion that the duplicate local interface declarations are gone

Risks:

- transport helpers can accidentally absorb behavior changes if the PR is too
  broad; keep it contract-focused and test error/result shaping

### PR3.6 Manifest, Parsed Skills, And App Runtime Contract Extraction

Status: `implemented locally`

Purpose:

- separate manifest and runtime app contracts from unrelated AI and widget
  types
- stop manifest-heavy paths from flowing through `any` and unowned
  `Record<string, unknown>` blobs

Expected files:

- `shared/contracts/manifest.ts`
- `shared/contracts/app.ts`
- `shared/contracts/runtime.ts`
- [shared/types/index.ts](../shared/types/index.ts)
- [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
- [api/handlers/app.ts](../api/handlers/app.ts)

Acceptance:

- `AppManifest`, `ParsedSkills`, runtime env/config shapes, and app row DTOs
  have canonical homes
- the main manifest-handling paths import typed contracts instead of using
  ad hoc object records
- `platform-mcp.ts` no longer carries manifest rows as raw `any`

Verification:

- `cd api && npm run typecheck`
- focused manifest and platform tests

Risks:

- manifest data comes from both storage and generated content, so narrowing has
  to preserve explicit validation at trust boundaries

### PR3.7 AI, Chat, And Widget Contract Extraction

Status: `implemented locally`

Purpose:

- make AI payloads and widget payloads explicit contract families instead of
  incidental exports from the shared-type monolith
- reduce shape drift between API, desktop, web, and SDK consumers

Expected files:

- `shared/contracts/ai.ts`
- `shared/contracts/widget.ts`
- [shared/types/index.ts](../shared/types/index.ts)
- consumers in `api`, `desktop`, `web`, and `sdk`

Acceptance:

- `AIRequest`, `AIResponse`, chat/tool payloads, and widget payloads have
  canonical module homes
- downstream consumers import shared contracts instead of local lookalikes
- the optional `AIResponse.error` field remains consistent across every export
  surface

Verification:

- `cd api && npm run typecheck`
- package-specific typecheck or test runs for any touched desktop/web consumers

Risks:

- cross-package consumer drift is the point of this PR, so it should be kept
  contract-only and not mixed with UI behavior changes

### PR3.8 Platform MCP DTO Hardening

Status: `implemented locally (expanded tranche)`

Purpose:

- harden the highest-value weak-type hotspot first:
  [platform-mcp.ts](../api/handlers/platform-mcp.ts)
- replace ad hoc object maps with named DTOs for tool inputs, app metadata,
  share/publish payloads, generated code outputs, and manifest-bearing rows

Expected files:

- [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
- `shared/contracts/app.ts`
- `shared/contracts/manifest.ts`
- optional helper modules under `api/services/platform-*`

Acceptance:

- `platform-mcp.ts` no longer uses `Promise<any>` in scaffolded/generated core
  paths
- manifest-bearing app rows and inspect/discover surfaces use typed manifest
  parsing instead of raw `any`
- the main remaining `platform-mcp.ts` weak-type debt is clearly narrowed to
  later targeted tranches instead of the transport and scaffold seams

Implemented in this tranche so far:

- manifest-bearing discover/inspect surfaces now consume typed shared
  manifest contracts rather than local raw-object clones
- tool-call and lint/test result handling now go through typed helper DTOs for
  tool args, lint summaries, RPC unwrapping, and async job envelopes
- wallet status/earnings/withdraw/payout flows now use named Supabase row DTOs
  instead of ad hoc `Record<string, unknown>` parsing
- codemode dynamic binding setup now uses typed worker export helpers instead
  of `(globalThis.__ctx as any)` in live execution paths
- discovery/export/config surfaces now use typed gap rows, audit-log export
  rows, rate-limit configs, pricing configs, inspect storage details, inspect
  permission rows, and typed GPU pricing/reliability payloads
- library, appstore, and connections browse surfaces now use named DTOs for
  saved content rows, content-fusion search rows, blocked-item rows, featured
  app rows, connection rows, and manifest-aware env-schema fetches instead of
  scattered anonymous `json()` casts
- desk and page-share surfaces now use named manifest/share DTOs for recent
  app rows, content share rows, memory share rows, owner-email lookups, and
  share upsert payloads instead of mutating generic objects mid-flight
- permissions and owner-visible log surfaces now use shared `TimeWindow` /
  permission constraint shapes plus named pending-invite, permission-row,
  user-lookup, and app-log DTOs instead of local `unknown` payloads
- health-event, gap-assessment, and library-context surfaces now use named
  event/app/reference DTOs for event ownership checks, app-name joins, gap
  submission payloads, and lightweight library-count reads instead of raw
  Supabase response casts
- rating, search-hint, and metrics-listing surfaces now use named app/content
  lookup rows, reaction rows, library/block mutation payloads, string-array
  normalization, and listing upsert DTOs instead of inline object shapes and
  ad hoc array narrowing
- connect, inspect, memory, and share surfaces now use named lookup DTOs for
  permission checks, secret rows, content/user resolution, memory-share
  permissions, and share-result payloads instead of raw Supabase response casts
- library and appstore search results now form a real discriminated union, so
  shared app/content serialization no longer relies on impossible `"app"` cases
  leaking through content result branches
- the file-level `any` count is down to comment- and string-literal matches;
  the `unknown` count is down from `156` to `132`, and the remaining platform
  work is concentrated in deeper marketplace/library/admin boundary narrowing
  rather than export/config or browse/appstore plumbing

Verification:

- `cd api && npm run typecheck`
- `cd api && npm test`
- focused platform MCP tests

Risks:

- this file is large and central, so the PR should move one coherent DTO family
  at a time rather than trying to rewrite the whole handler in one pass

### PR3.9 Generated Runtime Typing And Ambient `ultralight` Globals

Status: `implemented locally (initial tranche)`

Purpose:

- stop generated MCP apps from starting life in an `any` hole
- provide a canonical type for `globalThis.ultralight` and related runtime
  helpers

Expected files:

- a shared ambient declaration such as `shared/contracts/runtime-globals.d.ts`
- [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
- generated MCP templates if present
- representative app consumers such as
  [apps/mcps/story-builder/index.ts](../apps/mcps/story-builder/index.ts)

Acceptance:

- new scaffold output avoids `Promise<any>` and `(globalThis as any).ultralight`
- the representative hotspot MCP apps now use `globalThis.ultralight` instead
  of defaulting to `any` for the top-level runtime global
- deeper app-specific DTO hardening still belongs to the remaining app tranches

Verification:

- `cd api && npm run typecheck`
- targeted MCP app typecheck or tests where available

Risks:

- ambient declarations can leak too broadly if not scoped carefully; prefer
  explicit module exports unless an ambient hook is truly required

### PR3.10 MCP App Hardening Tranche A

Status: `implemented locally`

Purpose:

- harden the busiest or most structurally weak MCP apps first
- use the new shared contract modules instead of app-local `any` patterns

Target apps:

- [apps/mcps/study-coach/index.ts](../apps/mcps/study-coach/index.ts)
- [apps/mcps/email-ops/index.ts](../apps/mcps/email-ops/index.ts)
- [apps/mcps/story-builder/index.ts](../apps/mcps/story-builder/index.ts)

Acceptance:

- replace the major `any` clusters with named DTOs or deliberate narrowing
- external library responses are wrapped or normalized instead of passed
  through as raw `any`
- the apps consume the shared runtime/global contracts from PR3.9

Implemented in this tranche so far:

- [apps/mcps/story-builder/index.ts](../apps/mcps/story-builder/index.ts)
  now uses named world, character, faction, arc, scene, and mutation DTOs
  instead of broad `any` maps in its main read/update/delete flows
- the file's weak-type count is down to `any=3`, `unknown=6`
- [apps/mcps/study-coach/index.ts](../apps/mcps/study-coach/index.ts)
  now uses named subject, concept, quiz, lesson, fluency, and widget DTOs with
  typed JSON parsing helpers; `any=0`, `unknown=23`
- [apps/mcps/email-ops/index.ts](../apps/mcps/email-ops/index.ts)
  now uses named IMAP/socket, conversation, version, approval, widget, and AI
  reply DTOs with normalized draft/classification parsing; the file's remaining
  `any` hits are comment-only and the active weak-type count is effectively
  `any=0`, `unknown=27`

Verification:

- app-specific tests if present
- `cd api && npm run typecheck`
- spot runtime checks for the touched MCP apps if lightweight harnesses exist
- focused TypeScript compile smoke for the hardened files with a minimal
  ambient runtime stub

Risks:

- external packages like mail clients or AI providers may require wrapper types
  rather than perfect static modeling; keep the boundary typed even if the
  third-party internals stay opaque

### PR3.11 MCP App Hardening Tranche B

Status: `implemented locally`

Purpose:

- finish the first high-risk MCP app sweep after tranche A proves the patterns

Target apps:

- [apps/mcps/resort-manager/index.ts](../apps/mcps/resort-manager/index.ts)
- [apps/mcps/digest/index.ts](../apps/mcps/digest/index.ts)
- [apps/mcps/memory-wiki/index.ts](../apps/mcps/memory-wiki/index.ts)

Acceptance:

- the major `any` and unsafe object-map flows are replaced with named DTOs or
  typed narrowing helpers
- shared contract modules are used consistently across the hardened apps
- weak typing trends downward in the known hotspot set, not just in one file

Implemented in this tranche so far:

- [apps/mcps/digest/index.ts](../apps/mcps/digest/index.ts)
  now uses named insight, newsletter, dashboard, and digest-run DTOs with
  typed JSON parsing helpers; `any=0`
- [apps/mcps/memory-wiki/index.ts](../apps/mcps/memory-wiki/index.ts)
  now uses named page, source, lint, and AI-compile DTOs across search/query/
  sync/lint/widget flows; `any=0`
- [apps/mcps/resort-manager/index.ts](../apps/mcps/resort-manager/index.ts)
  now uses named room, ski, golf, restaurant, store, revenue, guideline, and
  approval DTOs across booking/reporting/admin flows; the file's remaining
  `any` hit is comment-only and the active weak-type count is effectively
  `any=0`, `unknown=50`

Verification:

- app-specific tests if present
- `cd api && npm run typecheck`
- focused TypeScript compile smoke for the hardened files with a minimal
  ambient runtime stub

Risks:

- some app logic may be structurally messy enough that a small targeted helper
  extraction is needed before types can be cleaned safely

### PR3.12 Contract Drift CI And Release Gates

Status: `implemented locally`

Purpose:

- prevent the repo from drifting back to hand-maintained parallel contracts
- turn Wave 3 outcomes into guardrails instead of one-time cleanup

Expected files:

- CI workflow updates under `.github/workflows/`
- `scripts/contracts/generate-types-package.mjs`
- optional `scripts/checks/check-sdk-surface-parity.mjs`
- [docs/DEVELOPMENT_TOOLING.md](DEVELOPMENT_TOOLING.md)

Acceptance:

- CI checks generated `packages/types` drift
- CI checks SDK entrypoint parity or wrapper-only status
- CI fails if banned duplicate transport declarations reappear in the known
  handler/SDK files
- local tooling docs tell contributors how to regenerate and verify contracts

Verification:

- CI dry run where possible
- local invocation of the new contract-generation and parity checks
- `cd api && npm run typecheck` with a cleared baseline so new errors fail
  immediately instead of hiding behind a known-error snapshot

Risks:

- overbroad lint rules can be noisy; prefer narrow checks against the known
  drift patterns this wave is explicitly fixing

## Recommended Execution Order

1. `PR3.1` contract boundary map
2. `PR3.2` canonical contract module split
3. `PR3.3` generated `packages/types` pipeline
4. `PR3.4` SDK entrypoint unification
5. `PR3.5` shared JSON-RPC and MCP transport contracts
6. `PR3.6` manifest, parsed-skills, and runtime contract extraction
7. `PR3.7` AI, chat, and widget contract extraction
8. `PR3.8` platform MCP DTO hardening
9. `PR3.9` generated runtime typing and ambient globals
10. `PR3.10` MCP app hardening tranche A
11. `PR3.11` MCP app hardening tranche B
12. `PR3.12` contract drift CI and release gates

Parallelism notes:

- `PR3.4` and `PR3.5` can overlap only after `PR3.2` defines canonical module
  homes.
- `PR3.10` and `PR3.11` should not overlap if they need to touch shared MCP
  runtime/global declarations at the same time.
- `PR3.12` should land last so guardrails reflect the final contract model
  instead of an in-between state.

## What Success Looks Like

Wave 3 is complete when:

- there is one canonical contract source tree under `shared/contracts/*`
- `shared/types/index.ts` is compatibility-only
- `packages/types` is generated, not hand-authored
- the SDK has one maintained implementation surface
- JSON-RPC/MCP transport types are shared imports, not local clones
- the known high-risk MCP app and platform hotspots have been materially
  hardened away from casual `any`
- CI prevents the old drift patterns from coming back

## Manual Tasks At The End

To keep human work consolidated, the only expected manual tasks should happen
after the code PRs above land:

1. Decide version bumps and release notes for any externally consumed contract
   changes in `@ultralightpro/types` and the SDK.
2. Run downstream consumer smoke checks against packed artifacts before
   publishing updated packages.
3. Publish the updated packages only after those smoke checks pass.

There should be no mandatory manual checkpoint in the middle of Wave 3 unless a
consumer-compatibility surprise is discovered during implementation.
