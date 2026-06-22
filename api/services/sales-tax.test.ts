import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  computeSalesTaxLight,
  isSalesTaxConfigured,
  resolveSalesTaxRateBps,
} from "./sales-tax.ts";

Deno.test("computeSalesTaxLight: basis-point tax in fractional Light", () => {
  assertEquals(computeSalesTaxLight(1000, 725), 72.5);
  assertEquals(computeSalesTaxLight(33.33, 2000), 6.666);
});

Deno.test("computeSalesTaxLight: zero rate or zero base yields no tax", () => {
  assertEquals(computeSalesTaxLight(1000, 0), 0);
  assertEquals(computeSalesTaxLight(0, 725), 0);
  assertEquals(computeSalesTaxLight(-50, 725), 0);
  assertEquals(computeSalesTaxLight(1000, -10), 0);
});

Deno.test("resolveSalesTaxRateBps: unconfigured location is not taxed", () => {
  // The shipped table is empty (collect only where registered), so every
  // location resolves to 0 until the business adds a jurisdiction.
  assertEquals(resolveSalesTaxRateBps(null), 0);
  assertEquals(resolveSalesTaxRateBps({ country: "US", state: "CA" }), 0);
  assertEquals(resolveSalesTaxRateBps({ country: "us" }), 0);
  assertEquals(resolveSalesTaxRateBps({ country: "" }), 0);
});

Deno.test("isSalesTaxConfigured: false with the default empty table", () => {
  // Guards the hot-path gate: an empty table means settlement never reads the
  // buyer's billing address or debits tax.
  assertEquals(isSalesTaxConfigured(), false);
});
