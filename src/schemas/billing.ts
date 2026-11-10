import { z } from "zod";

// Phase 4 contracts: checkout, billing, refunds, ledger (Section R.8).

export const orderParams = z.object({
  token: z.string().min(10).max(128),
  orderId: z.string().regex(/^[A-Z0-9]{8,32}$/, "Invalid order id"),
});

/** The browser sends nothing for an order: the amount is the server's (PY-2). Extra keys are ignored. */
export const createOrderSchema = z.object({}).loose();

export const subscriptionActivateSchema = z.object({ subscriptionId: z.string().regex(/^I-[A-Z0-9]{6,40}$/, "Invalid subscription id") }).strict();

export const cancelPlanSchema = z.object({ reason: z.string().trim().max(120).optional() }).strict();

export const ledgerQuerySchema = z.object({
  filter: z.enum(["all", "outstanding", "overdue", "closed", "owed_to_me", "i_owe"]).default("all"),
});
