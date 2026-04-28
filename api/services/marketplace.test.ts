import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  buildMarketplaceListingSummary,
  buildMarketplaceOwnerAdminSummary,
  buildPublicAcquisitionReceipt,
} from "./marketplace.ts";

Deno.test("marketplace summary: listed instant-buy apps expose price, bids, and seller payout", () => {
  const summary = buildMarketplaceListingSummary(
    {
      ask_price_light: 10000,
      floor_price_light: 4000,
      instant_buy: true,
      status: "active",
      show_metrics: true,
    },
    [{ amount_light: 2500 }, { amount_light: 6500 }],
    { had_external_db: false },
  );

  assertEquals(summary, {
    eligible: true,
    status: "listed",
    blockers: [],
    ask_price_light: 10000,
    floor_price_light: 4000,
    instant_buy: true,
    show_metrics: true,
    active_bid_count: 2,
    highest_bid_light: 6500,
    platform_fee_at_ask_light: 1000,
    seller_payout_at_ask_light: 9000,
  });
});

Deno.test("marketplace summary: missing listings stay unlisted but keep bid signal", () => {
  const summary = buildMarketplaceListingSummary(
    null,
    [{ amount_light: 1200 }],
    { had_external_db: false },
  );

  assertEquals(summary.status, "unlisted");
  assertEquals(summary.eligible, true);
  assertEquals(summary.active_bid_count, 1);
  assertEquals(summary.highest_bid_light, 1200);
  assertEquals(summary.ask_price_light, null);
  assertEquals(summary.seller_payout_at_ask_light, null);
});

Deno.test("marketplace summary: external database apps fail closed for trading", () => {
  const summary = buildMarketplaceListingSummary(
    {
      ask_price_light: 5000,
      instant_buy: true,
    },
    [],
    { had_external_db: true },
  );

  assertEquals(summary.status, "ineligible");
  assertEquals(summary.eligible, false);
  assertEquals(summary.blockers, ["external_db"]);
});

Deno.test("marketplace owner admin summary: prioritizes publish and listing terms before optional polish", () => {
  const summary = buildMarketplaceListingSummary(null, [], { had_external_db: false });
  const admin = buildMarketplaceOwnerAdminSummary(
    summary,
    null,
    { visibility: "private", had_external_db: false },
    {
      balance_light: 0,
      total_earned_light: 0,
      stripe_connect_account_id: null,
      stripe_connect_onboarded: false,
      stripe_connect_payouts_enabled: false,
    },
  );

  assertEquals(admin.recommended_action_id, "published");
  assertEquals(admin.payout_connected, false);
  assertEquals(
    admin.checklist.find((check) => check.id === "terms")?.status,
    "action",
  );
});

Deno.test("marketplace owner admin summary: bid review becomes the recommended action for ready listings", () => {
  const summary = buildMarketplaceListingSummary(
    {
      ask_price_light: 20000,
      floor_price_light: 12000,
      instant_buy: true,
      status: "active",
      show_metrics: true,
    },
    [{ amount_light: 16000 }],
    { had_external_db: false },
  );
  const admin = buildMarketplaceOwnerAdminSummary(
    summary,
    {
      ask_price_light: 20000,
      floor_price_light: 12000,
      instant_buy: true,
      show_metrics: true,
    },
    { visibility: "public", had_external_db: false },
    {
      balance_light: 5000,
      total_earned_light: 15000,
      stripe_connect_account_id: "acct_ready",
      stripe_connect_onboarded: true,
      stripe_connect_payouts_enabled: true,
    },
  );

  assertEquals(admin.recommended_action_id, "bids");
  assertEquals(admin.payouts_enabled, true);
  assertEquals(
    admin.checklist.find((check) => check.id === "bids")?.detail,
    "1 active bid awaiting review.",
  );
});

Deno.test("marketplace public acquisition receipt: includes profile links and receipt URL", () => {
  const receipt = buildPublicAcquisitionReceipt({
    id: "sale-123",
    app_id: "app-123",
    seller_id: "seller-uuid",
    buyer_id: "buyer-uuid",
    sale_price_light: 25000,
    created_at: "2026-04-28T12:00:00Z",
    apps: { name: "Caption Agent", slug: "caption-agent" },
    buyer: {
      id: "buyer-uuid",
      display_name: "Buyer Co",
      profile_slug: "buyer-co",
      avatar_url: null,
    },
    seller: {
      id: "seller-uuid",
      display_name: "Maker Studio",
      profile_slug: "maker-studio",
      avatar_url: null,
    },
  });

  assertEquals(receipt.receipt_id, "sale-123");
  assertEquals(receipt.type, "acquisition");
  assertEquals(receipt.app_name, "Caption Agent");
  assertEquals(receipt.app_url, "/app/app-123");
  assertEquals(receipt.receipt_url, "/api/discover/acquisitions/sale-123");
  assertEquals(receipt.buyer.profile_url, "/u/buyer-co");
  assertEquals(receipt.seller.profile_url, "/u/maker-studio");
});

Deno.test("marketplace public acquisition receipt: falls back to UUID profile links", () => {
  const receipt = buildPublicAcquisitionReceipt({
    id: "sale-456",
    app_id: "app-456",
    seller_id: "seller-uuid",
    buyer_id: "buyer-uuid",
    sale_price_light: null,
    created_at: null,
    apps: null,
    buyer: null,
    seller: null,
  });

  assertEquals(receipt.app_name, "Unknown app");
  assertEquals(receipt.buyer.display_name, "Private profile");
  assertEquals(receipt.buyer.profile_url, "/u/buyer-uuid");
  assertEquals(receipt.seller.profile_url, "/u/seller-uuid");
});
