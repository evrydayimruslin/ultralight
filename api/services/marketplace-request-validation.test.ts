import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.210.0/assert/assert_rejects.ts";

import {
  validateMarketplaceAskRequest,
  validateMarketplaceBidActionRequest,
  validateMarketplaceBidRequest,
  validateMarketplaceBuyRequest,
  validateMarketplaceMetricsVisibilityRequest,
} from "./marketplace-request-validation.ts";
import { RequestValidationError } from "./request-validation.ts";

Deno.test("marketplace request validation: bid requests enforce app ids, amounts, and expiry bounds", async () => {
  const payload = await validateMarketplaceBidRequest(
    new Request("https://example.com/api/marketplace/bid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: "11111111-1111-4111-8111-111111111111",
        amount_light: 5000,
        message: "Strong app with real usage.",
        expires_in_hours: 48,
      }),
    }),
  );

  assertEquals(payload, {
    appId: "11111111-1111-4111-8111-111111111111",
    amountLight: 5000,
    message: "Strong app with real usage.",
    expiresInHours: 48,
  });

  await assertRejects(
    () =>
      validateMarketplaceBidRequest(
        new Request("https://example.com/api/marketplace/bid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: "11111111-1111-4111-8111-111111111111",
            amount_light: 0,
          }),
        }),
      ),
    RequestValidationError,
    "amount_light must be at least 1",
  );
});

Deno.test("marketplace request validation: ask requests keep instant buy and floor logic coherent", async () => {
  const payload = await validateMarketplaceAskRequest(
    new Request("https://example.com/api/marketplace/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: "22222222-2222-4222-8222-222222222222",
        price_light: 12000,
        floor_light: 9000,
        instant_buy: true,
        note: "Healthy usage and clear docs.",
      }),
    }),
  );

  assertEquals(payload, {
    appId: "22222222-2222-4222-8222-222222222222",
    priceLight: 12000,
    floorLight: 9000,
    instantBuy: true,
    note: "Healthy usage and clear docs.",
  });

  await assertRejects(
    () =>
      validateMarketplaceAskRequest(
        new Request("https://example.com/api/marketplace/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: "22222222-2222-4222-8222-222222222222",
            instant_buy: true,
          }),
        }),
      ),
    RequestValidationError,
    "price_light is required when instant_buy is enabled",
  );
});

Deno.test("marketplace request validation: bid actions, buy, and metrics visibility require typed ids", async () => {
  const actionPayload = await validateMarketplaceBidActionRequest(
    new Request("https://example.com/api/marketplace/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bid_id: "33333333-3333-4333-8333-333333333333" }),
    }),
  );
  assertEquals(actionPayload, { bidId: "33333333-3333-4333-8333-333333333333" });

  const buyPayload = await validateMarketplaceBuyRequest(
    new Request("https://example.com/api/marketplace/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: "44444444-4444-4444-8444-444444444444" }),
    }),
  );
  assertEquals(buyPayload, { appId: "44444444-4444-4444-8444-444444444444" });

  const metricsPayload = await validateMarketplaceMetricsVisibilityRequest(
    new Request("https://example.com/api/marketplace/metrics-visibility", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: "55555555-5555-4555-8555-555555555555",
        show_metrics: false,
      }),
    }),
  );
  assertEquals(metricsPayload, {
    appId: "55555555-5555-4555-8555-555555555555",
    showMetrics: false,
  });

  await assertRejects(
    () =>
      validateMarketplaceMetricsVisibilityRequest(
        new Request("https://example.com/api/marketplace/metrics-visibility", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: "55555555-5555-4555-8555-555555555555",
            show_metrics: "yes",
          }),
        }),
      ),
    RequestValidationError,
    "show_metrics must be a boolean",
  );
});
