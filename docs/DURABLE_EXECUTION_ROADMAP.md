# Durable Execution & Launch Streamlining — PR Roadmap

Status: **planned** (decision record; supersedes the neutralized async-promotion design).
Date: 2026-06-11. Inputs: the 5-report CF architecture audit (2026-06-11, memory:
`cf-architecture-audit`) and a verified CF-facts + repo-feasibility pass (doc links inline).

## The decision

Adopt **Cloudflare Queues** as the durable-execution primitive for (a) long-running
function executions and (b) event-bus fan-out. Rationale over alternatives:

- The original in-request async promotion was correctly abandoned: `ctx.waitUntil`
  caps post-response work at ~30s and Dynamic Worker sub-isolates do not outlive the
  parent response (`api/handlers/mcp.ts:2471-2474`). **A queue consumer has no
  response boundary** — it awaits the execution, then acks. The constraint that
  killed v1 does not exist there.
- Queue consumers get **15 min wall-clock per batch**, auto-scale to **250 concurrent
  invocations**, with per-message retry + Dead Letter Queues, and the consumer can be
  the SAME worker script (all bindings present).
  [limits](https://developers.cloudflare.com/queues/platform/limits/),
  [concurrency](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/),
  [get-started](https://developers.cloudflare.com/queues/get-started/)
- Pricing is noise: ~3 ops/message, $0.40/M ops after 1M/mo included.
  [pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- **Workflows** (GA) is the upgrade path for >15-min jobs, multi-step checkpointing,
  sleeps, and human-in-the-loop waits — not needed for v1; revisit when a real use
  case exceeds one consumer invocation.
- Delivery is **at-least-once** — idempotency comes from the `async_jobs` row
  (optimistic `queued → running` claim), mirroring the event bus's delivery-row claim.

**Core design rule: async is decided at dispatch time, never mid-flight.** A
mid-execution handoff would require re-running the function elsewhere — functions are
not idempotent; that is a double-side-effect/double-billing trap. Functions declare
`execution: { class: "async" }` in the manifest (and/or the caller opts in); those go
straight to the queue and return the existing `{ _async, job_id }` envelope in
milliseconds. Sync stays the default for the ≤60s majority — holding the connection
is free (duration unbilled; awaiting fetch = 0 CPU).

Verified feasibility anchors (repo):
- Non-HTTP execution proof: `dispatchPendingEvents` (cron) → `executeEventDelivery`
  (mcp.ts:2934) → full pipeline. Queue handler needs the same 2-line bootstrap
  (`globalThis.__env/__ctx`, worker-entry.ts:59-60 = :147-148).
- Nothing on the execution path reads a live `Request`; sandbox loopback URL comes
  from `BASE_URL` env, not the request.
- `timeoutMs` is per-call parameterizable (mcp.ts:2458 → dynamic-sandbox.ts:513);
  consumer passes an extended budget (v1 cap: 300s) — also into
  `preflightRuntimeCloudHold` so hold sizing matches.
- `meta.authToken` must NOT be persisted/queued (user bearer, ~1h). Queued executions
  therefore cannot make as-the-user `ul.call`s — same rule as event deliveries.
  Grant-gated cross-Agent calls are unaffected (caller token minted fresh in consumer).
- One empirical check early in PR 3: `ctx.exports` availability inside `queue()` is
  undocumented (proven in `scheduled()`); smoke it first on staging.

---

## PR 1 — Failure honesty & billing correctness  (size: S-M; pre-req for all)

Fixes the audit's correctness cluster. No schema changes.

1. **Abort billing leak**: `AIBinding` debits per provider call but the abort path
   reports `aiCostLight: 0` → receipts under-report and `recordGrantSpend` gets 0
   (P5 cap leak). Fix: request-scoped spend accumulator in the main isolate keyed by
   `executionId` (thread id through `AIBindingProps`); settlement reads the
   accumulator on abort instead of the sandbox-reported value.
   (ai-binding.ts:166-201, mcp.ts:2727-2733, dynamic-sandbox.ts:549-561)
2. **Event-delivery failure masking**: `executeEventDelivery` only checks JSON-RPC
   `body.error`; execution failures are `isError: true` *results* and record
   `delivered`. Detect tool-level errors → `failed` (restores the 4.5 rollup
   guarantee). (mcp.ts:3000-3013, agent-events.ts:296-302)
3. **Job rows that lie**: `completeJob` writes `completed` on `success:false`
   (async-jobs.ts:127); `ul.job` never surfaces `job.error`. Fix both.
4. **Provider-fetch hardening**: AbortSignal timeout (~90s) on inference fetches;
   clamp `max_tokens` (platform ceiling). (ai-binding.ts:122-137,133)

Acceptance: aborted execution → receipt carries real AI spend + grant spend recorded;
failed delivery rows show `failed`; `ul.job` exposes errors; hung provider times out.

## PR 2 — Call-path hygiene & dead-code removal  (size: S-M)

1. **SELF-bind the internal loopbacks** (kills the prod error-1042 risk + duplicated
   re-auth): `ul.call` (platform-mcp.ts:4583), routine executor
   (routine-executor.ts:668). The sandbox already does this (dynamic-sandbox.ts:230).
2. **Delete the dead user-cron system**: unmounted handler, 401-on-execute, R2-blob
   races; remove `checkUserCronJobs` from `runMinuteJobs`. Routines are the single
   scheduling story. (handlers/cron.ts, services/cron.ts, worker-entry.ts:212)
3. **Chokepoint dead weight**: remove the unused per-call R2 entry-code fetch
   (mcp.ts:2326-2356; the sandbox executes only the KV bundle) and fix/remove the
   `CodeCache` (`DEFAULT_TTL_MS = 0` contradicts its own log; codecache.ts:13,129).

Acceptance: gates green; staging smoke proves `ul.call`/routines over SELF.

## PR 3 — Queues foundation: durable async execution  (size: L; the headline)

1. **Wrangler**: `[[queues.producers]]` `EXEC_QUEUE` + `[[queues.consumers]]` (same
   script), `max_retries 3`, DLQ `exec-dlq`, small batch size (5-10).
2. **Migration** (`async_jobs`): add `args jsonb`, `caller_app_id`, `caller_grant_id`,
   `hop`, `started_at`; allow `status='queued'`; re-key `cleanupStaleJobs` off
   `started_at` and exempt `queued` (today's 3-min cutoff would kill queued jobs;
   async-jobs.ts:24,202-227). Remove the per-isolate `canAcceptAsyncJob` counter
   (queue `max_concurrency` replaces it).
3. **Manifest/contracts**: `ManifestFunction.execution?: { class?: 'sync'|'async';
   timeout_ms?: number }` + validation (manifest.ts:113-120, validator ~2396-2429).
4. **Dispatch branch** in `executeAppFunction` after the GPU early-return
   (mcp.ts:2301-2315), before expensive setup: async-class (or caller opt-in) →
   `createJob(status: queued, args, caller attribution)` → `EXEC_QUEUE.send({jobId})`
   → return the existing envelope (mcp.ts:2856-2875 shape). Enqueue happens INSTEAD
   of starting execution — never both.
5. **Consumer** (`queue()` in worker-entry, 2-line bootstrap): claim job
   (`queued→running` optimistic PATCH = idempotency vs at-least-once), re-fetch
   app/user, rebuild caller context from persisted scalars (event-bus pattern,
   mcp.ts:2966-2983), run the FULL pipeline (preflight → sandbox with extended
   `timeoutMs` ≤300s → settlement) in-consumer, `completeJob`/`failJob`,
   `msg.ack()`/`msg.retry({delaySeconds})` by `msg.attempts`. Insufficient balance =
   failed job (pattern at mcp.ts:2829-2836).
6. **Surfaces**: facade run + FE run panel pass the envelope through with a simple
   poll; `ul.job` already works. Delete the dead `ASYNC_PROMOTION_MS` race.
7. **First commit on this PR**: staging smoke proving `ctx.exports`/`LOADER` resolve
   inside `queue()` (expected yes; undocumented).

Acceptance: a declared-async function running 3+ min of inference completes; job polls
`completed` with the real result; receipts/caps/attribution settle; DLQ catches
poison messages; sync paths byte-identical.

**Landed decisions (review-driven, 2026-06-11):**
- `max_batch_size = 1`, not 5-10: messages process serially and each job may hold
  its full 300s budget — batching stacks budgets past the consumer's 15-min wall
  and kills healthy claimed executions. Throughput comes from Queues' consumer
  auto-scaling, not batching.
- Async dispatch is gated to callers that can actually poll: `routine_actor` and
  `sandbox_actor` calls always run synchronously (routine retry machinery would
  enqueue duplicate executions; sandbox code can't reach ul.job).
- `queue.send()` failure does NOT fall straight back to sync (a throw doesn't
  prove non-delivery): the dispatcher reclaims the row through the same
  `status=eq.queued` filter the consumer claims through, and only runs sync if
  it wins.
- Cross-Agent jobs re-check the grant is still active at execution time
  (revocation in the dispatch→claim gap is honored).
- Accepted risks (LOW, revisit post-launch): `_async: true` opt-in grants the
  300s budget to functions whose owners never declared async (balance-gated,
  grant-capped cross-agent); a queued row that out-lives the 60-min sweep due
  to a real backlog fails honestly rather than executing late.

## PR 4 — Event bus on Queues  (size: M)

1. Emit endpoint additionally enqueues `{eventId}`; consumer performs the fan-out
   (per-event message; per-delivery claim rows keep at-most-once exactly as today).
2. Minute-cron dispatch demoted to sweeper (recovers stuck/lease-expired events) —
   removes the 15-min-wall blast radius and the lease==delivery-time overlap.
3. Queue retries apply only to infra failures BEFORE the delivery-row claim;
   handler failures stay at-most-once (no blind re-run of non-idempotent handlers).
4. Optional (pull from 4.5 followups): per-user emit rate limit.

Acceptance: 100-subscriber fan-out runs outside the cron tick with concurrency;
sibling minute jobs unaffected by slow handlers; failures visible as `failed` (PR 1).

## PR 5 — Hot-path streamlining  (size: M)

From the cost audit (~10-13 serial Supabase RTs per call today):
1. Cache `getBillingConfig` (60s in-isolate + KV) — 1 RT off every call.
2. Collapse the auth chain: dedupe `getUserTier`/`getUser` double-read; move
   `ensureUserExists` to session exchange; short-TTL (≤60s) token-verdict cache —
   2-3 serial RTs off every authenticated request.
3. Debounce `rebuildEntityIndex` (per-user KV timestamp, ≥5 min; today it fans out
   after EVERY successful call) and batch `debitCloudOperation` metering (today 2
   serial RTs per `ultralight.store/load`).
4. Tenant isolation: pass `{ cpuMs, subRequests }` to `loader.load()` so tenant code
   stops inheriting the full 30s CPU / 10k subrequest budget.

Acceptance: chokepoint RT count measured before/after (dev counter); all gates green.

## PR 6 — Launch ops  (size: process + smoke)

The readiness-register gate, unchanged in substance: git remote → `main` → CI deploy
with environments/secrets (`AGENT_CALLER_SECRET`, `WORKER_SECRET`, queue bindings;
update `.dev.vars.example` + runbook); staging deploy + the full smoke list (now
including: queue-consumer execution, async envelope → poll roundtrip, SELF loopbacks,
Stripe test-mode topup → webhook → balance, session refresh in a real browser,
two-agent wiring + emit→delivery); Terms/Privacy page (the topup checkbox references
it); starter-credit decision; Supabase prod redirect URLs; release packet recording
accepted risks.

---

## Sequencing & sizing

Order: **1 → 2 → 3 → 4 → 5 → 6**, where 6 overlaps 4-5 (ops work parallelizes).
In session-phase units (one phase ≈ one 4a/4b-style implement+review+commit cycle):
PR1 ≈ 0.5, PR2 ≈ 0.5, PR3 ≈ 1.5 (schema + dispatch + consumer + surfaces + review),
PR4 ≈ 0.75, PR5 ≈ 0.75, PR6 ≈ smoke-day. Total ≈ 4-5 phases of focused work.

Minimum launchable cut if speed dominates: **1 + 2 + 6** (correctness + prod
de-risking + ops gate) ships a sound ≤120s-execution platform; 3-4 then land as the
first fast-follows. Recommended: land 3 before announcing — "agents that run real
inference jobs" is the headline capability and the migration is additive.

## What this roadmap deliberately does NOT cover (tracked elsewhere)

Post-launch register items: operator dashboards/alerts over failed jobs+deliveries
(minimal admin read endpoint can ride PR 4), codemode metering economics, at-least-once
event delivery with idempotent settlement, the reasoning-journal product feature
(receipt-linked prompt log at the AIBinding chokepoint), webhook `secret` auth mode,
event reply-channel (`correlation_id`), GPU grant-cap gate before enabling GPU,
Phase 2/3 alias removals, Workflows adoption for >15-min jobs.
