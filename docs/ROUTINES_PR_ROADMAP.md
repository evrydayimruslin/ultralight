# Galactic Routines PR Roadmap

Routines let MCP developers compose ongoing business processes from any MCP
capabilities a user has approved. The platform owns durable scheduling, actor
auth, Light budgets, receipts, traces, retries, pause/kill, and Command state.

## Default Architecture Decisions

- The execution principal is always the user/account that approved the routine.
- MCP developers publish routine templates; Galactic runs routine instances.
- Downstream MCP access means approved routine capabilities, not silent access to
  every tool the user has ever installed.
- Routine authors may define customizable schedules, arguments/config,
  downstream functions, Light budgets, retry policy, and Command surfaces.
- Platform guardrails control minimum intervals, concurrency, max runtime,
  permissions, secrets, receipts, and traceability.
- Command gets platform-native monitoring cards by default; composer-provided
  widgets/cards are optional.

## PR 1: Routine Manifest Contract

Add `manifest.routines[]` so MCP developers can publish routine templates with
handler, default schedule, config schema, capability declarations, budget
defaults, approval policy, and Command surface bindings. Index templates so
Flash/codemode can discover them. No executor yet.

## PR 2: Routine Persistence

Add durable backend tables and services for user routine instances:
`user_routines`, `routine_capabilities`, `routine_runs`,
`routine_run_steps`, and `routine_dashboard_bindings`.

## PR 3: Routine Actor/Auth Policy

Add signed ephemeral routine-run credentials scoped to the approved user,
routine, app, function, and budget policy. Do not store or expose user API
tokens to composer MCPs.

## PR 4: `ul.routine` Platform Tool

Expose platform MCP actions: `templates`, `plan`, `create`, `list`, `get`,
`update`, `pause`, `resume`, `delete`, and `run_now`.

## PR 5: Durable Routine Executor

Add a Supabase lease-based scheduler in the backend worker. It claims due
routines, creates runs, invokes the root MCP handler, applies retries/backoff,
and updates `next_run_at`.

## PR 6: Trace And Billing Rollups

Thread `routine_id`, `routine_run_id`, and `trace_id` through MCP calls,
receipts, cloud usage, invocation telemetry, and run-step records so each
business outcome has a full cost and contribution trace.

## PR 7: Command Routine Monitoring

Add routine inventory/status APIs and Command cards for active routines, last
run, next run, failures, spend, pending approvals, and pause/resume controls.

## PR 8: Execution Surface Parity

Bring HTTP and `/api/run` execution up to MCP parity by passing inter-app call
context, app-call dependencies, worker secret, and user-scoped data resources.
