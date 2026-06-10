# Wave 5 Product Credibility Roadmap

Last reviewed: `2026-04-21`

Wave 5 is the “this feels launchable” wave. The earlier waves converged
security, platform plumbing, contracts, and legacy architecture. This wave is
about whether the repo and the live product read like a maintained platform or
like a prototype that still expects forgiveness from its users.

This roadmap keeps the work concrete and reviewable. It is not a generic
"polish" bucket.

## Why Wave 5 Exists

Wave 5 existed because the repo had concentrated credibility debt in a few
places that users feel immediately:

- placeholder and prototype-style runtime copy
- broad unstructured logging in product-facing code
- duplicated widget runtime behavior across desktop surfaces
- uneven loading, empty, and error states across desktop and web shells
- a lingering desktop system-agent rename bridge tied to older local DB state

Most of that implementation work is now complete locally. The remaining Wave 5
repo work is guardrail closeout plus the end-of-wave staging/production smoke
and copy review.

## Wave 5 Outcomes

- Product-facing runtime copy no longer advertises unfinished implementation.
- Generated apps and scaffolds read like a deliberate starter kit, not a TODO.
- Logging is structured, redacted, and intentionally scoped.
- Widget runtime behavior is consolidated behind shared desktop helpers.
- Core desktop and web surfaces use consistent loading, empty, and error
  states.
- The remaining Wave 5 compatibility bridge has an explicit removal path.

## Non-Goals

Wave 5 does not:

- reopen Wave 1 security transport work
- reopen Wave 2 execution-path convergence
- reopen Wave 3 contract-source architecture
- reopen Wave 4 migration-data cleanup except where a Wave 5 surface still
  carries user-visible credibility debt
- rewrite the whole design system or replace established UI patterns just for
  novelty

## Exit Criteria

Wave 5 is complete when all of the following are true:

- `placeholder-runtime-strings` is `0` in
  [scripts/checks/guardrail-baseline.json](../scripts/checks/guardrail-baseline.json),
  or any intentional exception is explicitly documented and reviewed
- active product and generator paths no longer emit “not yet implemented,”
  “Phase X,” or TODO-style runtime copy to users
- logging in product/server code routes through shared helpers or documented
  allowlisted direct console output
- widget discovery, cache, HTML loading, bridge injection, and widget-open
  navigation are no longer duplicated across desktop surfaces
- the prioritized desktop and web surfaces below have consistent loading, empty,
  and error affordances
- the system-agent rename cleanup is either deleted or fenced behind a
  versioned local migration with a documented removal floor

## Dependencies And Preconditions

- Wave 4 must remain the source of truth for compatibility telemetry and
  version-gated migrations.
- Wave 5 should assume the repo’s Node 20 / Deno tooling baseline from Wave 0.
- The known desktop typecheck debt in
  [desktop/src/components/ChatView.tsx](../desktop/src/components/ChatView.tsx),
  [desktop/src/components/HomeView.tsx](../desktop/src/components/HomeView.tsx),
  and [desktop/src/components/WidgetInbox.tsx](../desktop/src/components/WidgetInbox.tsx)
  should be treated as a Wave 5 precondition for UI-focused PRs rather than
  ignored background noise.

## Recommended Landing Order

1. `PR5.1` desktop compile baseline for Wave 5 surfaces
2. `PR5.2` placeholder runtime string removal
3. `PR5.3` scaffold and generated-copy credibility cleanup
4. `PR5.4` logging foundation and policy
5. `PR5.5` API/server logging conversion
6. `PR5.6` desktop/web/CLI logging conversion
7. `PR5.7` widget runtime consolidation
8. `PR5.8` desktop async-state consistency
9. `PR5.9` web shell and owner-dashboard async-state consistency
10. `PR5.10` active-code comment and slop cleanup
11. `PR5.11` system-agent rename bridge removal
12. `PR5.12` credibility guardrails and closeout

Why this order:

- `PR5.1` removes the current compile instability on the desktop files most
  likely to change in this wave.
- `PR5.2` and `PR5.3` remove the most obvious user-facing credibility debt
  first.
- `PR5.4` creates the logging contract before we refactor large logging
  surfaces.
- `PR5.7` through `PR5.9` then consolidate the widget/runtime UX work on top of
  a quieter logging baseline.
- `PR5.10` through `PR5.12` keep the cleanup from regressing.

## Detailed PR Roadmap

### PR5.1 Desktop Compile Baseline For Wave 5 Surfaces

Status: `implemented locally`

Purpose:

- make the known desktop Wave 5 surfaces typecheck-clean before we start
  refactoring widget runtime and UI-state code

Expected files:

- [desktop/src/components/ChatView.tsx](../desktop/src/components/ChatView.tsx)
- [desktop/src/components/HomeView.tsx](../desktop/src/components/HomeView.tsx)
- [desktop/src/components/WidgetInbox.tsx](../desktop/src/components/WidgetInbox.tsx)
- any small shared type/helper files required to make those compile cleanly

Acceptance:

- full desktop typecheck is green for the Wave 5 target surface
- later Wave 5 PRs do not have to work around stale type errors in these files

Verification:

- `cd desktop && corepack pnpm exec tsc --noEmit`
- any targeted component tests that already exist for the touched files

Risks:

- this can accidentally become a drive-by desktop sweep if the scope is not
  kept tight to the known blocker files

Implemented in this tranche:

- aligned
  [desktop/src/components/ChatView.tsx](../desktop/src/components/ChatView.tsx)
  with the current server-side system-agent tool model instead of the removed
  `toolScope` field
- removed the statically impossible `project_disabled` tab branch from
  [desktop/src/components/HomeView.tsx](../desktop/src/components/HomeView.tsx)
- updated
  [desktop/src/components/WidgetInbox.tsx](../desktop/src/components/WidgetInbox.tsx)
  to use the current `useWidgetInbox()` source/meta model rather than the
  retired item/action API shape

### PR5.2 Remove Remaining Placeholder Runtime Strings

Status: `implemented locally`

Purpose:

- eliminate the currently-reviewed placeholder runtime strings and make the
  guardrail baseline reflect zero intentional unfinished runtime copy

Expected files:

- [api/handlers/apps.ts](../api/handlers/apps.ts)
- [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
- [scripts/checks/run-guardrail-checks.mjs](../scripts/checks/run-guardrail-checks.mjs)
- [scripts/checks/guardrail-baseline.json](../scripts/checks/guardrail-baseline.json)

Acceptance:

- `placeholder-runtime-strings` is `0`
- no owner-facing or generated product path says “not yet implemented”
- replacement copy is honest, concise, and action-oriented rather than vague

Verification:

- `node scripts/checks/run-guardrail-checks.mjs`
- targeted flow checks for the affected generator and docs-generation paths

Risks:

- copy changes can accidentally hide feature limitations instead of explaining
  them clearly; replacement language must stay truthful

Implemented in this tranche:

- updated
  [api/handlers/apps.ts](../api/handlers/apps.ts)
  so the AI-enhancement warning now explains the real behavior of the current
  docs-generation flow instead of shipping “not yet implemented” copy
- updated
  [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
  so generated scaffold stubs now return an explicit “add application logic and
  redeploy” error instead of a placeholder success message
- reduced the launch guardrail baseline to
  `placeholder-runtime-strings: 0` in
  [scripts/checks/guardrail-baseline.json](../scripts/checks/guardrail-baseline.json)

### PR5.3 Scaffold And Generated-Copy Credibility Cleanup

Status: `implemented locally`

Purpose:

- make newly generated apps, starter files, and product-guided outputs look
  maintained and teach the right patterns without prototype language

Expected files:

- [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
- [api/services/docgen.ts](../api/services/docgen.ts)
- any scaffold/template fixtures or tests covering generated starter output

Acceptance:

- generated source no longer includes “TODO: implement” or “Phase X” comments
  that describe unfinished work in-motion
- starter code still contains brief, useful explanatory comments where a new
  developer would actually benefit
- generated user copy explains feature boundaries without sounding temporary

Verification:

- generate representative scaffold outputs and review diffs
- guardrail search for `TODO:` / `not yet implemented` in generator output code

Risks:

- over-cleaning can make starter code too bare for new developers; the goal is
  concise explanatory scaffolding, not silent files

Implemented in this tranche:

- updated
  [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
  so scaffolded starters now describe the intended first edit more clearly,
  replace the old TODO-style next step with action-oriented guidance, and use a
  starter-response error that reads like a maintained template rather than a
  prototype
- updated
  [api/services/docgen.ts](../api/services/docgen.ts)
  so generated `Skills.md` output now uses a cleaner source-of-truth notice,
  gives an actionable empty-functions message, and removes placeholder framing
  from the AI helper path
- added focused regression coverage in
  [api/services/docgen.test.ts](../api/services/docgen.test.ts)
  and wired it into
  [api/package.json](../api/package.json)

### PR5.4 Logging Foundation And Policy

Status: `implemented locally`

Purpose:

- define the shared logging contract so later cleanup removes noise without
  removing needed operational visibility

Expected files:

- [api/services](../api/services)
- [desktop/src/lib](../desktop/src/lib)
- [cli](../cli)
- [docs/ENGINEERING_FAILURE_POLICY.md](ENGINEERING_FAILURE_POLICY.md)
- a new logging policy doc if needed

Acceptance:

- shared logging helpers exist for server, desktop, and CLI surfaces
- redaction guidance exists for auth tokens, secrets, headers, and PII
- direct `console.*` in product code is either migrated or explicitly
  allowlisted by category

Verification:

- typecheck for touched packages
- repo search showing the new helper usage in the highest-priority surfaces

Risks:

- if the policy is too abstract, later PRs will ignore it; this PR needs both
  helpers and explicit usage rules

Implemented in this tranche:

- added shared logging helpers in
  [api/services/logging.ts](../api/services/logging.ts),
  [desktop/src/lib/logging.ts](../desktop/src/lib/logging.ts),
  and [cli/logging.ts](../cli/logging.ts)
  so later conversion PRs can land on one consistent contract instead of
  inventing file-local patterns
- wired representative API logging helpers onto the shared server logger in
  [api/services/auth-transport.ts](../api/services/auth-transport.ts),
  [api/services/app-runtime-telemetry.ts](../api/services/app-runtime-telemetry.ts),
  [api/services/platform-alias-telemetry.ts](../api/services/platform-alias-telemetry.ts),
  [api/services/call-logger.ts](../api/services/call-logger.ts),
  and [api/services/app-runtime-resources.ts](../api/services/app-runtime-resources.ts)
- wired the desktop system-agent summary surface and CLI top-level fatal
  diagnostics onto the new helpers in
  [desktop/src/lib/agentStateSummary.ts](../desktop/src/lib/agentStateSummary.ts)
  and [cli/mod.ts](../cli/mod.ts)
- documented the redaction rules and direct-console allowlist in
  [docs/LOGGING_POLICY.md](LOGGING_POLICY.md)
  and linked that guidance from
  [docs/ENGINEERING_FAILURE_POLICY.md](ENGINEERING_FAILURE_POLICY.md)

### PR5.5 API And Server Logging Conversion

Status: `implemented locally`

Purpose:

- replace the broadest API/server console footprint with structured,
  intentionally-scoped logging

Expected files:

- [api/src/worker-entry.ts](../api/src/worker-entry.ts)
- [api/handlers/apps.ts](../api/handlers/apps.ts)
- [api/handlers/user.ts](../api/handlers/user.ts)
- [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
- [api/handlers/upload.ts](../api/handlers/upload.ts)
- [api/handlers/chat.ts](../api/handlers/chat.ts)
- selected noisy services such as billing, marketplace, tokens, and cron flows

Acceptance:

- top API/server hotspots no longer use free-form debug logging
- request, cron, billing, publish, and failure logs have stable event shapes
- noisy progress/debug traces are removed or demoted to explicit debug-only
  paths

Verification:

- `cd api && npm run typecheck`
- `cd api && npm test`
- repo search comparing pre/post `console.*` counts on the targeted files

Risks:

- some logs are serving as de facto operator breadcrumbs today, so this PR must
  preserve event usefulness while reducing volume

Implemented in this tranche:

- converted the worker entrypoint in
  [api/src/worker-entry.ts](../api/src/worker-entry.ts)
  onto structured request and cron logging so incoming requests, cron triggers,
  degraded hourly jobs, and unhandled failures now emit stable event records
- converted the chat proxy in
  [api/handlers/chat.ts](../api/handlers/chat.ts)
  so auth, guard failures, OpenRouter calls, post-stream billing, function-index
  rebuilds, context resolution, and key provisioning no longer rely on free-form
  debug strings
- converted the upload surfaces in
  [api/handlers/upload.ts](../api/handlers/upload.ts)
  so request intake, manifest/GPU detection, storage/integrity side effects,
  skills generation, and post-upload rebuilds now use structured upload/storage/
  integrity scopes instead of raw console output
- added the shared logging foundation to representative app-owner and platform
  flows in
  [api/handlers/apps.ts](../api/handlers/apps.ts)
  so the converted paths now use stable scope-based logging, while broader file
  cleanup remains separate debt rather than hidden as “done”
- added the shared logging foundation to representative Stripe and user-account
  flows in
  [api/handlers/user.ts](../api/handlers/user.ts)
  so the webhook money flow and selected account/token paths now emit
  structured `STRIPE` and `USER` logs, while the remaining handler-wide console
  debt is still explicitly unresolved
- added the shared logging foundation to representative platform execution
  flows in
  [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
  across codemode, upload/KV/GPU, and telemetry paths, with the remaining
  handler-wide console debt left visible for follow-up rather than treated as
  fully closed

### PR5.6 Desktop, Web, And CLI Logging Conversion

Status: `implemented locally`

Purpose:

- remove product-surface debug logging that would make desktop, web, and CLI
  feel unfinished or noisy

Expected files:

- [desktop/src/components/ChatView.tsx](../desktop/src/components/ChatView.tsx)
- [desktop/src/hooks/useWidgetInbox.ts](../desktop/src/hooks/useWidgetInbox.ts)
- [desktop/src/lib/agentRunner.ts](../desktop/src/lib/agentRunner.ts)
- [web/layout.ts](../web/layout.ts)
- [cli/mod.ts](../cli/mod.ts)
- [cli/bin/ultralight.js](../cli/bin/ultralight.js)

Acceptance:

- desktop and web surfaces no longer emit routine debug traces in normal usage
- CLI differentiates intentional user output from diagnostics
- the logging helpers from `PR5.4` are actually used, not just defined

Verification:

- desktop and CLI typecheck/tests as relevant
- repo search showing reduced direct `console.*` usage in the targeted files

Risks:

- CLI output is a user interface, so some `console` calls are legitimate; this
  PR must preserve deliberate stdout/stderr behavior

Implemented in this tranche:

- [desktop/src/components/ChatView.tsx](../desktop/src/components/ChatView.tsx),
  [desktop/src/hooks/useWidgetInbox.ts](../desktop/src/hooks/useWidgetInbox.ts),
  and [desktop/src/lib/agentRunner.ts](../desktop/src/lib/agentRunner.ts)
  now route runtime diagnostics through
  [desktop/src/lib/logging.ts](../desktop/src/lib/logging.ts)
  instead of raw `console.*`, and the three main desktop targets are now at
  zero direct `console.*` usage.
- the desktop runtime foundation was extended to a few adjacent hot paths in
  [desktop/src/App.tsx](../desktop/src/App.tsx),
  [desktop/src/hooks/useDesktopUpdater.ts](../desktop/src/hooks/useDesktopUpdater.ts),
  [desktop/src/main.tsx](../desktop/src/main.tsx),
  [desktop/src/lib/api.ts](../desktop/src/lib/api.ts),
  and [desktop/src/lib/storage.ts](../desktop/src/lib/storage.ts)
  so auth/bootstrap/updater noise is also quiet in normal usage.
- [web/layout.ts](../web/layout.ts)
  now uses an inline logger helper for embed/auth/app-load/runtime failure paths,
  with zero remaining direct `console.*` calls in the generated shell.
- CLI diagnostics in [cli/mod.ts](../cli/mod.ts)
  and [cli/bin/ultralight.js](../cli/bin/ultralight.js)
  are now separated from intentional command output, preserving stdout UX while
  routing actual failures through explicit stderr helpers and the shared
  CLI logger.

### PR5.7 Widget Runtime Consolidation

Status: `implemented locally`

Purpose:

- collapse duplicated widget discovery, cache, HTML fetch, bridge injection,
  and widget-open navigation into shared desktop runtime helpers

Expected files:

- [desktop/src/hooks/useWidgetInbox.ts](../desktop/src/hooks/useWidgetInbox.ts)
- [desktop/src/hooks/useInChatWidgets.ts](../desktop/src/hooks/useInChatWidgets.ts)
- [desktop/src/components/WidgetAppView.tsx](../desktop/src/components/WidgetAppView.tsx)
- [desktop/src/components/WidgetWindow.tsx](../desktop/src/components/WidgetWindow.tsx)
- [desktop/src/lib/widgetContracts.ts](../desktop/src/lib/widgetContracts.ts)
- likely new shared helpers under `desktop/src/lib/`

Acceptance:

- widget cache serialization format is defined in one place
- bridge SDK/script injection is defined in one place
- widget HTML fetching is defined in one place
- widget window/app view navigation rules are shared rather than duplicated

Verification:

- widget-related desktop tests
- targeted smoke on widget homescreen, inline widgets, and pop-out widgets

Risks:

- widget behavior is user-visible and stateful; consolidation should not change
  cache semantics or cross-window behavior by accident

Implemented in this tranche:

- shared widget runtime primitives now live in
  [desktop/src/lib/widgetRuntime.ts](../desktop/src/lib/widgetRuntime.ts),
  including the canonical widget cache format, shared HTML loading/parsing,
  shared `srcDoc` bridge injection, shared widget query-param helpers, and
  shared widget-to-widget target building.
- [desktop/src/hooks/useWidgetInbox.ts](../desktop/src/hooks/useWidgetInbox.ts)
  and [desktop/src/hooks/useInChatWidgets.ts](../desktop/src/hooks/useInChatWidgets.ts)
  now consume that shared runtime instead of each managing their own cache and
  fetch logic.
- [desktop/src/components/WidgetAppView.tsx](../desktop/src/components/WidgetAppView.tsx),
  [desktop/src/components/WidgetWindow.tsx](../desktop/src/components/WidgetWindow.tsx),
  and [desktop/src/components/InChatWidget.tsx](../desktop/src/components/InChatWidget.tsx)
  now use the same bridge injection path and the same widget-to-widget
  navigation rules.
- [desktop/src/components/MessageBubble.tsx](../desktop/src/components/MessageBubble.tsx)
  and [desktop/src/lib/multiWindow.ts](../desktop/src/lib/multiWindow.ts)
  were also aligned so inline widgets and pop-out windows use the same cache
  and query-param conventions.

### PR5.8 Desktop Async-State Consistency

Status: `implemented locally`

Purpose:

- make the core desktop Wave 5 surfaces use deliberate, reusable loading,
  empty, and error states rather than one-off copy and layouts

Expected files:

- [desktop/src/components/HomeView.tsx](../desktop/src/components/HomeView.tsx)
- [desktop/src/components/WidgetInbox.tsx](../desktop/src/components/WidgetInbox.tsx)
- [desktop/src/components/WidgetWindow.tsx](../desktop/src/components/WidgetWindow.tsx)
- [desktop/src/components/WidgetAppView.tsx](../desktop/src/components/WidgetAppView.tsx)
- [desktop/src/components/WebPanel.tsx](../desktop/src/components/WebPanel.tsx)
- [desktop/src/components/ExecutionWidget.tsx](../desktop/src/components/ExecutionWidget.tsx)
- shared UI state components/helpers as needed

Acceptance:

- prioritized desktop surfaces expose clear loading, empty, and retry/error
  states
- state copy is consistent in tone and does not feel temporary
- blank or silently-failing widget/dashboard states are removed

Verification:

- desktop typecheck
- focused component tests where they exist
- manual local smoke for widget and web-panel flows

Risks:

- shared async-state components can become visually generic if they ignore the
  existing desktop visual language

Implemented in this tranche:

- added the shared async-state surface in
  [desktop/src/components/DesktopAsyncState.tsx](../desktop/src/components/DesktopAsyncState.tsx)
  so desktop loading, empty, and error states now share one visual language,
  action layout, and compact-mode option instead of diverging per component.
- [desktop/src/components/WidgetInbox.tsx](../desktop/src/components/WidgetInbox.tsx)
  now shows explicit loading and empty states with consistent copy and a
  refresh action instead of leaving the widget area sparse or ambiguous.
- [desktop/src/components/WidgetWindow.tsx](../desktop/src/components/WidgetWindow.tsx)
  and [desktop/src/components/WidgetAppView.tsx](../desktop/src/components/WidgetAppView.tsx)
  now expose clear loading, no-HTML, fetch-error, and iframe-shell failure
  states, each with a retry path instead of silent widget failures.
- [desktop/src/components/WebPanel.tsx](../desktop/src/components/WebPanel.tsx)
  now uses the same async-state surface for secure-session bootstrap failures
  and embed load failures, with clearer user-facing copy and structured
  logging on the failure path.
- [desktop/src/components/ExecutionWidget.tsx](../desktop/src/components/ExecutionWidget.tsx)
  now uses the shared surface for plan loading, missing-plan recovery, and
  inline action failures, replacing one-off message blocks.
- [desktop/src/components/HomeView.tsx](../desktop/src/components/HomeView.tsx)
  now carries explicit loading and retry/close states while opening the
  full-screen widget overlay, so failed widget opens no longer degrade into a
  blank frame.

### PR5.9 Web Shell And Owner-Dashboard Async-State Consistency

Status: `implemented locally`

Purpose:

- bring the main web shell and owner-facing app dashboard tabs onto more
  consistent loading, empty, and error-state patterns

Expected files:

- [web/layout.ts](../web/layout.ts)
- [api/handlers/app.ts](../api/handlers/app.ts)

Acceptance:

- high-traffic web shell sections use consistent loading language and empty
  states
- app-owner tabs like health, permissions, revenue, marketplace, settings, and
  function/schema panes stop inventing one-off state patterns
- fallback messaging is honest and concise without prototype tone

Verification:

- targeted manual walkthrough of owner dashboard tabs and public app shell flows
- search for replaced loading/error snippets in `web/layout.ts`

Risks:

- `web/layout.ts` is still a large monolith, so this PR needs disciplined,
  pattern-based cleanup rather than accidental broad rewrites

Implemented in this tranche:

- added a shared web-shell async-state pattern in
  [web/layout.ts](../web/layout.ts)
  with reusable `renderShellState`, `renderSectionState`, and
  `renderTableState` helpers plus a matching `shell-state` visual language, so
  loading, empty, and error states now read consistently across the main shell.
- normalized the high-traffic web-shell browse surfaces in
  [web/layout.ts](../web/layout.ts),
  including marketplace search, shared apps, newly published, newly acquired,
  leaderboard, library-tab loads, and the main owned-app list.
- normalized the owner dashboard states in
  [web/layout.ts](../web/layout.ts)
  for documentation, health, recent calls, permissions, database, environment,
  revenue, usage logs, marketplace listing/bids, transactions, earnings, and
  payout history so those tabs no longer fall back to raw “Loading...” or
  “Failed to load.” strings.
- tightened the public app/settings shell in
  [api/handlers/app.ts](../api/handlers/app.ts)
  with a dedicated settings-state renderer, clearer empty/error/loading copy,
  and a more credible initial settings panel instead of bare placeholder text.
- cleaned the generated app dashboard shell in
  [api/handlers/app.ts](../api/handlers/app.ts)
  so the generic runtime dashboard now says “Loading app functions...” and the
  no-docs fallback reads like a maintained product surface.

### PR5.10 Active-Code Comment And Slop Cleanup

Status: `implemented locally`

Purpose:

- remove comments and inline text that describe in-motion replacement work,
  stale migration context, or low-signal AI-generated filler from active code

Expected files:

- [api/src/worker-entry.ts](../api/src/worker-entry.ts)
- [api/handlers/apps.ts](../api/handlers/apps.ts)
- [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
- [desktop/src/hooks/useWidgetInbox.ts](../desktop/src/hooks/useWidgetInbox.ts)
- [desktop/src/hooks/useInChatWidgets.ts](../desktop/src/hooks/useInChatWidgets.ts)
- any active generator/template surfaces still carrying stale “Phase” comments

Acceptance:

- active runtime code comments mostly explain constraints or invariants, not
  project-history narration
- obvious low-signal TODO/Phase/replacement comments are removed or replaced
  with concise useful comments
- historical design context remains in docs, not inline in hot-path code

Verification:

- repo search for targeted stale-comment phrases
- review touched files for comment density and usefulness

Risks:

- aggressive comment deletion can remove valuable context; the standard is
  “helpful to a new maintainer,” not “comment-free”

Implemented in this tranche:

- cleaned active runtime narration in
  [api/src/worker-entry.ts](../api/src/worker-entry.ts),
  [api/handlers/apps.ts](../api/handlers/apps.ts),
  [api/handlers/app.ts](../api/handlers/app.ts),
  [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts),
  [desktop/src/hooks/useWidgetInbox.ts](../desktop/src/hooks/useWidgetInbox.ts),
  and [desktop/src/hooks/useInChatWidgets.ts](../desktop/src/hooks/useInChatWidgets.ts)
  so hot-path comments explain current behavior or constraints instead of
  project-history narration.
- tightened generated scaffold language in
  [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts)
  so starter output now tells developers to implement the manifest-backed
  contract and redeploy, without prototype-style “starter response” wording.
- cleaned migration-facing copy in
  [api/handlers/app.ts](../api/handlers/app.ts)
  so the generic dashboard explains missing manifest-backed metadata more
  precisely without vague “legacy functions” phrasing.
- simplified the active generator surface in
  [api/services/docgen.ts](../api/services/docgen.ts)
  by removing section-banner and filler comments while keeping the explanatory
  comments that still help a maintainer understand non-obvious behavior.

### PR5.11 System-Agent Rename Bridge Removal

Status: `implemented locally`

Purpose:

- close the remaining Wave 5 compatibility bridge tied to the desktop system
  agent rename from `tool_publisher` to `tool_marketer`

Expected files:

- [desktop/src/App.tsx](../desktop/src/App.tsx)
- [desktop/src-tauri/src/db.rs](../desktop/src-tauri/src/db.rs)
- [desktop/src/lib/systemAgents.ts](../desktop/src/lib/systemAgents.ts)
- [docs/COMPATIBILITY_DEPRECATION_LEDGER.md](COMPATIBILITY_DEPRECATION_LEDGER.md)

Acceptance:

- the version-gated rename bridge is removed or fenced behind an explicit
  minimum-version decision
- orphaned `tool_publisher` / `tool_explorer` rows are no longer treated as a
  permanent compatibility burden

Verification:

- desktop migration tests if available
- local DB migration smoke for upgraded desktop state

Risks:

- this is version-sensitive; deleting it too early could strand older desktop
  installs or histories

Implemented in this tranche:

- moved the old `tool_publisher` -> `tool_marketer` cleanup out of
  [desktop/src/App.tsx](../desktop/src/App.tsx)
  and into a versioned local DB migration in
  [desktop/src-tauri/src/db.rs](../desktop/src-tauri/src/db.rs),
  so upgraded installs normalize once instead of carrying rename logic in the
  live React bootstrap path.
- the DB migration now renames legacy `tool_publisher` rows to
  `tool_marketer`, updates the legacy “Tool Publisher” label to “Tool Dealer,”
  preserves conversation history, and demotes `tool_explorer` rows into normal
  chat agents instead of leaving them as special-case orphaned system rows.
- [desktop/src/lib/systemAgents.ts](../desktop/src/lib/systemAgents.ts)
  now exports a canonical type guard so desktop provisioning only treats the
  current system-agent set as authoritative.
- added Rust DB migration tests that prove both the publisher rename and the
  explorer demotion paths behave correctly on upgraded local databases.

### PR5.12 Credibility Guardrails And Closeout

Status: `implemented locally`

Purpose:

- keep Wave 5 from regressing once the copy/logging/widget/UI cleanup lands

Expected files:

- [scripts/checks/run-guardrail-checks.mjs](../scripts/checks/run-guardrail-checks.mjs)
- [scripts/checks/guardrail-baseline.json](../scripts/checks/guardrail-baseline.json)
- `.github/workflows/*` as needed
- this roadmap and the launch scorecard

Acceptance:

- placeholder runtime baseline is updated to the reviewed post-cleanup state
- any new logging guardrail or allowlist is documented and enforced
- Wave 5 roadmap can move from “planned” to “implemented locally” truthfully

Verification:

- guardrail scripts
- targeted package typecheck/tests after the final cleanup

Risks:

- overfitting guardrails to a snapshot can create noisy CI unless the rules are
  specific to the credibility debt we actually care about

Implemented in this tranche:

- added a focused `guarded-direct-console` regression check in
  [scripts/checks/run-guardrail-checks.mjs](../scripts/checks/run-guardrail-checks.mjs)
  and committed the reviewed zero-findings baseline in
  [scripts/checks/guardrail-baseline.json](../scripts/checks/guardrail-baseline.json).
- documented the Wave 5 logging allowlist and guardrail-protected files in
  [docs/LOGGING_POLICY.md](LOGGING_POLICY.md)
  so future exceptions have to be explicit instead of drifting in silently.
- updated this roadmap plus the launch scorecard to reflect the post-Wave-5
  repo state rather than the earlier planned state.
- Wave 5 can now be described truthfully as `implemented locally`, with only
  the already-deferred human smoke/copy/release tasks left at the end of the
  wave.

## Manual Tasks Deferred To End Of Wave

Keep the following human-only tasks consolidated to the end, after the code PRs
land:

1. After enough desktop adoption, decide the minimum version / rollout floor
   for deleting the versioned local system-agent migration.
2. Run staging smoke for:
   - widget homescreen
   - inline tool widgets
   - pop-out widget windows
   - web owner dashboard tabs
   - desktop web panel auth and retry states
3. Run production smoke on the same product-facing surfaces after release.
4. Do one final product copy review of the user-visible replacement language in
   generated scaffolds and owner-facing warnings.

## Recommended Next Implementation Step

Start with `PR5.1` if the goal is to implement Wave 5 immediately, because the
known desktop compile debt will otherwise make the widget and UI PRs slower and
less trustworthy.
