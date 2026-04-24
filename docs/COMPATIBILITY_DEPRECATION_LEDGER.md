# Compatibility Deprecation Ledger

Last reviewed: `2026-04-21`

This document is the Wave 0 compatibility ledger. Its purpose is to stop legacy
behavior from being invisible.

Rules for adding entries:

- If a behavior exists only to preserve older clients, older stored data, or
  older deployment assumptions, it belongs here.
- If a path is not actually part of the live runtime but still creates
  operational confusion, track it as a legacy artifact.
- No compatibility bridge should remain ownerless, severity-free, or without a
  removal prerequisite.

## Status Legend

- `Active shim`: still participating in launch-relevant behavior today.
- `Migration bridge`: temporary compatibility path intended to disappear after
  data or client migration.
- `Legacy artifact`: not required for the live runtime, but still present in
  the repo and likely to confuse future work.
- `Archive candidate`: should be moved out of the active runtime tree or
  deleted once ownership confirms no live dependency remains.

## Telemetry Legend

- `Missing`: no direct usage counter or clear evidence path exists yet.
- `Logs only`: removal could be approximated from scattered logs, but not
  confidently.
- `Local only`: only desktop-local state is involved; repo telemetry is not a
  great fit.
- `Not needed`: this can be removed or archived by code review once ownership
  confirms it is not live.

## Active Compatibility Shims

| Shim / path | Status | Severity | Current purpose | Primary locations | Hot path | Telemetry | Removal prerequisite | Target wave | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Query-token auth for MCP, HTTP, embeds, and public page handoff | Removed in Wave 1 | Critical | Historical launch blocker now replaced by header auth, embed bridge tokens, and shared-page fragment bootstrap | `api/handlers/mcp.ts`, `api/handlers/http.ts`, `api/handlers/app.ts`, `api/handlers/platform-mcp.ts`, `desktop/src/components/WebPanel.tsx`, `web/layout.ts` | No | Guardrail + legacy logs | Keep `query-token-auth` at `0`, then delete residual migration-only cleanup code as follow-up. Canonical replacement is defined in `docs/AUTH_TRANSPORT_DECISION.md`. | Wave 1 | Auth & Identity |
| Legacy browser token migration into cookie sessions | Removed in Wave 4 | High | Historical browser bootstrap shim now deleted in favor of cookie sessions, the desktop embed bridge, and explicit per-app tab-local token entry where still intended | `web/layout.ts`, `api/handlers/auth.ts`, `api/handlers/developer.ts`, `api/handlers/app.ts` | No | Repo search + auth bootstrap tests | Keep browser auth on cookie sessions only and do not reintroduce localStorage refresh/token bootstrap. Canonical replacement is defined in `docs/AUTH_TRANSPORT_DECISION.md`. | Wave 4 | Auth & Identity |
| Desktop secure-storage migration from legacy localStorage token | Version-gated migration bridge | Medium | Preserves old desktop installs by copying `ul_token` from localStorage into secure storage one final time before a completion marker locks future startups onto secure storage only | `desktop/src/lib/storage.ts` | Some | Local only | A one-time `ul_auth_storage_migrated_v1` marker now exists locally; set a minimum desktop version / rollout floor, then remove the final legacy import branch | Wave 4 | Desktop & Web Shell |
| `skills_parsed` and `exports` fallback for tool discovery and schema display | Migration bridge | High | Live MCP runtime and draft publish now require manifest-backed contracts; new uploads and drafts auto-generate or normalize `manifest.json`, while legacy metadata remains only in owner-facing UI/reporting for already-stored apps | `api/services/app-contracts.ts`, `api/services/app-manifest-generation.ts`, `api/handlers/mcp.ts`, `api/handlers/app.ts`, `api/handlers/apps.ts`, `api/handlers/upload.ts`, `api/services/function-index.ts`, `api/services/upload-pipeline.ts`, `web/layout.ts`, `scripts/apps/audit-app-manifest-coverage.mjs` | MCP hot path: No. Owner-facing guidance: Some | `app_contract_resolution` logs + audit script | Run the manifest coverage audit against staging/production metadata, republish or backfill flagged stored apps, then remove the remaining legacy display-only fallback in UI surfaces | Wave 4 | Apps & Runtime |
| Supabase config fallback chain (`config_id` -> legacy app-level creds -> platform default) | Migration bridge | High | Legacy app-level and platform-default state still exists for migration, but launch-critical runtime paths now require canonical saved `supabase_config_id` resolution | `api/services/app-runtime-resources.ts`, `api/handlers/run.ts`, `api/handlers/http.ts`, `api/handlers/mcp.ts`, `api/handlers/apps.ts`, `api/handlers/user.ts`, `api/handlers/platform-mcp.ts`, `scripts/supabase/audit-app-supabase-configs.mjs` | No | Logs only | Run the Supabase audit against staging/production metadata, assign or recreate saved configs for every flagged app, then delete the remaining legacy fields and audit-only branches | Wave 4 | Apps & Runtime |
| Platform MCP backward-compat aliases (27 aliases plus `ul.execute`) | Active shim | Medium | Keeps older prompts and saved recipes working after tool namespace consolidation; first-party prompts, CLI, README, and app manifests now use canonical names, and removable aliases can now be disabled by config, but server dispatch remains live pending telemetry review | `api/handlers/platform-mcp.ts`, `api/services/platform-alias-telemetry.ts`, `docs/PLATFORM_MCP_ALIAS_DEPRECATION_MAP.md`, `cli/mod.ts`, `README.md` | Yes | Logs only | Review `platform_mcp_alias` logs, confirm the removable alias set stays quiet, stage `PLATFORM_MCP_DISABLED_ALIASES=removable`, and resolve the aliases that still lack a public canonical surface before deleting dispatch | Wave 4 | Developer Platform |
| Legacy widget function naming and dual ui/data fallback | Active shim | Medium | Supports older widget apps that expose one legacy function instead of new `_widget_*_ui` / `_widget_*_data` pairs | `desktop/src/hooks/useWidgetInbox.ts`, `desktop/src/lib/widgetContracts.ts`, `apps/mcps/email-ops/manifest.json` | Some | Local only | Use the local `ul_widget_contract_inventory_v1` inventory plus the widget contract guardrail to migrate or explicitly flag remaining legacy apps before deleting the fallback path | Wave 4 | Desktop & Web Shell |
| Legacy token hashing and `plaintext_token` schema fallback | Migration bridge | High | Runtime validation now requires canonical salted hashes; legacy rows can only self-heal from stored plaintext and are audited/remediated through the token compatibility script until old rows are backfilled or revoked | `api/services/tokens.ts`, `scripts/tokens/audit-api-token-compat.mjs`, `web/layout.ts` | Yes | Audit script | Run `scripts/tokens/audit-api-token-compat.mjs` against staging/production metadata, apply salt backfill for rows that still retain plaintext, revoke unrecoverable rows, then delete the remaining plaintext-assisted migration branch | Wave 4 | Auth & Identity |
| Legacy secret encryption / plaintext-row compatibility | Migration bridge | High | Runtime secret reads now assume canonical per-record encryption; legacy global-salt blobs and plaintext rows are migration-only data states surfaced by the audit/backfill tooling | `api/services/envvars.ts`, `api/handlers/oauth.ts`, `api/services/openrouter-keys.ts`, `api/services/api-key-crypto.ts`, `scripts/secrets/audit-secret-crypto-compat.mjs` | Yes | Audit script | Run `scripts/secrets/audit-secret-crypto-compat.mjs` against staging/production metadata, apply canonical backfill where possible, and rotate/delete unreadable rows before deleting the remaining migration helpers | Wave 4 | Auth & Identity |
| System agent local DB normalization (`tool_publisher` -> `tool_marketer`, `tool_explorer` demotion) | Versioned migration bridge | Low | Preserves local desktop conversation history while moving the rename cleanup out of React bootstrap and into a one-time DB migration | `desktop/src-tauri/src/db.rs`, `desktop/src/lib/systemAgents.ts` | No | Local only | After enough desktop adoption, set a removal floor for the versioned migration and then delete the legacy-row normalization block and tests | Wave 5 | Desktop & Web Shell |

## Legacy Artifacts And Archive Candidates

| Artifact | Status | Severity | Why it still exists | Primary locations | Telemetry | Removal prerequisite | Target wave | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Future Workers-for-Platforms sandbox tree | Archived artifact | Low | Preserved future runtime work is now out of the live `worker/` tree and kept only as reference material | `archive/experimental/future-wfp/`, `docs/CF-WORKERS-SETUP.md`, `docs/P1-SCALING-PLAN.md` | Not needed | Keep archived only; re-promote deliberately if this work becomes active again | Wave 4 | Internal Platform Ops |
| Root `migration-*.sql` family outside canonical Supabase migrations | Archived artifact | Low | Historical/manual migration files are now archived and the repo guardrail rejects new root-level migration files | `archive/root-migrations/`, `supabase/README.md`, `scripts/checks/run-guardrail-checks.mjs` | Not needed | Keep archived only; add canonical follow-up migrations under `supabase/migrations/` if any missing schema history must be revived | Wave 4 | Internal Platform Ops |
| Old Deno / DigitalOcean runtime path | Archived artifact | Medium | Earlier deployment story is preserved for historical reference but no longer lives in active runtime paths | `archive/legacy-runtime/api-main.ts`, `archive/legacy-runtime/do-app.yaml`, `archive/legacy-runtime/Dockerfile`, related migration docs | Not needed | Keep archived only; remove or rewrite any active docs that still imply it is current | Wave 4 | Internal Platform Ops |
| Backup source file in active API tree | Removed | Low | `api/main.ts.bak` was a direct leftover and is now deleted | git history, older review context only | Not needed | None | Wave 4 | Internal Platform Ops |
| Stray preview/test artifacts | Removed | Low | `desktop/public/onboarding-preview.html` and `test-parser.ts` were non-runtime leftovers and are now deleted | git history, older review context only | Not needed | None | Wave 4 | Desktop & Web Shell |

## Removal Order Guidance

1. Remove the P0 auth transport shims first: query-token auth and browser token
   migration.
2. Remove runtime contract shims next: `skills_parsed` fallback and Supabase
   config fallback.
3. Only after telemetry exists should the platform MCP aliases and legacy
   widget names be removed.
4. Data-format compatibility (`token_salt`, `plaintext_token`, legacy crypto
   blobs, plaintext secret rows) should be removed only after explicit backfill
   or forced rotation.
5. Archive candidates should not linger indefinitely just because they are not
   on the hot path.

## Immediate Follow-Ups For Wave 1 And Wave 4

- Add usage instrumentation around query-token auth on `/mcp/*`, `/http/*`,
  desktop embeds, and public page link generation.
- Run
  [scripts/supabase/audit-app-supabase-configs.mjs](../scripts/supabase/audit-app-supabase-configs.mjs)
  against staging and production metadata, then compare that report with the
  `app_supabase_resolution` runtime logs to identify any straggler apps before
  deleting the remaining migration-only code.
- Run
  [scripts/apps/audit-app-manifest-coverage.mjs](../scripts/apps/audit-app-manifest-coverage.mjs)
  against staging and production metadata, then compare the report with
  `app_contract_resolution` logs to identify which stored apps still need a
  manifest-backed republish before the remaining UI fallback is deleted.
- Run
  [scripts/secrets/audit-secret-crypto-compat.mjs](../scripts/secrets/audit-secret-crypto-compat.mjs)
  against staging and production metadata, then backfill recoverable legacy
  rows and rotate/delete any unreadable secret rows before removing the final
  migration-only helpers.
- Review `platform_mcp_alias` logs and the deprecation map before removing alias dispatch.
- Review the local `ul_widget_contract_inventory_v1` desktop inventory after a
  few staging sessions to confirm whether any non-repo apps still depend on the
  legacy single-function widget contract.
- Keep `_future-wfp/` and the old root migration family archived unless a
  future architecture decision explicitly re-promotes them.
