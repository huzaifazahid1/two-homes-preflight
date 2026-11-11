// Money is integer cents, USD only. No floats for money anywhere (CLAUDE.md rule 7).
// Safe to import from client components.

export const CURRENCY = "USD" as const;

export function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertCents(value: unknown, label = "amount"): asserts value is number {
  if (!isCents(value)) throw new RangeError(`${label} must be an integer number of cents`);
}

export function assertPositiveCents(value: unknown, label = "amount"): asserts value is number {
  assertCents(value, label);
  if (value <= 0) throw new RangeError(`${label} must be greater than zero`);
}

const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY });

/** 12345 -> "$123.45". Formats from the integer, so no float rounding can creep in. */
export function formatCents(cents: number): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rest = abs % 100;
  // Format the whole-dollar part with grouping, then append the exact cents.
  const whole = formatter.format(dollars).replace(/\.00$/, "");
  return `${negative ? "-" : ""}${whole}.${String(rest).padStart(2, "0")}`;
}

/**
 * Parses user input like "350", "350.5", "$1,200.00" into cents without floats.
 * Returns null for anything that is not a valid non-negative amount with at most 2 decimals.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const dollars = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return dollars * 100 + Number(fraction);
}

/** 12345 -> "123.45" for PayPal API amount values. */
export function centsToDecimalString(cents: number): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "123.45" (PayPal amount value) -> 12345. Throws on malformed input. */
export function decimalStringToCents(value: string): number {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new RangeError(`not a decimal amount: ${value}`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

/**
 * Splits a total into the owed share and the remainder (Section A.6.1).
 * owedPct may have up to 2 decimals (e.g. 62.5 for income-proportional splits);
 * it is converted to basis points so the arithmetic stays integer.
 * The two shares always sum exactly to the total.
 */
export function splitShares(amountCents: number, owedPct: number): { owedShareCents: number; otherShareCents: number } {
  assertCents(amountCents);
  if (!Number.isFinite(owedPct) || owedPct < 0 || owedPct > 100) {
    throw new RangeError("owedPct must be between 0 and 100");
  }
  const bps = Math.round(owedPct * 100);
  const owedShareCents = Math.round((amountCents * bps) / 10_000);
  return { owedShareCents, otherShareCents: amountCents - owedShareCents };
}

export function sumCents(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  return total;
}
