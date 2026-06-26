import type { BillingAddressInput } from "./billing-addresses.ts";
import {
  getCurrentBillingAddress,
  updateStripeCustomerBillingAddress,
  upsertCurrentBillingAddress,
  type UserBillingAddressProfile,
} from "./billing-addresses.ts";
import { RequestValidationError } from "./request-validation.ts";
import { getSupabaseEnv } from "./user-supabase-configs.ts";

interface StripeCustomerRow {
  stripe_customer_id: string | null;
  email: string | null;
}

async function readJsonRows<T>(response: Response): Promise<T[]> {
  const payload = await response.json() as unknown;
  return Array.isArray(payload) ? payload as T[] : [];
}

/**
 * True if a stored customer id resolves to a live, non-deleted customer under
 * the given key/mode. Only a DEFINITIVE miss — HTTP 404, or a 200 body marked
 * `deleted` — returns false. Transient/auth/permission errors and network
 * blips return true so we never orphan-and-duplicate a customer on a blip; the
 * real error then surfaces from the downstream Stripe call instead.
 *
 * This is the guard that self-heals a Stripe TEST->LIVE key cutover: a
 * customer created under the test key does not exist for the live key, so the
 * stored id must be discarded and recreated.
 */
export async function stripeCustomerExists(
  stripeCustomerId: string,
  stripeSecretKey: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/customers/${
        encodeURIComponent(stripeCustomerId)
      }`,
      { headers: { "Authorization": `Bearer ${stripeSecretKey}` } },
    );
    if (res.status === 404) return false;
    if (!res.ok) return true;
    const body = await res.json().catch(() => null) as
      | { deleted?: boolean }
      | null;
    return body?.deleted !== true;
  } catch {
    return true;
  }
}

async function createStripeCustomerForUser(
  userId: string,
  email: string | null,
  stripeSecretKey: string,
  sbUrl: string,
  sbKey: string,
): Promise<string> {
  const custRes = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "email": email || "",
      "metadata[user_id]": userId,
      "metadata[platform]": "ultralight",
    }).toString(),
  });

  if (!custRes.ok) {
    console.error(
      "[STRIPE] Customer creation failed:",
      await custRes.text(),
    );
    throw new Error("Failed to create payment profile");
  }

  const customer = await custRes.json() as { id: string };

  const patchRes = await fetch(
    `${sbUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        "apikey": sbKey,
        "Authorization": `Bearer ${sbKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ stripe_customer_id: customer.id }),
    },
  );
  // If the write-back fails the stale id stays on the row, so the next funding
  // request would recreate the customer again. The current request still
  // succeeds (it uses the fresh id in-memory); log loudly so a persistent
  // persist failure is observable instead of silently spawning duplicates.
  if (!patchRes.ok) {
    console.warn(
      `[STRIPE] Failed to persist customer ${customer.id} for user ${userId} (status ${patchRes.status}); next funding attempt may recreate it.`,
    );
  }

  return customer.id;
}

export async function getOrCreateStripeCustomerForUser(
  userId: string,
  stripeSecretKey: string,
): Promise<{ stripeCustomerId: string; email: string | null }> {
  const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbKey } =
    getSupabaseEnv();
  const userDataRes = await fetch(
    `${sbUrl}/rest/v1/users?id=eq.${
      encodeURIComponent(userId)
    }&select=stripe_customer_id,email`,
    {
      headers: {
        "apikey": sbKey,
        "Authorization": `Bearer ${sbKey}`,
      },
    },
  );
  if (!userDataRes.ok) {
    throw new Error("Failed to read user");
  }
  const [userData] = await readJsonRows<StripeCustomerRow>(userDataRes);
  const stripeCustomerId = userData?.stripe_customer_id || null;
  const email = userData?.email || null;

  if (stripeCustomerId) {
    // Validate the stored id against the active key. A customer created under a
    // different key/mode (the classic test->live cutover) no longer exists, so
    // recreate + persist rather than handing a dead id to PaymentIntent /
    // customer-address calls (which fail with resource_missing "No such
    // customer"). Self-heals every funding path through this one chokepoint.
    if (await stripeCustomerExists(stripeCustomerId, stripeSecretKey)) {
      return { stripeCustomerId, email };
    }
    console.warn(
      `[STRIPE] Stored customer ${stripeCustomerId} for user ${userId} not found under the active key; recreating.`,
    );
    const recreated = await createStripeCustomerForUser(
      userId,
      email,
      stripeSecretKey,
      sbUrl,
      sbKey,
    );
    return { stripeCustomerId: recreated, email };
  }

  const created = await createStripeCustomerForUser(
    userId,
    email,
    stripeSecretKey,
    sbUrl,
    sbKey,
  );
  return { stripeCustomerId: created, email };
}

interface StripeChargeBillingDetails {
  name?: string | null;
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
  } | null;
}

function billingDetailsToInput(
  details: StripeChargeBillingDetails | null | undefined,
): BillingAddressInput | null {
  const a = details?.address;
  if (!a) return null;
  // Stripe Link / card billing can come back partial. We need at least a
  // line1 + country to be useful for consumption-time tax; city + postal
  // round it out. Anything short of that is treated as "no address".
  if (!a.line1 || !a.country || !a.city || !a.postal_code) return null;
  return {
    name: details?.name || undefined,
    line1: a.line1,
    line2: a.line2 || undefined,
    city: a.city,
    state: a.state || undefined,
    postalCode: a.postal_code,
    country: a.country,
  };
}

function sameBillingAddress(
  a: BillingAddressInput,
  b: UserBillingAddressProfile | null,
): boolean {
  if (!b) return false;
  return (a.line1 || "") === (b.line1 || "") &&
    (a.line2 || "") === (b.line2 || "") &&
    (a.city || "") === (b.city || "") &&
    (a.state || "") === (b.state || "") &&
    (a.postalCode || "") === (b.postalCode || "") &&
    (a.country || "").toUpperCase() === (b.country || "").toUpperCase();
}

/**
 * Capture the buyer's billing address from a completed funding charge.
 *
 * Stripe Link autofills the buyer's address into the PaymentElement, so the
 * resulting charge carries `billing_details.address`. We retrieve the charge
 * (the webhook PaymentIntent only references `latest_charge` by id) and store
 * the address as the user's current billing address (source "wallet_funding").
 * Because every funded account passes through top-up, this is the universal
 * capture point for the address consumption-time sales tax is computed against.
 *
 * Best-effort: it never throws. A missing/partial address or a transient
 * Stripe error must not fail an already-finalized deposit. Idempotent: a charge
 * whose address matches the stored current address is skipped (no version
 * churn on repeat top-ups from the same place).
 */
export async function captureFundingBillingAddressFromCharge(input: {
  userId: string;
  stripeChargeId: string;
  stripeCustomerId?: string | null;
  stripeSecretKey: string;
}): Promise<UserBillingAddressProfile | null> {
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/charges/${
        encodeURIComponent(input.stripeChargeId)
      }`,
      { headers: { "Authorization": `Bearer ${input.stripeSecretKey}` } },
    );
    if (!res.ok) {
      console.error(
        "[STRIPE] Charge retrieve for billing capture failed:",
        res.status,
        await res.text().catch(() => ""),
      );
      return null;
    }
    const charge = await res.json() as {
      billing_details?: StripeChargeBillingDetails;
      customer?: string | null;
    };
    const address = billingDetailsToInput(charge.billing_details);
    if (!address) return null;

    const existing = await getCurrentBillingAddress(input.userId).catch(
      () => null,
    );
    if (sameBillingAddress(address, existing)) return existing;

    return await upsertCurrentBillingAddress({
      userId: input.userId,
      address,
      source: "wallet_funding",
      stripeCustomerId: input.stripeCustomerId ??
        (typeof charge.customer === "string" ? charge.customer : null),
    });
  } catch (err) {
    console.error("[STRIPE] Billing address capture from charge failed:", err);
    return null;
  }
}

export async function ensureBillingAddressForFunding(input: {
  userId: string;
  billingAddress?: BillingAddressInput;
  source: "wallet_funding" | "wire_funding";
  stripeSecretKey: string;
  stripeCustomerId: string;
}): Promise<UserBillingAddressProfile> {
  const profile = input.billingAddress
    ? await upsertCurrentBillingAddress({
      userId: input.userId,
      address: input.billingAddress,
      source: input.source,
      stripeCustomerId: input.stripeCustomerId,
    })
    : await getCurrentBillingAddress(input.userId);

  if (!profile) {
    throw new RequestValidationError(
      "billing_address is required before adding Light",
      400,
    );
  }

  try {
    await updateStripeCustomerBillingAddress({
      stripeSecretKey: input.stripeSecretKey,
      stripeCustomerId: input.stripeCustomerId,
      profile,
    });
  } catch (err) {
    console.error("[STRIPE] Failed to sync billing address:", err);
    throw new Error("Failed to update payment profile billing address");
  }

  return profile;
}
