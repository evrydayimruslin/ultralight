# Logging Policy

Last reviewed: `2026-04-21`

This is the Wave 5 logging contract for launch hardening. The goal is to keep
operational visibility while making product code read and behave like a
maintained platform instead of a prototype with ad hoc `console.*`.

## Canonical Helpers

Use the shared helpers for new product logging work:

- API/server:
  [api/services/logging.ts](../api/services/logging.ts)
- Desktop/web:
  [desktop/src/lib/logging.ts](../desktop/src/lib/logging.ts)
- CLI diagnostics:
  [cli/logging.ts](../cli/logging.ts)

These helpers provide:

- consistent scope-prefixed log lines
- structured context instead of free-form string concatenation
- redaction of known secret/auth/PII fields
- debug gating so verbose traces do not ship as normal product behavior

## Event Shape

Server logs should emit a stable structured record with:

- `scope`
- `level`
- `message`
- `context`
- `ts`

Desktop and CLI logs may render in a more human-readable format, but they
should still carry:

- a stable scope
- a short event message
- sanitized context for anything beyond a one-line diagnostic

## Redaction Rules

Never log raw values for:

- access tokens, refresh tokens, bridge tokens, share tokens, API keys
- secrets, passwords, service-role keys, BYOK credentials
- `Authorization` headers or cookie headers
- user email addresses or phone numbers

The shared helpers already redact common fields by key name. If a sensitive
value is stored under an unusual key, rename the field in the log context or
manually omit it before logging.

## Preferred Categories

Use stable scopes that match the subsystem:

- `AUTH`
- `AUTH-TRANSPORT`
- `APP-RUNTIME`
- `BILLING`
- `PERMISSIONS`
- `PUBLISH`
- `USAGE`
- `TELEMETRY`
- `PLATFORM-ALIAS`
- `CLI`

If a new scope is needed, keep it short, durable, and subsystem-oriented.

## Direct Console Allowlist

Direct `console.*` remains acceptable only in these categories:

- tests and test fixtures
- one-shot operator scripts under `scripts/`
- vendor/runtime harness code where the log surface is intentionally raw
- sandbox-captured user app logs
- human-facing CLI output that is intentionally part of the command result

For product code outside those categories, new logging should go through the
shared helpers.

## Guardrail-Protected Surfaces

Wave 5 now keeps the highest-value logging conversions pinned through
`guarded-direct-console` in
[scripts/checks/run-guardrail-checks.mjs](../scripts/checks/run-guardrail-checks.mjs).

Those guardrail-protected files are:

- [api/src/worker-entry.ts](../api/src/worker-entry.ts)
- [api/handlers/chat.ts](../api/handlers/chat.ts)
- [api/handlers/upload.ts](../api/handlers/upload.ts)
- [desktop/src/components/ChatView.tsx](../desktop/src/components/ChatView.tsx)
- [desktop/src/hooks/useWidgetInbox.ts](../desktop/src/hooks/useWidgetInbox.ts)
- [desktop/src/lib/agentRunner.ts](../desktop/src/lib/agentRunner.ts)
- [desktop/src/App.tsx](../desktop/src/App.tsx)
- [desktop/src/hooks/useDesktopUpdater.ts](../desktop/src/hooks/useDesktopUpdater.ts)
- [desktop/src/main.tsx](../desktop/src/main.tsx)
- [desktop/src/lib/api.ts](../desktop/src/lib/api.ts)
- [desktop/src/lib/storage.ts](../desktop/src/lib/storage.ts)
- [web/layout.ts](../web/layout.ts)

If one of those files truly needs a direct `console.*` call again, update this
policy and the guardrail in the same PR so the exception is explicit and
reviewed.

## Conversion Guidance

When converting an existing file:

1. keep the useful event boundary
2. replace free-form string concatenation with a short message plus context
3. redact or omit any secrets before they reach the helper
4. remove routine debug noise unless it is explicitly debug-gated
5. prefer one stable event per failure path over many breadcrumb logs

## Relationship To Failure Policy

This policy complements
[docs/ENGINEERING_FAILURE_POLICY.md](ENGINEERING_FAILURE_POLICY.md).

- Failure policy answers whether the request should continue.
- Logging policy answers how the failure should be surfaced to operators
  without leaking credentials or product-noise into user flows.
