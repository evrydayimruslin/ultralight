import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import { buildMarketplaceListingSummary } from "./marketplace.ts";

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
