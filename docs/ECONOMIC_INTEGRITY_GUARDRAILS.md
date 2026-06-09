# Economic Integrity Guardrails

Last updated: `2026-06-08`

Active scope: launch economic integrity guardrails for `PR NS-1` and later.

This document is the launch source of truth for Light-moving code paths. Its
purpose is to keep every balance mutation, ledger write, receipt, and economic
RPC call visible before later PRs add idempotency, Cloudflare cost passthrough,
embedding productionization, and release automation.

## Source Of Truth

Money movement is database-authoritative. Application handlers and services may
call reviewed Supabase/Postgres RPCs, but they must not directly mutate user
balances or primary ledger state.

Direct REST writes to economic tables are allowed only when they are secondary
logs or receipts after the authoritative RPC has already succeeded. Those
writers must be documented here and allowlisted in
[`scripts/checks/run-guardrail-checks.mjs`](../scripts/checks/run-guardrail-checks.mjs).

New migrations that update protected economic state must also be reviewed and
allowlisted intentionally. A migration allowlist entry means "this migration was
reviewed as an economic-state migration", not "future migrations can copy this
pattern freely".

## Protected State

The guardrails protect these launch economic surfaces:

| Surface | Protected state | Rule |
| --- | --- | --- |
| User balances | `users.balance_light`, `users.deposit_balance_light`, `users.earned_balance_light` | Update only through approved RPCs. |
| Billing logs | `billing_transactions` | Secondary log only unless a dedicated RPC owns the operation. |
| Ledger entries | `light_ledger_entries` | Write through approved economic RPCs. |
| Transfers | `transfers` | Create through approved transfer RPCs. |
| Cloud usage | `cloud_usage_events`, `cloud_usage_holds` | Create, settle, debit, and release through cloud usage RPCs. |
| Skill pulls | `skill_pull_receipts` | Receipt rows follow an approved skill pull transfer path. |
| Embeddings | `embedding_generation_charges` | Charge through the embedding generation charge RPC. |

## Approved Mutation Map

| Operation | Authoritative path | Current application boundary | Notes |
| --- | --- | --- | --- |
| Spendable debit | `debit_spendable_light`, `debit_light` | Billing, chat, GPU, and launch services that call the RPC | Primary debit must fail closed. |
| Balance credit | `credit_balance`, `credit_deposit_light` | Admin and deposit handlers | Deposit/credit provenance must remain auditable. |
| Developer/customer transfer | `transfer_balance`, `transfer_light` | Runtime settlement, app calls, GPU billing, skill pulls | Used for paid function calls and monetized skill pulls. |
| Earnings conversion | `convert_earnings_to_deposit` | User and platform MCP handlers | Moves creator earnings into deposit balance. |
| Cloud usage hold | `create_cloud_usage_hold` | Cloud usage service | Reserves expected infrastructure cost before execution. |
| Cloud usage settlement | `settle_cloud_usage_hold`, `release_cloud_usage_hold` | Cloud usage service; scheduled stale-hold release through cloud usage reconciliation service | Settles actual cost or releases unused held Light. |
| Direct cloud debit | `debit_cloud_usage` | Cloud usage service | Used where a hold is not the correct shape. |
| Embedding generation charge | `record_embedding_generation_charge` | Embedding billing service | Publisher-funded platform embedding work. |
| Skill pull receipt | `transfer_light` plus `skill_pull_receipts` insert | Skill pulls service | Receipt insert is secondary until `PR NS-2` makes the operation fully idempotent. |
| Billing transaction rows | Direct REST insert after successful primary RPC | Chat, GPU, builder, and hosting billing services | Secondary log with reconciliation responsibility. |

## Approved Direct Application Edges

The guardrail runner currently allowlists these economic REST writers:

- [`api/services/chat-billing.ts`](../api/services/chat-billing.ts) for billing transaction rows after chat debit.
- [`api/services/gpu/billing.ts`](../api/services/gpu/billing.ts) for billing transaction rows after GPU debit or transfer.
- [`api/services/gpu/builder.ts`](../api/services/gpu/builder.ts) for billing transaction rows after builder debit.
- [`api/services/hosting-billing.ts`](../api/services/hosting-billing.ts) for billing transaction rows after cloud usage debit.
- [`api/services/skill-pulls.ts`](../api/services/skill-pulls.ts) for skill pull receipt rows after `transfer_light`.

The guardrail runner currently allowlists these economic RPC callers:

- [`api/handlers/admin.ts`](../api/handlers/admin.ts)
- [`api/handlers/app.ts`](../api/handlers/app.ts)
- [`api/handlers/platform-mcp.ts`](../api/handlers/platform-mcp.ts)
- [`api/handlers/user.ts`](../api/handlers/user.ts)
- [`api/runtime/sandbox.ts`](../api/runtime/sandbox.ts)
- [`api/services/chat-billing.ts`](../api/services/chat-billing.ts)
- [`api/services/cloud-usage.ts`](../api/services/cloud-usage.ts)
- [`api/services/embedding-billing.ts`](../api/services/embedding-billing.ts)
- [`api/services/execution-settlement.ts`](../api/services/execution-settlement.ts)
- [`api/services/gpu/billing.ts`](../api/services/gpu/billing.ts)
- [`api/services/gpu/builder.ts`](../api/services/gpu/builder.ts)
- [`api/services/skill-pulls.ts`](../api/services/skill-pulls.ts)

Adding a file to either list is a review event. The PR should say which
operation it owns, why the call site belongs there, how failures behave, and
what idempotency key or reconciliation path applies.

## Guardrail Check

Run the launch guardrails before and after economic changes:

```sh
node scripts/checks/run-guardrail-checks.mjs
```

The economic checks are:

- `economic-sql-mutations`: flags new protected SQL mutations outside reviewed
  economic migrations.
- `economic-direct-rest-mutations`: flags new direct REST writes to protected
  economic tables outside approved secondary writers.
- `economic-direct-rpc-mutations`: flags new Light-moving RPC call sites outside
  approved service boundaries.

If a new economic mutation is intentional, update this document and the
allowlist in the same PR. If the guardrail finds a mutation by surprise, move
the behavior behind an approved RPC or service boundary.

## Failure Policy

Primary money movement must fail closed. That includes balance debits, balance
credits, transfers, hold creation, hold settlement, hold release, embedding
charges, and any permission gate that decides whether a paid operation can
proceed.

Secondary logs and receipts may be best effort only when the authoritative
economic mutation already succeeded and the missing row can be reconciled. The
PR description must name the reconciliation owner or the follow-up PR that will
close the gap.

## Idempotency Layer

`PR NS-2` adds a central `economic_idempotency_keys` table. Economic RPCs claim
an operation key before moving Light and store the response after the mutation
commits. A retry with the same key returns the stored response instead of
debiting, transferring, reserving, settling, or charging again.

The idempotency layer currently covers:

- `debit_light`
- `transfer_light`
- `debit_cloud_usage`
- `create_cloud_usage_hold`
- `settle_cloud_usage_hold`
- `release_cloud_usage_hold`
- `create_app_call_runtime_cloud_hold`
- `record_skill_pull_receipt`
- `record_embedding_generation_charge`

Application services should pass stable operation keys when an operation can be
retried. Receipt IDs are preferred for function execution. Skill pulls accept an
explicit caller operation ID and otherwise mint a per-operation ID. Ambiguous
repeatable actions, such as paid page views, should only use an explicit
`Idempotency-Key`/`X-Idempotency-Key` header so a future intentional view is not
accidentally made free.

## Cloud Usage Reconciliation

`PR NS-3` adds scheduled stale-hold release and a read-only admin drift report.
The scheduled job does not introduce a new authoritative money path: it calls
`releaseCloudUsageHold()`, which in turn calls the reviewed idempotent
`release_cloud_usage_hold` RPC. The release idempotency key is
`expired_cloud_hold_release:<hold_id>`.

The admin endpoint
`GET /api/admin/cloud-usage/reconciliation?days=7&limit=100&scan_limit=10000`
compares cloud usage holds, cloud usage events, call receipts, and Light ledger
references. It is intentionally read-only so operators can identify drift
without mutating money outside the approved RPCs.

## Idempotency Candidates For PR NS-2

`PR NS-1` identified these stable operation-key candidates. `PR NS-2` wires the
launch-critical subset into RPCs, receipts, and constraints.

| Launch money path | Candidate stable key |
| --- | --- |
| Function runtime cloud hold | `execution_id` or `call_id` plus `user_id`, `app_id`, `version`, and function name. |
| Function settlement transfer | Runtime receipt ID, or `call_id` plus payer, developer, app version, function name, and monetization policy version. |
| Skill pull transfer and receipt | Receipt ID, or `user_id`, `app_id`, `version`, `skill_id`, and skill body/hash. |
| Embedding generation charge | `app_id`, `app_version`, `subject_type`, `subject_id`, embedding text hash, provider, and model. |
| Storage or hosting debit | Usage event ID, billing period, app/user resource ID, and metered unit type. |
| Cloud usage hold settlement | Hold ID plus settlement attempt ID. |
| Deposit or admin credit | Stripe event/payment ID or explicit admin operation ID. |
| Earnings conversion | User ID plus conversion request ID. |

## Known Gaps After PR NS-3

- Existing secondary billing transaction inserts still need stronger
  reconciliation visibility.
- Full local pgTAP validation of the NS-2 migration is pending a running Docker
  daemon for `./scripts/supabase/validate-local.sh`.
