// Fee line and covered volume (Section G.2). Pure, integer cents only.
// The Family plan covers processing fees up to a monthly covered volume of settled claims.
// Above it, the payer's order carries an estimated fee for the uncovered part, shown before
// checkout. The payout to the owed parent is always exactly owedCents.

export type FeeConfig = { coveredVolumeCents: number; feePercentBps: number; feeFixedCents: number };

export type FeeBreakdown = {
  owedCents: number;
  /** Part of this claim inside this month's covered volume. */
  coveredCents: number;
  uncoveredCents: number;
  feeLineCents: number;
  totalCents: number;
  /** Covered volume left before this claim. */
  coveredRemainingCents: number;
};

export function feeBreakdown(owedCents: number, coveredSoFarCents: number, cfg: FeeConfig): FeeBreakdown {
  if (!Number.isSafeInteger(owedCents) || owedCents <= 0) throw new Error("owedCents must be a positive integer");
  const remaining = Math.max(0, cfg.coveredVolumeCents - Math.max(0, coveredSoFarCents));
  const coveredCents = Math.min(owedCents, remaining);
  const uncoveredCents = owedCents - coveredCents;
  // ceil(uncovered * bps / 10000) in integers.
  const percent = Math.floor((uncoveredCents * cfg.feePercentBps + 9_999) / 10_000);
  const feeLineCents = uncoveredCents > 0 ? percent + cfg.feeFixedCents : 0;
  return { owedCents, coveredCents, uncoveredCents, feeLineCents, totalCents: owedCents + feeLineCents, coveredRemainingCents: remaining };
}

/** usage doc key month (UTC). */
export function usageMonth(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
