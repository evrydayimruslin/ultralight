import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  calculateSalesTaxAmountLight,
  decideSalesTaxCharge,
} from "./sales-tax.ts";

Deno.test("sales tax: calculates basis-point tax in Light", () => {
  assertEquals(calculateSalesTaxAmountLight(1000, 725), 72.5);
});

Deno.test("sales tax: triggers when balance drops below 20% of untaxed spend", () => {
  const decision = decideSalesTaxCharge({
    balanceLight: 199,
    untaxedMonetizedSpendLight: 1000,
    taxRateBps: 725,
  });

  assertEquals(decision.shouldCharge, true);
  assertEquals(decision.triggerSpendThresholdLight, 200);
  assertEquals(decision.taxAmountLight, 72.5);
});

Deno.test("sales tax: does not trigger while balance is at threshold", () => {
  const decision = decideSalesTaxCharge({
    balanceLight: 200,
    untaxedMonetizedSpendLight: 1000,
    taxRateBps: 725,
  });

  assertEquals(decision.shouldCharge, false);
});
