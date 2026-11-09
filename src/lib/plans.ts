// Family plan terms shown in the UI and used by scripts/setup-paypal-plans.ts.
// [Confirm 1] Illustrative sandbox pricing: $7.99/month, 14-day trial. The covered volume is
// server config (PLAN_COVERED_VOLUME_CENTS) and reaches the UI through GET /api/billing.
// Client-safe: no env, no secrets.

export const FAMILY_PRICE_CENTS = 799;
export const FAMILY_TRIAL_DAYS = 14;
export const PLAN_NAME = "Two Homes Preflight Family";
