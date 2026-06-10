# MCP / Env / GPU / Tool Maker Reliability Roadmap

Status: Waves 1-4 implemented; Wave 4.4 cleanup intentionally deferred pending telemetry review

Last updated: April 23, 2026

Scope:
- MCP sharing permissions
- app-level and per-user env propagation
- GPU deployment and runtime reliability
- Tool Maker generation/test/upload reliability

Implementation status as of April 23, 2026:
- Wave 1 complete
- Wave 2 complete
- Wave 3 complete
- Wave 4 complete for diagnostics, observability, and telemetry
- Wave 4.4 compatibility removal intentionally deferred until legacy-compat telemetry is reviewed in a real environment

Explicitly deferred for now:
- published MCP fraud / behavior-verification work

## Goal

Turn four partially-proven product areas into boringly reliable platform paths.

The guiding principle is simple:
- Wave 1 fixes correctness blockers.
- Wave 2 makes the new behavior migration-safe and developer-friendly.
- Wave 3 proves the behavior end to end.
- Wave 4 hardens operations, diagnostics, and rollback safety.

## Wave 1: Correctness Blockers

### PR 1.1: Canonical MCP function identity

What lands:
- define one canonical function identity model for private-app permissions
- normalize raw function names and MCP-prefixed tool names at a shared helper seam
- make tools/list and tools/call enforce the same normalized identity

Why:
- sharing currently looks implemented in the UI but can fail at runtime because
  grants store raw names while MCP tools are exposed with slug-prefixed names

Exit criteria:
- private-app recipients can both see and call granted tools
- owners and recipients use the same naming logic everywhere

### PR 1.2: Permission write-path normalization

What lands:
- normalize function names at every write path
- cover owner grants, user settings grants, and pending invite resolution
- invalidate caches using the same canonical identity rules

Why:
- fixing only the read path leaves new and old permission rows diverging

Exit criteria:
- newly granted permissions are stored consistently
- pending invite activation produces runtime-usable rows

### PR 1.3: Shared env resolver across MCP, run, and HTTP

What lands:
- introduce one env-resolution helper that merges:
  - app owner env vars
  - per-user secrets
  - required-secret validation
- route MCP, `/run`, and `/http` through the same helper

Why:
- MCP is closest to correct today, but `/run` and `/http` do not have the same
  per-user secret behavior

Exit criteria:
- all runtime surfaces resolve env the same way
- required per-user secrets fail with the same structured error model

### PR 1.4: GPU deployment fail-closed semantics

What lands:
- fail GPU deploys when app-specific code download cannot be guaranteed
- remove or explicitly guard the shared-template fallback that can run baked-in code
- sync stale smoke-test expectations with the real GPU rate table

Why:
- GPU deploys should never succeed into a state that might run fallback test code

Exit criteria:
- a build is either clearly app-specific and valid or clearly blocked
- offline GPU smoke tests reflect current runtime truth

### PR 1.5: Tool Maker scaffold baseline

What lands:
- improve generated scaffold output so the default files are deploy-shaped
- tighten scaffold guidance around manifest/functions/env/contracts
- make the scaffold path fail loudly when it is still placeholder-only

Why:
- the platform upload path is stronger than the default generated code quality

Exit criteria:
- scaffolded apps are at least lint/test/upload ready on a narrow happy path
- placeholder behavior is explicit, not accidentally production-looking

## Wave 2: Compatibility And Migration

### PR 2.1: Permission compatibility layer and backfill

What lands:
- dual-read support for legacy raw-name permission rows
- targeted migration/backfill for existing permission and pending invite data
- temporary telemetry on legacy-name hits

Why:
- we need a safe bridge for already-stored data before deleting compatibility code

### PR 2.2: Env settings UX and validation convergence

What lands:
- stronger schema-aware validation for per-user secrets
- clearer setup-state reporting in app settings and runtime errors
- one shared missing-secret message contract across surfaces

Why:
- consistency is not enough if the failure mode is still hard to diagnose

### PR 2.3: GPU preflight and state machine cleanup

What lands:
- preflight validation for required platform env and provider config
- clearer GPU status transitions and failure reasons
- stronger separation between build failure, config failure, and runtime failure

Why:
- GPU issues should fail before the build starts when possible

### PR 2.4: Tool Maker richer local test surface

What lands:
- extend `ul.test` to support env fixtures
- add D1-like fixture setup for generated tools
- keep the testing model closer to deployed behavior without requiring full deploy

Why:
- Tool Maker needs better local confidence before `ul.upload`

## Wave 3: End-To-End Proof

### PR 3.1: Multi-user MCP sharing E2E tests

What lands:
- owner grant flow
- pending invite resolution flow
- recipient tools/list and tools/call verification

Why:
- this is the missing proof for the sharing feature

### PR 3.2: Cross-surface env E2E tests

What lands:
- owner env + per-user secret combinations tested through MCP, `/run`, and `/http`
- required-secret and override precedence checks

Why:
- env correctness needs proof across all execution surfaces, not just sandbox unit tests

### PR 3.3: Gated live GPU integration tests

What lands:
- opt-in live tests for build, health, hello/add/fail execution, and billing signals
- offline checks remain mandatory; live checks run when provider secrets are present

Why:
- GPU cannot be considered done on unit tests and offline smoke checks alone

### PR 3.4: Tool Maker golden-path acceptance tests

What lands:
- prompt -> scaffold -> `ul.test` -> `ul.upload` -> runtime call
- one or two representative tool types

Why:
- we need proof that the overall agent workflow works, not just the individual tools

## Wave 4: Hardening And Operability

### PR 4.1: Sharing and secret diagnostics

What lands:
- better admin-facing and user-facing error messages
- fast diagnosis for permission mismatch, missing-secret, and setup-state errors

Why:
- support cost drops sharply when failure messages are actionable

### PR 4.2: GPU observability and recovery UX

What lands:
- cleaner GPU build logs and surfaced failure reasons
- retry guidance and operational breadcrumbs
- better visibility into cold start vs harness failure vs provider failure

Why:
- GPU is expensive enough that operators need first-class debug paths

### PR 4.3: Tool Maker failure telemetry

What lands:
- stage-level telemetry for scaffold, test, upload, and runtime failure buckets
- dashboards or lightweight summaries for where generated tools fail most often

Why:
- we need to know whether failures come from generation quality, test fidelity, or platform deploy issues

### PR 4.4: Compatibility removal and cleanup

What lands:
- remove temporary dual-read/dual-write compatibility paths after migrations settle
- delete stale fallback code and old diagnostics

Why:
- the codebase should end up simpler than it started, not permanently more defensive

## Recommended Implementation Order

1. PR 1.1
2. PR 1.2
3. PR 1.3
4. PR 1.4
5. PR 1.5
6. PR 2.1
7. PR 2.2
8. PR 2.3
9. PR 2.4
10. PR 3.1
11. PR 3.2
12. PR 3.3
13. PR 3.4
14. PR 4.1
15. PR 4.2
16. PR 4.3
17. PR 4.4

## First PR Recommendation

Start with PR 1.1: canonical MCP function identity.

That is the highest-confidence correctness bug, it affects a user-facing promise
immediately, and it unblocks the rest of the sharing fixes without forcing us to
touch GPU or Tool Maker first.
