# Engineering Failure Policy

Last reviewed: `2026-04-20`

This is the Wave 0 failure-policy standard for launch hardening.

The goal is simple: if a failure can affect identity, money, permissions,
publishing, quota enforcement, or user-visible correctness, it should not be
hidden.

## Default Rule

Default to `fail closed` for any path that can do one of the following:

- establish or extend identity
- move, mint, debit, or reconcile money
- grant or revoke permissions
- publish or unpublish user-facing content or apps
- enforce quotas, rate limits, or usage accounting
- alter durable state in a way a user or operator would care about later

Default to `best effort` only when the failed work is clearly one of these:

- cleanup or teardown after the primary state change already succeeded
- telemetry, logging, indexing, or analytics
- derived/cache state that has an explicit reconciliation path

If a best-effort path exists, it must still emit visible logs unless it is
truly noise-level cleanup.

## Decision Table

| Category | Default behavior | Allowed fallback? | Minimum visibility |
| --- | --- | --- | --- |
| Auth and session establishment | Fail closed | No | Error log with auth context, user-facing 4xx/5xx |
| Billing, payouts, deposits, withdrawals | Fail closed | No for primary money movement; limited yes for secondary logging if reconciled | Error log plus operator-visible trace |
| Permissions, originality, publish state | Fail closed | No | Error log plus explicit request failure |
| Usage metering, rate limiting, quotas | Fail closed unless there is an explicit reconciliation design and bounded exposure | Only with written reconciliation owner | Error log with affected resource and drift risk |
| Cleanup / teardown | Best effort | Yes | Warn log unless obviously harmless |
| Telemetry / analytics / quality reporting | Best effort | Yes | Warn or error log when repeated/high-volume failures matter |
| Cache invalidation / search indexing / summaries | Best effort only if stale data is tolerable and rebuild exists | Yes | Warn log and documented rebuild path |

## What Is Not Allowed

- Silent catches around session establishment or identity bootstrap.
- Silent failure of billing clocks, quota counters, or other state that
  protects future charging or enforcement.
- Treating “service unavailable” in auth, billing, or rate limiting as a reason
  to continue as normal.
- Using telemetry-style fire-and-forget patterns for permission grants,
  publish gates, or money movement.
- “Best effort” as an unexamined default for any path in a critical subsystem.

## What Is Allowed

- Cleanup-only work after the main state mutation already succeeded.
- Telemetry-only reporting that does not change user-visible state.
- Derived or cached state updates when there is an explicit repair or
  reconciliation mechanism.
- One-time migration bridges, but only if they are tracked in
  [COMPATIBILITY_DEPRECATION_LEDGER.md](COMPATIBILITY_DEPRECATION_LEDGER.md).

## Repo-Native Examples

### Good: fail closed when controls are unavailable

- Provisional signup blocks when the IP-count RPC is unavailable or returns an
  invalid payload in
  [api/services/provisional.ts](../api/services/provisional.ts) around line 338.
  This is the right pattern for abuse-control dependencies.
- Chat rate limiting explicitly uses `mode: 'fail_closed'` and returns a 503 or
  429 when controls are unavailable in
  [api/handlers/chat.ts](../api/handlers/chat.ts) around line 37.
  This is the right pattern for paid usage gates.

### Good: best effort only for cleanup or telemetry

- Auth-user deletion during provisional cleanup is best effort but logs a
  warning in
  [api/services/provisional.ts](../api/services/provisional.ts) around line 364.
  That is acceptable because the primary flow has already decided to clean up.
- MCP call logging is fire-and-forget but still logs failures in
  [api/services/call-logger.ts](../api/services/call-logger.ts) around line 66.
  That is acceptable because it is telemetry, not authorization or billing.
- Platform shortcoming reports are intentionally non-blocking in
  [api/handlers/platform-mcp.ts](../api/handlers/platform-mcp.ts) around line 3219.
  That is acceptable only because they are product-improvement signals, not
  user-visible state.

### Conditional: acceptable only with explicit reconciliation

- Stripe webhook billing-transaction inserts are best effort after the primary
  balance credit succeeds in
  [api/handlers/user.ts](../api/handlers/user.ts) around line 321.
  This is acceptable only if the balance mutation itself is authoritative and
  missing ledger rows can be reconciled.
- Data-storage adjustment is documented as best effort with reconciliation in
  [api/services/data-quota.ts](../api/services/data-quota.ts) around line 121.
  This is the outer limit of where fail-open metering can be tolerated.

### Bad: currently hidden critical failures

- Session establishment swallows `ensureUserExists()` failure in
  [api/handlers/auth.ts](../api/handlers/auth.ts) around line 289.
  Identity bootstrap should not proceed if required user state may be missing.
- Hosting billing updates `hosting_last_billed_at` with silent `.catch(() => {})`
  in
  [api/services/hosting-billing.ts](../api/services/hosting-billing.ts) around line 243.
  Billing clocks are not telemetry.
- Worker-side D1 usage tracking is fire-and-forget with silent catch in
  [worker/src/index.ts](../worker/src/index.ts) around line 245.
  Usage accounting should not disappear silently without an explicit
  reconciliation contract.

## Logging Expectations

Use category-prefixed structured logs for critical failures:

- `[AUTH]` for session, token, login, refresh, logout, user bootstrap
- `[BILLING]` for deposits, debits, payouts, balances, billing clocks
- `[PERMISSIONS]` for grants, revocations, access-control decisions
- `[PUBLISH]` for visibility, originality, draft/publish transitions
- `[USAGE]` for quotas, metering, rate limits, usage sync
- `[CLEANUP]` for teardown-only best-effort work
- `[TELEMETRY]` for analytics, indexing, summaries, call logs

Each critical failure log should include the smallest useful durable context:

- user ID if available
- app ID if available
- route/tool name
- operation name
- whether the request was blocked or allowed

For the shared helper modules, redaction rules, and the direct-console
allowlist, use
[docs/LOGGING_POLICY.md](LOGGING_POLICY.md).

## PR Requirements For Hardening Work

Any PR that changes failure behavior in auth, billing, permissions, publish, or
usage paths should say all of the following in its description:

1. Old behavior
2. New behavior
3. Why fail-open or fail-closed is correct here
4. What operators can observe if the dependency fails
5. Whether any reconciliation or retry path exists

## Short Version

If a failure changes who is allowed in, what gets charged, what gets published,
or what gets enforced, block the request and surface the problem.

If a failure only affects cleanup, telemetry, or a rebuildable derived view,
best-effort is acceptable, but it should still be visible to operators.
