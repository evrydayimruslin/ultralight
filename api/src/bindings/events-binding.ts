// RPC Events Binding for Dynamic Workers
// Lets sandboxed app code emit pub/sub events WITHOUT the platform WORKER_SECRET
// ever entering the isolate. Identity (emitter app + user) and the hop ceiling
// come from the signed caller-context token, verified host-side here — exactly
// as the legacy /api/events/emit endpoint did — so sandbox JS cannot spoof the
// emitter, the user, or the hop. topic + payload are the only sandbox inputs.

import { WorkerEntrypoint } from "cloudflare:workers";
import { emitEvent } from "../../services/agent-events.ts";
import { verifyCallerContextToken } from "../../services/agent-caller-context.ts";

interface EventsBindingProps {
  // Signed X-Galactic-Caller token minted server-side for this execution. Set
  // host-side from RuntimeConfig.callerContextToken — never a sandbox input.
  callerContextToken: string;
}

interface EmitResult {
  ok: boolean;
  event_id: string | null;
  rejected: "hop_exceeded" | "not_configured" | null;
}

export class EventsBinding
  extends WorkerEntrypoint<unknown, EventsBindingProps> {
  async emit(topic: unknown, payload: unknown): Promise<EmitResult> {
    if (typeof topic !== "string" || !topic) {
      throw new Error("emit requires a topic string");
    }
    // Identity + hop come from the VERIFIED signed token, never from sandbox
    // input — this is the same trust boundary the /api/events/emit endpoint used.
    const verified = await verifyCallerContextToken(
      this.ctx.props.callerContextToken,
    );
    if (!verified.claims) {
      throw new Error("emit requires an authenticated user context");
    }
    const out = await emitEvent({
      userId: verified.claims.userId,
      emitterAppId: verified.claims.callerAppId,
      topic,
      payload: (payload && typeof payload === "object")
        ? payload as Record<string, unknown>
        : {},
      emitHop: verified.claims.hop,
    });
    return {
      ok: !out.rejected,
      event_id: out.eventId,
      rejected: out.rejected ?? null,
    };
  }
}
