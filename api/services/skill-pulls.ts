import {
  type AppPricingConfig,
  getFreeSkillPulls,
  getSkillPullPriceLight,
} from "../../shared/types/index.ts";
import {
  type AccessPolicyRuntimeEvaluator,
  evaluateAccessPolicy,
  isAccessPolicyDenied,
} from "./access-policy.ts";
import { createRuntimeAccessPolicyExecutor } from "./access-policy-runtime.ts";
import { buildEconomicIdempotencyKey } from "./economic-idempotency.ts";
import { createSupabaseRestClient } from "./platform-clients/supabase-rest.ts";
import { createR2Service } from "./storage.ts";

export const DEFAULT_SKILL_ID = "context";

export interface SkillPullAppRow {
  id: string;
  owner_id: string;
  slug: string | null;
  name: string | null;
  description: string | null;
  visibility?: string | null;
  app_type?: string | null;
  storage_key?: string | null;
  skills_md?: string | null;
  manifest?: unknown;
  pricing_config?: unknown;
}

export interface SkillPullPricing {
  priceLight: number;
  freePulls: number;
  monetized: boolean;
}

export interface AppSkillSummary {
  id: string;
  name: string;
  description: string | null;
  semanticDescription: string;
  resource: string | null;
  pricing: SkillPullPricing;
}

export interface SkillPullReceipt {
  id: string | null;
  transferId: string | null;
  waiverEventId: string | null;
}

export interface SkillPullResult {
  skill: AppSkillSummary;
  content: string;
  receipt: SkillPullReceipt;
  chargedLight: number;
  developerRevenueLight: number;
  platformFeeLight: number;
  feeWouldHaveBeenLight: number;
  feeWaivedLight: number;
  waiverSource: string | null;
  freePull: boolean;
  freePullCount: number | null;
  freePullLimit: number;
}

export interface PullSkillContextParams {
  app: SkillPullAppRow;
  userId: string;
  skillId: string;
  operationId?: string | null;
  metadata?: Record<string, unknown>;
  fetchFn?: typeof fetch;
  accessPolicyExecutor?: AccessPolicyRuntimeEvaluator;
}

export class SkillPullBillingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(
    message: string,
    status = 402,
    code = "skill_pull_payment_required",
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "SkillPullBillingError";
  }
}

export function listAppSkills(app: SkillPullAppRow): AppSkillSummary[] {
  const manifestSkills = parseManifestSkills(app.manifest);
  const entries = Object.entries(manifestSkills);
  if (entries.length > 0) {
    return entries.map(([skillId, skill]) => ({
      id: skillId,
      name: skill.name || `${app.name || app.slug || "Tool"} ${skillId}`,
      description: skill.description || app.description || null,
      semanticDescription: skill.semanticDescription ||
        skill.description ||
        buildSemanticDescription(app, skillId),
      resource: skill.resource,
      pricing: skillPullPricing(app, skillId),
    }));
  }

  return [defaultSkillSummary(app)];
}

export async function pullSkillContext(
  params: PullSkillContextParams,
): Promise<SkillPullResult> {
  const skill = listAppSkills(params.app).find((entry) =>
    entry.id === params.skillId
  );
  if (!skill) {
    throw new Error("Skill not found");
  }

  const content = await loadSkillContent(params.app, skill);
  if (!content.trim()) {
    throw new Error("Skill content unavailable");
  }

  const accessDecision = await evaluateAccessPolicy({
    app: params.app,
    caller: { userId: params.userId },
    subject: { kind: "skill", id: params.skillId },
    metadata: params.metadata,
  }, {
    executeRuntimePolicy: params.accessPolicyExecutor ??
      createRuntimeAccessPolicyExecutor({
        app: params.app,
      }),
  });
  if (isAccessPolicyDenied(accessDecision)) {
    throw new SkillPullBillingError(
      accessDecision.reason,
      accessDecision.code === "access_policy_error" ? 500 : 403,
      accessDecision.code,
    );
  }
  const selfPull = accessDecision.selfAccess;
  const pricingConfig = normalizePricingConfig(params.app.pricing_config);
  const priceLight = accessDecision.priceLight;
  const freePullLimit = accessDecision.freeQuotaLimit;

  let chargeLight = accessDecision.chargeLight;
  let freePull = accessDecision.free;
  let freePullCount: number | null = null;
  let platformFeeLight = 0;
  let feeWouldHaveBeenLight = 0;
  let feeWaivedLight = 0;
  let waiverSource: string | null = null;
  let transferId: string | null = null;
  let waiverEventId: string | null = null;
  const idempotencyKey = buildEconomicIdempotencyKey("skill_pull", [
    params.operationId,
    params.userId,
    params.app.id,
    params.skillId,
  ]);

  let supabase: ReturnType<typeof createSupabaseRestClient> | null = null;
  const getSupabase = () => {
    supabase ??= createSupabaseRestClient({ fetchFn: params.fetchFn });
    return supabase;
  };

  if (
    !selfPull && priceLight > 0 && freePullLimit > 0 &&
    accessDecision.freeQuotaCounterKey
  ) {
    const usageResponse = await getSupabase().rpc("increment_caller_usage", {
      p_app_id: params.app.id,
      p_user_id: params.userId,
      p_counter_key: accessDecision.freeQuotaCounterKey,
    });
    if (usageResponse.ok) {
      freePullCount = parseUsageCount(await usageResponse.json());
      if (freePullCount !== null && freePullCount <= freePullLimit) {
        chargeLight = 0;
        freePull = true;
      }
    }
  }

  if (!selfPull && chargeLight > 0) {
    const transferResponse = await getSupabase().rpc("transfer_light", {
      p_from_user: params.userId,
      p_to_user: params.app.owner_id,
      p_amount_light: chargeLight,
      p_reason: "skill_pull",
      p_app_id: params.app.id,
      p_function_name: null,
      p_metadata: {
        ...accessDecision.metadata,
        ...(params.metadata || {}),
        pricing_source: "skill_pull",
        skill_id: params.skillId,
        skill_name: skill.name,
        app_slug: params.app.slug,
        customer_attribution_source: "platform_discovery",
        operation_id: params.operationId || null,
      },
      p_idempotency_key: idempotencyKey ? `${idempotencyKey}:transfer` : null,
    });

    if (!transferResponse.ok) {
      throw new SkillPullBillingError(
        `This skill costs ${chargeLight} Light to pull into context. Add Light and try again.`,
      );
    }

    const rows = await transferResponse.json() as Array<{
      platform_fee?: number;
      transfer_id?: string;
      fee_would_have_been?: number;
      fee_waived?: number;
      waiver_source?: string | null;
      waiver_event_id?: string | null;
    }>;
    const row = rows[0];
    if (!row) {
      throw new SkillPullBillingError(
        `This skill costs ${chargeLight} Light to pull into context. Add Light and try again.`,
      );
    }

    platformFeeLight = numeric(row.platform_fee);
    feeWouldHaveBeenLight = numeric(row.fee_would_have_been);
    feeWaivedLight = numeric(row.fee_waived);
    waiverSource = row.waiver_source || null;
    transferId = row.transfer_id || null;
    waiverEventId = row.waiver_event_id || null;
  }

  const developerRevenueLight = Math.max(0, chargeLight - platformFeeLight);
  const receipt = selfPull
    ? { id: null, transferId, waiverEventId }
    : await recordSkillPullReceipt(getSupabase(), {
      app: params.app,
      userId: params.userId,
      skill,
      idempotencyKey,
      amountLight: chargeLight,
      developerRevenueLight,
      platformFeeLight,
      feeWouldHaveBeenLight,
      feeWaivedLight,
      waiverSource,
      waiverEventId,
      transferId,
      freePull,
      freePullCount,
      freePullLimit,
      pricingConfig,
      metadata: {
        ...accessDecision.metadata,
        ...(params.metadata || {}),
        operation_id: params.operationId || null,
      },
    });

  return {
    skill,
    content,
    receipt,
    chargedLight: chargeLight,
    developerRevenueLight,
    platformFeeLight,
    feeWouldHaveBeenLight,
    feeWaivedLight,
    waiverSource,
    freePull,
    freePullCount,
    freePullLimit,
  };
}

function skillPullPricing(
  app: SkillPullAppRow,
  skillId: string,
): SkillPullPricing {
  const pricingConfig = normalizePricingConfig(app.pricing_config);
  const priceLight = Math.max(
    getSkillPullPriceLight(pricingConfig, skillId),
    0,
  );
  const freePulls = Math.max(getFreeSkillPulls(pricingConfig, skillId), 0);
  return {
    priceLight,
    freePulls,
    monetized: priceLight > 0,
  };
}

function normalizePricingConfig(value: unknown): AppPricingConfig | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as AppPricingConfig
    : null;
}

function defaultSkillSummary(app: SkillPullAppRow): AppSkillSummary {
  const skillId = DEFAULT_SKILL_ID;
  return {
    id: skillId,
    name: app.app_type === "skill"
      ? app.name || "Skill"
      : `${app.name || app.slug || "Tool"} context`,
    description: app.description,
    semanticDescription: buildSemanticDescription(app, skillId),
    resource: app.skills_md ? "skills.md" : null,
    pricing: skillPullPricing(app, skillId),
  };
}

function buildSemanticDescription(
  app: SkillPullAppRow,
  skillId = DEFAULT_SKILL_ID,
): string {
  const kind = app.app_type === "skill"
    ? "Standalone skill context"
    : "Tool skill context";
  return [
    kind,
    skillId !== DEFAULT_SKILL_ID ? skillId : null,
    app.name || app.slug,
    app.description,
  ].filter((part): part is string => Boolean(part && part.trim())).join(": ");
}

async function loadSkillContent(
  app: SkillPullAppRow,
  skill: AppSkillSummary,
): Promise<string> {
  const resource = normalizeSkillResource(skill.resource);
  if (resource) {
    if (resource === "skills.md" && app.skills_md?.trim()) {
      return app.skills_md;
    }
    if (app.storage_key) {
      const r2 = createR2Service();
      const prefix = app.storage_key.endsWith("/")
        ? app.storage_key
        : `${app.storage_key}/`;
      try {
        return await r2.fetchTextFile(`${prefix}${resource}`);
      } catch {
        return "";
      }
    }
    return "";
  }

  if (app.skills_md && app.skills_md.trim()) {
    return app.skills_md;
  }

  if (app.app_type !== "skill" || !app.storage_key) {
    return "";
  }

  const r2 = createR2Service();
  const keys = (await r2.listFiles(app.storage_key))
    .filter((key) => key.endsWith(".md"))
    .sort();
  const chunks: string[] = [];
  for (const key of keys) {
    chunks.push(await r2.fetchTextFile(key));
  }
  return chunks.join("\n\n").trim();
}

function normalizeSkillResource(resource: string | null): string | null {
  if (!resource) return null;
  const trimmed = resource.trim().replace(/^\/+/, "");
  if (!trimmed || trimmed.includes("..")) return null;
  return trimmed;
}

function parseManifestSkills(
  value: unknown,
): Record<
  string,
  {
    name: string | null;
    description: string | null;
    semanticDescription: string | null;
    resource: string | null;
  }
> {
  const manifest = typeof value === "string" ? safeJsonParse(value) : value;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {};
  }
  const rawSkills = (manifest as Record<string, unknown>).skills;
  if (!rawSkills || typeof rawSkills !== "object" || Array.isArray(rawSkills)) {
    return {};
  }

  const parsed: Record<
    string,
    {
      name: string | null;
      description: string | null;
      semanticDescription: string | null;
      resource: string | null;
    }
  > = {};
  for (const [id, value] of Object.entries(rawSkills)) {
    if (
      !id.trim() || !value || typeof value !== "object" || Array.isArray(value)
    ) {
      continue;
    }
    const raw = value as Record<string, unknown>;
    const description = typeof raw.description === "string"
      ? raw.description
      : null;
    parsed[id] = {
      name: typeof raw.name === "string" ? raw.name : null,
      description,
      semanticDescription: typeof raw.semantic_description === "string"
        ? raw.semantic_description
        : null,
      resource: typeof raw.resource === "string" ? raw.resource : null,
    };
  }
  return parsed;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function recordSkillPullReceipt(
  supabase: ReturnType<typeof createSupabaseRestClient>,
  input: {
    app: SkillPullAppRow;
    userId: string;
    skill: AppSkillSummary;
    idempotencyKey: string | null;
    amountLight: number;
    developerRevenueLight: number;
    platformFeeLight: number;
    feeWouldHaveBeenLight: number;
    feeWaivedLight: number;
    waiverSource: string | null;
    waiverEventId: string | null;
    transferId: string | null;
    freePull: boolean;
    freePullCount: number | null;
    freePullLimit: number;
    pricingConfig: AppPricingConfig | null;
    metadata: Record<string, unknown>;
  },
): Promise<SkillPullReceipt> {
  const response = await supabase.rpc("record_skill_pull_receipt", {
    p_caller_user_id: input.userId,
    p_publisher_user_id: input.app.owner_id,
    p_app_id: input.app.id,
    p_skill_id: input.skill.id,
    p_skill_name: input.skill.name,
    p_amount_light: input.amountLight,
    p_developer_revenue_light: input.developerRevenueLight,
    p_platform_fee_light: input.platformFeeLight,
    p_fee_would_have_been_light: input.feeWouldHaveBeenLight,
    p_fee_waived_light: input.feeWaivedLight,
    p_waiver_source: input.waiverSource,
    p_waiver_event_id: input.waiverEventId,
    p_transfer_id: input.transferId,
    p_free_pull: input.freePull,
    p_free_pull_count: input.freePullCount,
    p_free_pull_limit: input.freePullLimit,
    p_pricing_config: input.pricingConfig,
    p_metadata: input.metadata,
    p_idempotency_key: input.idempotencyKey,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      detail
        ? `Failed to record skill pull receipt: ${detail}`
        : "Failed to record skill pull receipt",
    );
  }

  const rows = await response.json() as Array<{
    receipt_id?: string;
    transfer_id?: string | null;
    waiver_event_id?: string | null;
  }>;
  const row = rows[0];
  return {
    id: row?.receipt_id || null,
    transferId: row?.transfer_id || input.transferId,
    waiverEventId: row?.waiver_event_id || input.waiverEventId,
  };
}

function parseUsageCount(payload: unknown): number | null {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") return null;
  const value = (row as Record<string, unknown>).call_count ??
    (row as Record<string, unknown>).count;
  return numeric(value) || null;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
