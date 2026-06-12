// Cross-Agent pub/sub event bus (Phase 4.5 / P5).
//
// An Agent emits a topic (ultralight.emit); the dispatcher fans the event out to
// every Agent the user wired a mode='subscribe' grant for, invoking the
// subscriber's handler. Emitting is unprivileged; RECEIVING is grant-gated.
// Delivery is async — emit inserts the event row AND enqueues {eventId} to
// EVENT_QUEUE; the queue consumer performs the fan-out with bounded
// concurrency (PR4). The minute cron is demoted to a recovery sweeper for
// stuck events (emit-time send failures, lost messages, expired leases).
// Delivery is billed to the user and capped by the subscribe grant's monthly
// cap. Cascades are bounded by the caller-context hop ceiling.
// See docs/LAUNCH_PIVOT_DECISIONS.md.

import { getEnv, getEventQueue } from "../lib/env.ts";
import {
  type AgentEvent,
  MAX_AGENT_CALL_HOP_DEPTH,
  MAX_EVENT_DELIVERY_ATTEMPTS,
  MAX_EVENT_FANOUT,
} from "../../shared/contracts/agent-grants.ts";
import { resolveSubscribeGrant, resolveSubscribers } from "./agent-grants.ts";

interface DbConfig {
  baseUrl: string;
  headers: HeadersInit;
}

function getDbConfig(): DbConfig | null {
  const baseUrl = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !key) return null;
  return {
    baseUrl,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

interface EventRow {
  id: string;
  user_id: string;
  emitter_app_id: string;
  topic: string;
  payload: Record<string, unknown> | null;
  status: string;
  attempts: number;
  emit_hop: number;
  created_at: string;
  dispatched_at: string | null;
}

const MAX_TOPIC_LENGTH = 200;
// The lease must outlive a full consumer PASS (waves of deliveries up to the
// soft deadline), not a single delivery — the old 120s lease equalled the max
// single-delivery time, so an in-progress fan-out could be re-claimed
// mid-flight by the next tick.
const LEASE_SECONDS = 900;
// Fan-out runs in concurrent waves: high enough to keep a big fan-out inside
// the consumer's wall budget, low enough to respect the 6-simultaneous-
// connection limit per invocation.
const EVENT_DELIVERY_CONCURRENCY = 5;
// Per-invocation budget: each delivery costs ~15-20 subrequests through the
// full execution pipeline, and an invocation gets 1000 — cap the pass and
// continue in a fresh invocation (re-enqueue) rather than starving.
const MAX_DELIVERIES_PER_PASS = 40;
// Stop launching new waves past this elapsed time so the invocation settles
// well inside the consumer's 15-min wall even with worst-case 120s handlers.
const SOFT_DEADLINE_MS = 10 * 60_000;
// The sweeper ignores pending rows younger than this: the queue path delivers
// in seconds, and sweeping fresh rows would race the consumer's claim every
// tick. Applies only when EVENT_QUEUE is bound.
const SWEEP_GRACE_MS = 2 * 60_000;
// Bound the stored payload: every event is duplicated into the delivery path
// for up to MAX_EVENT_FANOUT subscribers, so an unbounded blob is a storage +
// fan-out amplification vector.
const MAX_PAYLOAD_BYTES = 32 * 1024;

function normalizeTopic(value: unknown): string {
  const topic = typeof value === "string" ? value.trim() : "";
  if (!topic) throw new Error("topic is required");
  if (topic.length > MAX_TOPIC_LENGTH) {
    throw new Error(`topic must be ${MAX_TOPIC_LENGTH} characters or less`);
  }
  return topic;
}

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (JSON.stringify(value).length > MAX_PAYLOAD_BYTES) {
    throw new Error(`event payload must be ${MAX_PAYLOAD_BYTES} bytes or less`);
  }
  return value as Record<string, unknown>;
}

// ── Emit ─────────────────────────────────────────────────────────────────

// Enqueue an event. Identity (emitterAppId, userId, emitHop) comes from the
// VERIFIED caller-context token at the internal emit endpoint — never from
// untrusted sandbox-supplied values. Rejects an emit beyond the hop ceiling so
// a reactive cascade (handler emits → delivery → handler emits …) terminates.
export async function emitEvent(input: {
  userId: string;
  emitterAppId: string;
  topic: string;
  payload?: Record<string, unknown>;
  emitHop: number;
}): Promise<{
  eventId: string | null;
  rejected?: "hop_exceeded" | "not_configured";
}> {
  const topic = normalizeTopic(input.topic);
  const payload = normalizePayload(input.payload);
  if (input.emitHop > MAX_AGENT_CALL_HOP_DEPTH) {
    return { eventId: null, rejected: "hop_exceeded" };
  }
  const db = getDbConfig();
  // A dropped emit must NOT report success — surface it so the caller's `ok`
  // reflects that nothing was enqueued.
  if (!db) return { eventId: null, rejected: "not_configured" };

  const response = await fetch(`${db.baseUrl}/rest/v1/agent_events`, {
    method: "POST",
    headers: { ...db.headers, Prefer: "return=representation" },
    body: JSON.stringify([{
      user_id: input.userId,
      emitter_app_id: input.emitterAppId,
      topic,
      payload,
      status: "pending",
      emit_hop: Math.max(1, Math.floor(input.emitHop)),
    }]),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail ? `Failed to enqueue event: ${detail}` : "Failed to enqueue event");
  }
  const rows = await response.json().catch(() => []);
  const eventId = Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;

  // Fast path: hand the event to the queue consumer. Best-effort — a failed
  // send leaves the row 'pending' and the cron sweeper re-enqueues it within
  // a couple of minutes, so emit never fails on queue trouble.
  if (eventId) {
    const queue = getEventQueue();
    if (queue) {
      await queue.send({ eventId }).catch((err) => {
        console.warn(
          "[AGENT-EVENTS] EVENT_QUEUE send failed; sweeper will recover:",
          err,
        );
      });
    }
  }
  return { eventId };
}

function mapEvent(row: EventRow): AgentEvent {
  return {
    id: row.id,
    userId: row.user_id,
    emitterAppId: row.emitter_app_id,
    topic: row.topic,
    payload: (row.payload && typeof row.payload === "object") ? row.payload : {},
    status: (["pending", "delivering", "delivered", "failed"].includes(row.status)
      ? row.status
      : "pending") as AgentEvent["status"],
    attempts: row.attempts ?? 0,
    emitHop: row.emit_hop ?? 1,
    createdAt: row.created_at,
    dispatchedAt: row.dispatched_at,
  };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

interface EventDispatchResult {
  scanned: number;
  delivered: number;
  failed: number;
  denied: number;
}

/**
 * Optimistically claim an event for dispatch (pending/expired-delivering →
 * delivering with a fresh lease). Returns the claimed event, or null when
 * another consumer/sweeper already owns it — the at-most-once guard against
 * the queue's at-least-once delivery. Throws on infra failure (nothing has
 * executed; the queue consumer may retry the message).
 */
export async function claimEventById(
  eventId: string,
  nowMs: number,
): Promise<AgentEvent | null> {
  const db = getDbConfig();
  if (!db) return null;

  // Read first (PostgREST cannot increment in a PATCH); the claim itself is
  // race-safe regardless — two claimers PATCH through the same status filter
  // and exactly one matches the row.
  const readResp = await fetch(
    `${db.baseUrl}/rest/v1/agent_events?id=eq.${eventId}&select=*&limit=1`,
    { headers: db.headers },
  );
  if (!readResp.ok) {
    const detail = await readResp.text().catch(() => "");
    throw new Error(`Failed to read event ${eventId}: ${detail}`);
  }
  const readRows = await readResp.json().catch(() => []) as EventRow[];
  const row = Array.isArray(readRows) ? readRows[0] : undefined;
  if (!row) return null;

  const nowIso = new Date(nowMs).toISOString();
  const leaseUntil = new Date(nowMs + LEASE_SECONDS * 1000).toISOString();
  const claim = await fetch(
    `${db.baseUrl}/rest/v1/agent_events?id=eq.${eventId}` +
      `&or=(status.eq.pending,and(status.eq.delivering,lease_until.lt.${nowIso}))`,
    {
      method: "PATCH",
      headers: { ...db.headers, Prefer: "return=representation" },
      body: JSON.stringify({
        status: "delivering",
        lease_until: leaseUntil,
        // attempts counts dispatch PASSES (claims), not deliveries.
        attempts: (row.attempts ?? 0) + 1,
      }),
    },
  );
  if (!claim.ok) {
    const detail = await claim.text().catch(() => "");
    throw new Error(`Failed to claim event ${eventId}: ${detail}`);
  }
  const claimed = await claim.json().catch(() => []);
  if (!Array.isArray(claimed) || claimed.length === 0) return null;
  return mapEvent(claimed[0] as EventRow);
}

/**
 * Fan an already-claimed event out to its subscribers and settle the event
 * row. Never re-runs a delivered/failed/denied delivery (the delivery-row
 * claim is per-subscriber at-most-once). Runs deliveries in bounded
 * concurrent waves; a pass that hits the per-invocation budget patches the
 * event back to 'pending' and re-enqueues it so a fresh invocation finishes
 * the remaining subscribers.
 */
export async function dispatchClaimedEvent(
  event: AgentEvent,
  nowMs: number,
): Promise<{ delivered: number; failed: number; denied: number }> {
  const db = getDbConfig();
  if (!db) return { delivered: 0, failed: 0, denied: 0 };
  try {
    return await runFanOut(db, event, nowMs);
  } catch (err) {
    // A throw here is a FAN-OUT-level failure (e.g. resolving subscribers
    // errored) — distinct from an individual delivery failing, which is
    // recorded per-row without throwing. Retry the whole event (back to
    // pending → re-dispatched) up to the attempt ceiling, then give up.
    console.warn("[AGENT-EVENTS] Event dispatch error:", err);
    const finalFail = event.attempts >= MAX_EVENT_DELIVERY_ATTEMPTS;
    await patchEvent(db, event.id, {
      status: finalFail ? "failed" : "pending",
      lease_until: null,
      last_error: err instanceof Error ? err.message : String(err),
    });
    if (!finalFail) await requeueEvent(event.id);
    return { delivered: 0, failed: 0, denied: 0 };
  }
}

type DeliveryOutcome =
  | "delivered"
  | "failed"
  | "denied"
  | "already" // a prior pass owns this (event, grant) — at-most-once skip
  | "retryable"; // pre-claim infra failure — safe to attempt on a later pass

async function runFanOut(
  db: DbConfig,
  event: AgentEvent,
  nowMs: number,
): Promise<{ delivered: number; failed: number; denied: number }> {
  let delivered = 0;
  let failed = 0;
  let denied = 0;

  const subscribers = (await resolveSubscribers({
    userId: event.userId,
    emitterAppId: event.emitterAppId,
    topic: event.topic,
  })).slice(0, MAX_EVENT_FANOUT);

  const passStartMs = Date.now();
  let index = 0;
  let attempted = 0;
  let incomplete = false;

  while (index < subscribers.length) {
    if (
      attempted >= MAX_DELIVERIES_PER_PASS ||
      Date.now() - passStartMs > SOFT_DEADLINE_MS
    ) {
      incomplete = true;
      break;
    }
    const wave = subscribers.slice(index, index + EVENT_DELIVERY_CONCURRENCY);
    index += wave.length;
    const outcomes = await Promise.all(
      wave.map((grant) => deliverToSubscriber(db, event, grant, nowMs)),
    );
    for (const outcome of outcomes) {
      // Only outcomes that ran the expensive path consume the pass budget.
      // An "already" skip (a prior pass owns the delivery row) costs ~one
      // subrequest — charging it would make continuation passes re-walk the
      // delivered prefix, burn the whole budget on skips, and strand every
      // subscriber past the first window forever.
      if (outcome === "delivered") {
        delivered++;
        attempted++;
      } else if (outcome === "failed") {
        failed++;
        attempted++;
      } else if (outcome === "denied") {
        denied++;
        attempted++;
      } // "retryable": the subscriber was never claimed — finish the pass and
      // let a later pass give it its one attempt.
      else if (outcome === "retryable") incomplete = true;
    }
  }

  if (incomplete) {
    // Budget cut or unclaimed stragglers. Hand the remainder to a fresh
    // invocation; terminal delivery rows make the next pass idempotent.
    if (event.attempts >= MAX_EVENT_DELIVERY_ATTEMPTS) {
      await patchEvent(db, event.id, {
        status: "failed",
        lease_until: null,
        last_error:
          `fan-out incomplete after ${event.attempts} passes (${delivered} delivered, ${failed} failed, ${denied} denied this pass)`,
        dispatched_at: new Date(nowMs).toISOString(),
      });
    } else {
      await patchEvent(db, event.id, {
        status: "pending",
        lease_until: null,
      });
      await requeueEvent(event.id);
    }
    return { delivered, failed, denied };
  }

  // Roll the per-subscriber outcomes up into the event's terminal status.
  //
  // Delivery is AT-MOST-ONCE: claimDelivery's unique (event, grant) row means a
  // given subscriber is invoked at most once per event, and we deliberately do
  // NOT auto-retry a `failed` delivery — the handler may have run and settled
  // before erroring, so a blind retry could double-bill or double-act. A failure
  // is recorded on its delivery row and surfaced here as a `failed` event (with
  // last_error), so it is queryable rather than silently swallowed.
  //
  // A continuation pass only counts ITS deliveries, so the terminal status
  // also checks the rows for failures recorded by earlier passes — an event
  // must never read 'delivered' when one of its deliveries failed.
  const crossPassFailed = failed === 0 && event.attempts > 1
    ? await hasFailedDeliveries(db, event.id)
    : false;
  const anyFailed = failed > 0 || crossPassFailed;
  const total = delivered + failed + denied;
  await patchEvent(db, event.id, {
    status: anyFailed ? "failed" : "delivered",
    lease_until: null,
    last_error: failed > 0
      ? `${failed} of ${total} deliveries failed${
        event.attempts > 1 ? " in the final pass" : ""
      }`
      : crossPassFailed
      ? "one or more deliveries failed in an earlier pass"
      : null,
    dispatched_at: new Date(nowMs).toISOString(),
  });
  return { delivered, failed, denied };
}

async function deliverToSubscriber(
  db: DbConfig,
  event: AgentEvent,
  grant: { id: string; targetAppId: string; targetFunction: string },
  nowMs: number,
): Promise<DeliveryOutcome> {
  // Idempotent per (event, grant): create a delivery row, or skip if one
  // already exists in any status.
  let deliveryId: string | null;
  try {
    deliveryId = await claimDelivery(
      db,
      event,
      grant.id,
      grant.targetAppId,
      grant.targetFunction,
    );
  } catch (err) {
    // Nothing claimed, nothing executed — a later pass can safely retry.
    console.warn("[AGENT-EVENTS] Delivery claim failed:", err);
    return "retryable";
  }
  if (!deliveryId) return "already";

  try {
    // Re-check the cap right before invoking (resolveSubscribeGrant checks it).
    const resolution = await resolveSubscribeGrant({
      userId: event.userId,
      emitterAppId: event.emitterAppId,
      subscriberAppId: grant.targetAppId,
      targetFunction: grant.targetFunction,
      topic: event.topic,
      nowMs,
    });
    if (!resolution.allowed) {
      await patchDelivery(db, deliveryId, {
        status: "denied",
        last_error: resolution.reason ?? "denied",
      });
      return "denied";
    }

    // executeEventDelivery reuses the full settlement path: it bills the user,
    // attributes caller_app_id=emitter, and records spend on the subscribe
    // grant's monthly cap (via meta.callerGrantId).
    const { executeEventDelivery } = await import("../handlers/mcp.ts");
    const outcome = await executeEventDelivery({
      subscriberAppId: grant.targetAppId,
      targetFunction: grant.targetFunction,
      payload: event.payload,
      userId: event.userId,
      emitterAppId: event.emitterAppId,
      grantId: grant.id,
      hop: event.emitHop,
    });

    if (outcome.success) {
      await patchDelivery(db, deliveryId, {
        status: "delivered",
        receipt_id: outcome.receiptId,
        delivered_at: new Date(nowMs).toISOString(),
      });
      return "delivered";
    }
    await patchDelivery(db, deliveryId, {
      status: "failed",
      // A failed handler still executed and settled — keep the receipt link
      // so the failure is billable-traceable, not just a message.
      receipt_id: outcome.receiptId ?? null,
      last_error: outcome.error ?? "delivery failed",
    });
    return "failed";
  } catch (err) {
    // The delivery row is claimed — the handler may have run and settled, so
    // this delivery must never be re-attempted. Record the failure on the row
    // (a stuck 'pending' row would otherwise block this subscriber forever).
    console.warn("[AGENT-EVENTS] Delivery failed post-claim:", err);
    await patchDelivery(db, deliveryId, {
      status: "failed",
      last_error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

// Any failed delivery recorded for this event (cheap existence probe — used
// by continuation passes whose own counters can't see earlier passes).
async function hasFailedDeliveries(
  db: DbConfig,
  eventId: string,
): Promise<boolean> {
  const resp = await fetch(
    `${db.baseUrl}/rest/v1/agent_event_deliveries?event_id=eq.${eventId}` +
      `&status=eq.failed&select=id&limit=1`,
    { headers: db.headers },
  ).catch(() => null);
  if (!resp || !resp.ok) return false;
  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

// Best-effort continuation: hand an event back to the queue. MUST be awaited
// — a detached send is cancelled when the consumer invocation acks and
// returns. Failure is still fine: the sweeper re-enqueues stuck rows within
// a couple of minutes.
async function requeueEvent(eventId: string): Promise<void> {
  const queue = getEventQueue();
  if (!queue) return;
  await queue.send({ eventId }).catch((err) => {
    console.warn("[AGENT-EVENTS] Event re-enqueue failed:", err);
  });
}

// ── Sweeper (minute cron) ──────────────────────────────────────────────────

// Recover stuck events. With EVENT_QUEUE bound this only re-enqueues — all
// dispatch happens in queue consumers, so a slow fan-out can never blow the
// cron's wall budget or starve sibling minute jobs. Pending rows younger than
// the grace window are the consumer's (racing its claim every tick would just
// burn attempts). Without a queue (local dev), this is the inline dispatcher
// it always was.
export async function dispatchPendingEvents(
  options: { limit?: number; nowMs?: number } = {},
): Promise<EventDispatchResult> {
  const db = getDbConfig();
  const result: EventDispatchResult = { scanned: 0, delivered: 0, failed: 0, denied: 0 };
  if (!db) return result;
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.min(options.limit ?? 50, 200);
  const queue = getEventQueue();

  const nowIso = new Date(nowMs).toISOString();
  // With a queue, pending rows younger than the grace window belong to the
  // consumer. Without one (dev), the bare pending arm is the pre-queue
  // behavior — a created_at-vs-worker-clock comparison would let DB clock
  // skew hide a just-emitted row for a tick.
  const pendingArm = queue
    ? `and(status.eq.pending,created_at.lt.${
      new Date(nowMs - SWEEP_GRACE_MS).toISOString()
    })`
    : `status.eq.pending`;
  const scanUrl = `${db.baseUrl}/rest/v1/agent_events?` +
    `or=(${pendingArm},and(status.eq.delivering,lease_until.lt.${nowIso}))` +
    `&order=created_at.asc&limit=${limit}&select=*`;
  const scanResp = await fetch(scanUrl, { headers: db.headers });
  if (!scanResp.ok) return result;
  const rows = await scanResp.json().catch(() => []) as EventRow[];
  if (!Array.isArray(rows)) return result;

  for (const row of rows) {
    result.scanned++;

    if (queue) {
      // The consumer claims and dispatches; a duplicate message loses the
      // claim and acks.
      await queue.send({ eventId: row.id }).catch((err) => {
        console.warn("[AGENT-EVENTS] Sweeper re-enqueue failed:", err);
      });
      continue;
    }

    // Dev fallback: inline claim + dispatch (the pre-queue behavior).
    let event: AgentEvent | null;
    try {
      event = await claimEventById(row.id, nowMs);
    } catch (err) {
      console.warn("[AGENT-EVENTS] Sweeper claim failed:", err);
      continue;
    }
    if (!event) continue;
    const outcome = await dispatchClaimedEvent(event, nowMs);
    result.delivered += outcome.delivered;
    result.failed += outcome.failed;
    result.denied += outcome.denied;
  }
  return result;
}

// Claim the right to invoke one subscriber for this event. Inserts the delivery
// row idempotently and returns its id; returns null if a row already exists in
// ANY status — that subscriber has already had its single at-most-once attempt
// for this event, so we never invoke it again (this is what prevents a
// re-scanned event from double-billing an already-settled delivery).
async function claimDelivery(
  db: DbConfig,
  event: AgentEvent,
  grantId: string,
  subscriberAppId: string,
  targetFunction: string,
): Promise<string | null> {
  const response = await fetch(
    `${db.baseUrl}/rest/v1/agent_event_deliveries?on_conflict=event_id,grant_id`,
    {
      method: "POST",
      headers: {
        ...db.headers,
        // ignore-duplicates: an existing row (any status) means this (event,
        // grant) was already handled — do not invoke again.
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([{
        event_id: event.id,
        grant_id: grantId,
        user_id: event.userId,
        subscriber_app_id: subscriberAppId,
        target_function: targetFunction,
        status: "pending",
      }]),
    },
  );
  if (!response.ok) {
    // Infra failure, NOT a duplicate: nothing was claimed and the handler was
    // never invoked. Throw so the caller routes this to the retryable lane —
    // returning null here would permanently skip the subscriber.
    const detail = await response.text().catch(() => "");
    throw new Error(`Failed to claim delivery: ${detail || response.status}`);
  }
  const rows = await response.json().catch(() => []);
  // ignore-duplicates returns the inserted row only when it was new.
  return Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
}

async function patchEvent(
  db: DbConfig,
  eventId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await fetch(`${db.baseUrl}/rest/v1/agent_events?id=eq.${eventId}`, {
    method: "PATCH",
    headers: { ...db.headers, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

async function patchDelivery(
  db: DbConfig,
  deliveryId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await fetch(`${db.baseUrl}/rest/v1/agent_event_deliveries?id=eq.${deliveryId}`, {
    method: "PATCH",
    headers: { ...db.headers, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  }).catch(() => {});
}
