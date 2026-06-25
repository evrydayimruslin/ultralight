// Free Mode smoke fixture — three functions covering the Free Mode matrix.
// Driven by scripts/smoke/free-mode-e2e-smoke.mjs.
//
// - free_ping: price 0, no inference  -> ALLOWED in Free Mode
// - paid_ping: priced via gx.set      -> BLOCKED (free_mode_paid_blocked)
// - ai_ping:   calls galactic.ai()    -> BLOCKED (free_mode_ai_requires_byok)
//
// `galactic.ai(` must appear literally so the upload-time inference detector
// (parser.ts analyzeInferenceUsage + inferPermissions) marks ai_ping — and ONLY
// ai_ping — uses_inference=true. In Free Mode the call is gated BEFORE execution,
// so the ai() request below never actually runs (and never spends).

const galactic = globalThis.galactic ?? globalThis.ultralight;

export function free_ping() {
  return { ok: true, kind: "free" };
}

export function paid_ping() {
  return { ok: true, kind: "paid" };
}

export async function ai_ping(args: { prompt?: string }) {
  const response = await galactic.ai({
    messages: [{ role: "user", content: String(args?.prompt || "ping") }],
  });
  return { ok: true, kind: "ai", content: response.content };
}
