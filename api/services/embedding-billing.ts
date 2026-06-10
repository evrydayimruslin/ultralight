import { getEnv } from "../lib/env.ts";
import { buildEconomicIdempotencyKey } from "./economic-idempotency.ts";
import { createSupabaseRestClient } from "./platform-clients/supabase-rest.ts";

export interface RecordEmbeddingChargeInput {
  publisherUserId: string;
  appId: string;
  appVersion?: string | null;
  model: string;
  promptTokens: number;
  totalTokens: number;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
  fetchFn?: typeof fetch;
}

export interface EmbeddingChargeResult {
  chargeId: string | null;
  amountLight: number;
  amountDebitedLight: number;
  status: "charged" | "no_charge" | "insufficient_balance" | "failed";
}

const RATE_ENV = "OPENROUTER_EMBEDDING_LIGHT_PER_1K_TOKENS";

export function getEmbeddingLightRatePer1kTokens(): number {
  const raw = getEnv(RATE_ENV);
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function recordEmbeddingGenerationCharge(
  input: RecordEmbeddingChargeInput,
): Promise<EmbeddingChargeResult | null> {
  const totalTokens = Math.max(0, Math.trunc(input.totalTokens || 0));
  const promptTokens = Math.max(0, Math.trunc(input.promptTokens || 0));
  const rate = getEmbeddingLightRatePer1kTokens();

  try {
    const supabase = createSupabaseRestClient({ fetchFn: input.fetchFn });
    const response = await supabase.rpc("record_embedding_generation_charge", {
      p_publisher_user_id: input.publisherUserId,
      p_app_id: input.appId,
      p_app_version: input.appVersion || null,
      p_model: input.model,
      p_prompt_tokens: promptTokens,
      p_total_tokens: totalTokens,
      p_rate_light_per_1k_tokens: rate,
      p_metadata: {
        ...(input.metadata || {}),
        rate_env: RATE_ENV,
      },
      p_idempotency_key: input.idempotencyKey ??
        buildEconomicIdempotencyKey("embedding_generation", [
          input.appId,
          input.appVersion || "draft",
          input.model,
          typeof input.metadata?.source === "string"
            ? input.metadata.source
            : null,
        ]),
    });

    if (!response.ok) {
      console.error(
        "[EMBEDDING_BILLING] Failed to record embedding charge:",
        await response.text().catch(() => ""),
      );
      return null;
    }

    const rows = await response.json() as Array<{
      charge_id?: string;
      amount_light?: number;
      amount_debited_light?: number;
      status?: EmbeddingChargeResult["status"];
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      chargeId: row.charge_id || null,
      amountLight: numeric(row.amount_light),
      amountDebitedLight: numeric(row.amount_debited_light),
      status: row.status || "failed",
    };
  } catch (err) {
    console.error(
      "[EMBEDDING_BILLING] Embedding charge recording failed:",
      err,
    );
    return null;
  }
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
