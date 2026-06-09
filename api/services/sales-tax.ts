export interface SalesTaxAccrualState {
  balanceLight: number;
  untaxedMonetizedSpendLight: number;
  taxRateBps: number;
}

export interface SalesTaxChargeDecision {
  shouldCharge: boolean;
  taxableAmountLight: number;
  taxRateBps: number;
  taxAmountLight: number;
  triggerBalanceLight: number;
  triggerSpendThresholdLight: number;
}

export const SALES_TAX_BALANCE_TRIGGER_RATIO = 0.20;

export function calculateSalesTaxAmountLight(
  taxableAmountLight: number,
  taxRateBps: number,
): number {
  const taxable = Math.max(0, taxableAmountLight || 0);
  const rate = Math.max(0, taxRateBps || 0);
  return taxable * rate / 10_000;
}

export function decideSalesTaxCharge(
  state: SalesTaxAccrualState,
): SalesTaxChargeDecision {
  const balanceLight = Math.max(0, state.balanceLight || 0);
  const taxableAmountLight = Math.max(0, state.untaxedMonetizedSpendLight || 0);
  const taxRateBps = Math.max(0, Math.trunc(state.taxRateBps || 0));
  const triggerSpendThresholdLight =
    taxableAmountLight * SALES_TAX_BALANCE_TRIGGER_RATIO;
  const taxAmountLight = calculateSalesTaxAmountLight(
    taxableAmountLight,
    taxRateBps,
  );

  return {
    shouldCharge: taxableAmountLight > 0 && taxAmountLight > 0 &&
      balanceLight < triggerSpendThresholdLight,
    taxableAmountLight,
    taxRateBps,
    taxAmountLight,
    triggerBalanceLight: balanceLight,
    triggerSpendThresholdLight,
  };
}
