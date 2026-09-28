export function calculateReferralEarningAmountRub(paymentAmountRub, rateBps) {
  const normalizedAmount = Number(paymentAmountRub || 0);

  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
    return 0;
  }

  return Math.trunc((normalizedAmount * rateBps) / 10_000);
}

export function resolveReferralRollbackPolicy({ amountRub, amountReversedFromAvailableRub }) {
  const normalizedAmount = Number(amountRub || 0);
  const normalizedAvailableReversal = Number(amountReversedFromAvailableRub || 0);
  const manualReviewDebtAmountRub = Math.max(normalizedAmount - normalizedAvailableReversal, 0);

  return {
    rollbackPolicy: manualReviewDebtAmountRub > 0 ? "manual_review_debt" : "available_reversal",
    manualReviewDebtAmountRub,
  };
}

export function resolveWithdrawalRejectedReserveReleasePolicy({
  amountRub,
  manualReviewDebtAmountRub,
  manualReviewReservedDebtAmountRub,
}) {
  const normalizedAmount = Number(amountRub || 0);
  const normalizedManualReviewDebt = Number(manualReviewDebtAmountRub || 0);
  const normalizedReservedDebt = Number(manualReviewReservedDebtAmountRub || 0);
  const amountSettledToManualReviewDebtRub = Math.min(
    Math.max(normalizedAmount, 0),
    Math.max(normalizedManualReviewDebt, 0),
    Math.max(normalizedReservedDebt, 0),
  );

  return {
    amountReleasedToAvailableRub: Math.max(normalizedAmount - amountSettledToManualReviewDebtRub, 0),
    amountSettledToManualReviewDebtRub,
    remainingManualReviewDebtAmountRub: Math.max(
      normalizedManualReviewDebt - amountSettledToManualReviewDebtRub,
      0,
    ),
    remainingManualReviewReservedDebtAmountRub: Math.max(
      normalizedReservedDebt - amountSettledToManualReviewDebtRub,
      0,
    ),
  };
}

export function calculateVisibleTokenBalanceAfterReversal(currentBalance, tokenGrant) {
  return Number(currentBalance || 0) - Number(tokenGrant || 0);
}
