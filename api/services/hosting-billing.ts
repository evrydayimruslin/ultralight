// Storage-at-rest billing service.
//
// The exported hosting names are retained because worker startup and older
// callers still wire the hourly job through this module. The economics are now
// account-level storage-at-rest: source/app bytes + user app data + D1 storage
// + content bytes, with one 100MB free allowance and prorated GB-month Light.

import { getEnv } from "../lib/env.ts";
import {
  COMBINED_FREE_TIER_BYTES,
  STORAGE_LIGHT_PER_GB_MONTH,
} from "../../shared/types/index.ts";
import { DEFAULT_BILLING_CONFIG, getBillingConfig } from "./billing-config.ts";
import { buildEconomicIdempotencyKey } from "./economic-idempotency.ts";
import {
  type CloudUsageDebitResult,
  CloudUsageRpcError,
  debitCloudUsage,
} from "./cloud-usage.ts";
import { refreshGpuReliabilityView } from "./gpu/reliability.ts";

const BYTES_PER_MIB = 1024 * 1024;
const BYTES_PER_GIB = 1024 * BYTES_PER_MIB;
const STORAGE_BILLING_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_BILLING_ELAPSED_MS = 60 * 1000;
const CONTENT_STORAGE_TYPES = ["page", "memory_md", "library_md"] as const;

interface BillingUser {
  id: string;
  balance_light: number | null;
  hosting_last_billed_at: string | null;
  data_storage_used_bytes: number | null;
  storage_used_bytes: number | null;
  d1_storage_bytes: number | null;
  storage_limit_bytes: number | null;
}

interface ContentStorageRow {
  id: string;
  type: typeof CONTENT_STORAGE_TYPES[number] | string;
  size: number | null;
}

interface ContentOwnerRow {
  owner_id: string | null;
}

interface StorageComponents {
  sourceBytes: number;
  dataBytes: number;
  d1Bytes: number;
  contentBytes: number;
  combinedBytes: number;
}

interface ContentStorageSummary {
  bytes: number;
  counts: Record<string, number>;
}

export interface StorageAtRestCharge {
  combinedBytes: number;
  freeBytes: number;
  overageBytes: number;
  elapsedMs: number;
  storageGbMonths: number;
  amountLight: number;
  storageLightPerGbMonth: number;
}

export interface BillingResult {
  usersProcessed: number;
  usersSuspended: number;
  totalChargedLight: number;
  degraded: boolean;
  errors: string[];
  details: {
    userId: string;
    storageMb: number;
    hostingChargedLight: number;
    dataOverageMb: number;
    dataOverageLight: number;
    totalChargedLight: number;
    newBalance: number;
    suspended: boolean;
  }[];
}

type DegradeReporter = (message: string, detail?: unknown) => void;

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function bytesOrZero(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.trunc(value);
}

function parseBillingClock(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function calculateStorageAtRestCharge(params: {
  combinedBytes: number;
  freeBytes?: number;
  elapsedMs: number;
  storageLightPerGbMonth?: number;
}): StorageAtRestCharge {
  const combinedBytes = bytesOrZero(params.combinedBytes);
  const freeBytes = positiveNumber(
    params.freeBytes ?? DEFAULT_BILLING_CONFIG.storageFreeBytes,
    COMBINED_FREE_TIER_BYTES,
  );
  const elapsedMs = Math.max(0, params.elapsedMs);
  const storageLightPerGbMonth = positiveNumber(
    params.storageLightPerGbMonth ??
      DEFAULT_BILLING_CONFIG.storageLightPerGbMonth,
    STORAGE_LIGHT_PER_GB_MONTH,
  );
  const overageBytes = Math.max(0, combinedBytes - freeBytes);
  const storageGbMonths = overageBytes === 0 || elapsedMs === 0
    ? 0
    : (overageBytes / BYTES_PER_GIB) *
      (elapsedMs / STORAGE_BILLING_MONTH_MS);
  const amountLight = storageGbMonths * storageLightPerGbMonth;

  return {
    combinedBytes,
    freeBytes,
    overageBytes,
    elapsedMs,
    storageGbMonths,
    amountLight,
    storageLightPerGbMonth,
  };
}

/**
 * Process account storage-at-rest billing.
 *
 * The old published-size hosting meter is disabled by billing config. This
 * job debits spendable Light through the cloud-usage ledger for storage bytes
 * above the free allowance and advances the user-level billing clock whenever
 * it safely reconciles a period.
 */
export async function processHostingBilling(): Promise<BillingResult> {
  const SUPABASE_URL = getEnv("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const result: BillingResult = {
    usersProcessed: 0,
    usersSuspended: 0,
    totalChargedLight: 0,
    degraded: false,
    errors: [],
    details: [],
  };

  const markDegraded: DegradeReporter = (message, detail) => {
    result.degraded = true;
    result.errors.push(message);
    if (detail !== undefined) {
      console.error("[STORAGE-BILLING]", message, detail);
    }
  };

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    markDegraded("Supabase not configured; storage billing skipped");
    return result;
  }

  const headers = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const writeHeaders = {
    ...headers,
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
  };

  try {
    const billingConfig = await getBillingConfig();
    if (billingConfig.publishedHostingMeterEnabled) {
      console.warn(
        "[STORAGE-BILLING] Legacy published hosting meter is configured on, " +
          "but PR21 storage-at-rest billing supersedes published-size hosting charges.",
      );
    }

    const usersRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?or=(balance_light.gt.0,storage_used_bytes.gt.0,data_storage_used_bytes.gt.0,d1_storage_bytes.gt.0)` +
        `&select=id,balance_light,hosting_last_billed_at,data_storage_used_bytes,storage_used_bytes,d1_storage_bytes,storage_limit_bytes`,
      { headers },
    );

    if (!usersRes.ok) {
      markDegraded(`Failed to query users: ${await usersRes.text()}`);
      return result;
    }

    const usersById = new Map<string, BillingUser>();
    const initialUsers = await usersRes.json() as BillingUser[];
    for (const user of initialUsers) {
      usersById.set(user.id, user);
    }

    const contentOwnerIds = await readContentOwnerIds(
      SUPABASE_URL,
      headers,
      markDegraded,
    );
    const missingContentOwnerIds = contentOwnerIds.filter((ownerId) =>
      !usersById.has(ownerId)
    );
    if (missingContentOwnerIds.length > 0) {
      const contentOwnerUsers = await readUsersByIds(
        SUPABASE_URL,
        missingContentOwnerIds,
        headers,
        markDegraded,
      );
      for (const user of contentOwnerUsers) {
        usersById.set(user.id, user);
      }
    }

    const users = [...usersById.values()];
    if (users.length === 0) {
      return result;
    }

    console.log(
      `[STORAGE-BILLING] Reconciling storage for ${users.length} user(s)`,
    );

    const freeBytes = positiveNumber(
      billingConfig.storageFreeBytes,
      COMBINED_FREE_TIER_BYTES,
    );
    const storageLightPerGbMonth = positiveNumber(
      billingConfig.storageLightPerGbMonth,
      STORAGE_LIGHT_PER_GB_MONTH,
    );

    for (const user of users) {
      try {
        const now = new Date();
        const nowIso = now.toISOString();
        const lastBilled = parseBillingClock(user.hosting_last_billed_at);
        if (!lastBilled) {
          await updateUserBillingClock(
            SUPABASE_URL,
            user.id,
            nowIso,
            writeHeaders,
            markDegraded,
          );
          result.usersProcessed++;
          continue;
        }

        const elapsedMs = Math.max(
          0,
          now.getTime() - lastBilled.getTime(),
        );
        if (elapsedMs < MIN_BILLING_ELAPSED_MS) {
          continue;
        }

        const contentSummary = await readContentStorageSummary(
          SUPABASE_URL,
          user.id,
          headers,
          markDegraded,
        );
        const components = buildStorageComponents(user, contentSummary.bytes);
        const charge = calculateStorageAtRestCharge({
          combinedBytes: components.combinedBytes,
          freeBytes,
          elapsedMs,
          storageLightPerGbMonth,
        });

        if (charge.amountLight <= 0) {
          await updateUserBillingClock(
            SUPABASE_URL,
            user.id,
            nowIso,
            writeHeaders,
            markDegraded,
          );
          result.usersProcessed++;
          continue;
        }

        const payerBalance = user.balance_light ?? 0;
        if (payerBalance <= 0) {
          await suspendPublishedContent(
            SUPABASE_URL,
            user.id,
            writeHeaders,
            markDegraded,
          );
          result.usersSuspended++;
          result.details.push(
            detailFor(user.id, components, charge, payerBalance, true, 0),
          );
          continue;
        }

        let debitResult: CloudUsageDebitResult;
        try {
          debitResult = await debitCloudUsage({
            payerUserId: user.id,
            ownerUserId: user.id,
            source: "storage_billing",
            resource: "storage_at_rest",
            units: charge.overageBytes,
            cloudUnits: charge.storageGbMonths,
            amountLight: charge.amountLight,
            billingConfigVersion: billingConfig.version,
            idempotencyKey: buildEconomicIdempotencyKey(
              "storage_billing_debit",
              [
                user.id,
                lastBilled.toISOString(),
                nowIso,
              ],
            ),
            metadata: {
              billing_model: "storage_at_rest_gb_month",
              elapsed_ms: charge.elapsedMs,
              free_bytes: charge.freeBytes,
              combined_storage_bytes: charge.combinedBytes,
              overage_bytes: charge.overageBytes,
              storage_gb_months: charge.storageGbMonths,
              storage_light_per_gb_month: charge.storageLightPerGbMonth,
              source_storage_bytes: components.sourceBytes,
              user_data_storage_bytes: components.dataBytes,
              d1_storage_bytes: components.d1Bytes,
              content_storage_bytes: components.contentBytes,
              content_counts: contentSummary.counts,
              legacy_storage_limit_bytes: user.storage_limit_bytes ?? null,
              published_hosting_meter_enabled:
                billingConfig.publishedHostingMeterEnabled,
            },
          });
        } catch (err) {
          if (isInsufficientLightError(err)) {
            await suspendPublishedContent(
              SUPABASE_URL,
              user.id,
              writeHeaders,
              markDegraded,
            );
            result.usersSuspended++;
            result.details.push(
              detailFor(user.id, components, charge, payerBalance, true, 0),
            );
            continue;
          }
          throw err;
        }

        await updateUserBillingClock(
          SUPABASE_URL,
          user.id,
          nowIso,
          writeHeaders,
          markDegraded,
        );

        await logStorageBillingTransaction(
          SUPABASE_URL,
          user.id,
          charge,
          components,
          contentSummary.counts,
          debitResult,
          billingConfig.version,
          writeHeaders,
        );

        result.usersProcessed++;
        result.totalChargedLight += debitResult.amountDebited;
        result.details.push(
          detailFor(
            user.id,
            components,
            charge,
            debitResult.newBalance,
            false,
            debitResult.amountDebited,
          ),
        );
      } catch (userErr) {
        const msg = userErr instanceof Error
          ? userErr.message
          : String(userErr);
        markDegraded(`Error processing ${user.id}: ${msg}`, userErr);
      }
    }

    if (result.usersProcessed > 0 || result.usersSuspended > 0) {
      console.log(
        `[STORAGE-BILLING] Complete: ${result.usersProcessed} user(s) reconciled, ` +
          `${result.usersSuspended} suspended, ` +
          `${result.totalChargedLight.toFixed(6)} Light charged, ` +
          `${result.errors.length} error(s)`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markDegraded(`Fatal error: ${msg}`, err);
  }

  return result;
}

export const processStorageBilling = processHostingBilling;

function buildStorageComponents(
  user: BillingUser,
  contentBytes: number,
): StorageComponents {
  const sourceBytes = bytesOrZero(user.storage_used_bytes);
  const dataBytes = bytesOrZero(user.data_storage_used_bytes);
  const d1Bytes = bytesOrZero(user.d1_storage_bytes);
  const normalizedContentBytes = bytesOrZero(contentBytes);
  return {
    sourceBytes,
    dataBytes,
    d1Bytes,
    contentBytes: normalizedContentBytes,
    combinedBytes: sourceBytes + dataBytes + d1Bytes + normalizedContentBytes,
  };
}

async function readContentStorageSummary(
  supabaseUrl: string,
  userId: string,
  headers: HeadersInit,
  markDegraded: DegradeReporter,
): Promise<ContentStorageSummary> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/content?owner_id=eq.${userId}&type=in.(${
      CONTENT_STORAGE_TYPES.join(",")
    })&select=id,type,size`,
    { headers },
  );
  if (!res.ok) {
    markDegraded(
      `Failed to query content storage for ${userId}: ${await res.text()}`,
    );
    return { bytes: 0, counts: {} };
  }

  const rows = await res.json() as ContentStorageRow[];
  const counts: Record<string, number> = {};
  let bytes = 0;
  for (const row of rows) {
    bytes += bytesOrZero(row.size);
    counts[row.type] = (counts[row.type] ?? 0) + 1;
  }
  return { bytes, counts };
}

async function readContentOwnerIds(
  supabaseUrl: string,
  headers: HeadersInit,
  markDegraded: DegradeReporter,
): Promise<string[]> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/content?type=in.(${
      CONTENT_STORAGE_TYPES.join(",")
    })&size=gt.0&select=owner_id`,
    { headers },
  );
  if (!res.ok) {
    markDegraded(`Failed to query content storage owners: ${await res.text()}`);
    return [];
  }

  const rows = await res.json() as ContentOwnerRow[];
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row.owner_id === "string" && row.owner_id.length > 0) {
      ids.add(row.owner_id);
    }
  }
  return [...ids];
}

async function readUsersByIds(
  supabaseUrl: string,
  userIds: string[],
  headers: HeadersInit,
  markDegraded: DegradeReporter,
): Promise<BillingUser[]> {
  if (userIds.length === 0) return [];
  const idList = userIds.join(",");
  const res = await fetch(
    `${supabaseUrl}/rest/v1/users?id=in.(${idList})` +
      `&select=id,balance_light,hosting_last_billed_at,data_storage_used_bytes,storage_used_bytes,d1_storage_bytes,storage_limit_bytes`,
    { headers },
  );
  if (!res.ok) {
    markDegraded(`Failed to query content owner users: ${await res.text()}`);
    return [];
  }
  return await res.json() as BillingUser[];
}

async function updateUserBillingClock(
  supabaseUrl: string,
  userId: string,
  nowIso: string,
  writeHeaders: HeadersInit,
  markDegraded: DegradeReporter,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${userId}`, {
    method: "PATCH",
    headers: writeHeaders,
    body: JSON.stringify({ hosting_last_billed_at: nowIso }),
  });
  if (!res.ok) {
    markDegraded(
      `Failed to update storage billing clock for ${userId}: ${await res
        .text()}`,
    );
  }
}

async function suspendPublishedContent(
  supabaseUrl: string,
  userId: string,
  writeHeaders: HeadersInit,
  markDegraded: DegradeReporter,
): Promise<void> {
  try {
    const suspendAppsRes = await fetch(
      `${supabaseUrl}/rest/v1/apps?owner_id=eq.${userId}&deleted_at=is.null&hosting_suspended=eq.false` +
        `&visibility=in.(public,unlisted)`,
      {
        method: "PATCH",
        headers: writeHeaders,
        body: JSON.stringify({ hosting_suspended: true }),
      },
    );
    if (!suspendAppsRes.ok) {
      markDegraded(
        `Failed to suspend apps for ${userId}: ${await suspendAppsRes.text()}`,
      );
    }
  } catch (err) {
    markDegraded(`Failed to suspend apps for ${userId}`, err);
  }

  try {
    const suspendPagesRes = await fetch(
      `${supabaseUrl}/rest/v1/content?owner_id=eq.${userId}&type=eq.page&hosting_suspended=eq.false`,
      {
        method: "PATCH",
        headers: writeHeaders,
        body: JSON.stringify({ hosting_suspended: true }),
      },
    );
    if (!suspendPagesRes.ok) {
      markDegraded(
        `Failed to suspend pages for ${userId}: ${await suspendPagesRes
          .text()}`,
      );
    }
  } catch (err) {
    markDegraded(`Failed to suspend pages for ${userId}`, err);
  }
}

async function logStorageBillingTransaction(
  supabaseUrl: string,
  userId: string,
  charge: StorageAtRestCharge,
  components: StorageComponents,
  contentCounts: Record<string, number>,
  debitResult: CloudUsageDebitResult,
  billingConfigVersion: number,
  writeHeaders: HeadersInit,
): Promise<void> {
  const row = {
    user_id: userId,
    type: "charge",
    category: "storage_at_rest",
    description:
      `Storage at rest: ${
        (charge.overageBytes / BYTES_PER_MIB).toFixed(2)
      } MB over ` +
      `${(charge.freeBytes / BYTES_PER_MIB).toFixed(0)} MB free`,
    amount_cents: 0,
    balance_after: null,
    amount_light: -debitResult.amountDebited,
    balance_after_light: debitResult.newBalance,
    billing_config_version: billingConfigVersion,
    metadata: {
      event_id: debitResult.eventId,
      billing_model: "storage_at_rest_gb_month",
      elapsed_ms: charge.elapsedMs,
      combined_storage_bytes: components.combinedBytes,
      overage_bytes: charge.overageBytes,
      storage_gb_months: charge.storageGbMonths,
      storage_light_per_gb_month: charge.storageLightPerGbMonth,
      source_storage_bytes: components.sourceBytes,
      user_data_storage_bytes: components.dataBytes,
      d1_storage_bytes: components.d1Bytes,
      content_storage_bytes: components.contentBytes,
      content_counts: contentCounts,
    },
  };

  await fetch(`${supabaseUrl}/rest/v1/billing_transactions`, {
    method: "POST",
    headers: writeHeaders,
    body: JSON.stringify(row),
  }).catch(() => {});
}

function isInsufficientLightError(err: unknown): boolean {
  if (!(err instanceof CloudUsageRpcError)) {
    return false;
  }
  return /insufficient|balance|spendable/i.test(err.message);
}

function detailFor(
  userId: string,
  components: StorageComponents,
  charge: StorageAtRestCharge,
  newBalance: number,
  suspended: boolean,
  actualChargedLight: number,
): BillingResult["details"][number] {
  return {
    userId,
    storageMb: components.combinedBytes / BYTES_PER_MIB,
    hostingChargedLight: 0,
    dataOverageMb: charge.overageBytes / BYTES_PER_MIB,
    dataOverageLight: actualChargedLight,
    totalChargedLight: actualChargedLight,
    newBalance,
    suspended,
  };
}

/**
 * Unsuspend all content for a user after they top up their balance.
 */
export async function unsuspendContent(
  userId: string,
): Promise<{ apps: number; pages: number }> {
  const SUPABASE_URL = getEnv("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const writeHeaders = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  };

  const nowStr = new Date().toISOString();

  const appsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${userId}&hosting_suspended=eq.true&select=id`,
    {
      method: "PATCH",
      headers: writeHeaders,
      body: JSON.stringify({
        hosting_suspended: false,
        hosting_last_billed_at: nowStr,
      }),
    },
  );
  const appsUnsuspended = appsRes.ok
    ? (await appsRes.json() as Array<{ id: string }>).length
    : 0;

  const pagesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/content?owner_id=eq.${userId}&type=eq.page&hosting_suspended=eq.true&select=id`,
    {
      method: "PATCH",
      headers: writeHeaders,
      body: JSON.stringify({
        hosting_suspended: false,
        hosting_last_billed_at: nowStr,
      }),
    },
  );
  const pagesUnsuspended = pagesRes.ok
    ? (await pagesRes.json() as Array<{ id: string }>).length
    : 0;

  if (appsUnsuspended > 0 || pagesUnsuspended > 0) {
    console.log(
      `[STORAGE-BILLING] Unsuspended ${appsUnsuspended} app(s), ${pagesUnsuspended} page(s) for user ${userId}`,
    );
  }

  return { apps: appsUnsuspended, pages: pagesUnsuspended };
}

/**
 * Start the hourly storage billing job.
 */
export function startHostingBillingJob(): void {
  const INTERVAL_MS = 60 * 60 * 1000;

  console.log(
    "[STORAGE-BILLING] Starting storage-at-rest billing job (hourly, no startup run)",
  );

  setInterval(async () => {
    try {
      const billingResult = await processHostingBilling();
      if (billingResult.degraded || billingResult.errors.length > 0) {
        console.error(
          "[STORAGE-BILLING] Scheduled run completed in degraded mode:",
          billingResult.errors,
        );
      }
    } catch (err) {
      console.error("[STORAGE-BILLING] Scheduled billing failed:", err);
    }

    try {
      await refreshGpuReliabilityView();
    } catch (err) {
      console.error("[GPU-RELIABILITY] Hourly refresh failed:", err);
    }
  }, INTERVAL_MS);
}
