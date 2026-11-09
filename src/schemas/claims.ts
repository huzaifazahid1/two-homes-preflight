import { z } from "zod";
import { docIdParams } from "./agreement";
import { amountCentsSchema, isoDateSchema } from "./expense";

// Approval, receipt and claim contracts (Phase 3). Shared by forms and route handlers.

const reason = z.string().trim().max(500, "Keep it under 500 characters");

export const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVED"), reason: reason.optional() }).strict(),
  z.object({ decision: z.literal("PARTIALLY_APPROVED"), approvedCents: amountCentsSchema, reason: reason.optional() }).strict(),
  z.object({ decision: z.literal("DECLINED"), reason: reason.optional() }).strict(),
]);
export type DecisionBody = z.infer<typeof decisionSchema>;

export const MATCH_ISSUES = ["OVER_APPROVED", "BEFORE_APPROVAL", "MERCHANT_MISMATCH", "LATE", "POSSIBLE_DUPLICATE"] as const;

export const receiptConfirmSchema = z
  .object({
    merchant: z.string().trim().min(1, "Enter the store name").max(120),
    date: isoDateSchema,
    totalCents: amountCentsSchema,
    /** Issues the parent read and accepts (claim only the approved amount, not a duplicate, right store). */
    acknowledge: z.array(z.enum(MATCH_ISSUES)).max(5).optional(),
  })
  .strict();
export type ReceiptConfirmBody = z.infer<typeof receiptConfirmSchema>;

export const waiveSchema = z.object({ reason: z.string().trim().min(1, "Say why you are waiving it").max(500, "Keep it under 500 characters") }).strict();

export const PAYMENT_METHODS = ["cash", "bank transfer", "check", "PayPal", "Venmo", "Zelle", "other"] as const;

export const externalReportSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS, { error: "Choose how you paid" }),
    date: isoDateSchema,
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const externalActionParams = docIdParams.extend({ action: z.enum(["confirm", "reject"]) });

export const disputeOpenSchema = z
  .object({
    reason: z.string().trim().min(1, "Say what is wrong with the claim").max(1000),
    proposedCents: z.number().int().min(1, "Propose at least $0.01").max(10_000_000).optional(),
  })
  .strict();

export const disputeRespondSchema = z
  .object({
    action: z.enum(["agree", "counter"]),
    reason: z.string().trim().max(1000).optional(),
    proposedCents: z.number().int().min(1).max(10_000_000).optional(),
  })
  .strict();
