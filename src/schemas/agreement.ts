import { z } from "zod";
import { RULE_CATEGORIES } from "@/types/firestore";

// Agreement upload, rule review and co-parent acknowledgement contracts (Phase 2).

export const docIdParams = z.object({ id: z.string().regex(/^[A-Za-z0-9]{6,32}$/, "Invalid id") });
export const pageParams = docIdParams.extend({ n: z.coerce.number().int().min(1).max(50) });
export const ruleParams = docIdParams.extend({ ruleId: z.string().regex(/^[A-Za-z0-9]{6,32}$/, "Invalid rule id") });

export const pastedAgreementSchema = z
  .object({
    text: z.string().min(1, "Paste the agreement text").max(300_000, "The pasted text is too long"),
    fileName: z.string().trim().max(120).optional(),
  })
  .strict();

export const extractSchema = z
  .object({
    /** "manual" creates an empty draft for manual rule entry (no AI, does not count toward the plan). */
    mode: z.enum(["ai", "manual"]).default("ai"),
  })
  .strict();

export const categorySchema = z.enum(RULE_CATEGORIES);

const pct = z.number().min(0, "Between 0 and 100").max(100, "Between 0 and 100").multipleOf(0.01);
const days = z.number().int().min(1).max(365);

export const approvalSchema = z
  .object({
    required: z.boolean(),
    operator: z.enum(["gt", "gte"]),
    thresholdCents: z.number().int().min(0).max(10_000_000),
  })
  .strict();

/** Values a parent can change on a rule. The quote must still be found in the agreement. */
export const ruleEditSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    owedPct: pct.optional(),
    /** false once the parent entered real percentages for a "proportional to income" clause. */
    sharesNonNumeric: z.boolean().optional(),
    approval: approvalSchema.nullable().optional(),
    receiptDeadlineDays: days.nullable().optional(),
    reimburseWithinDays: days.nullable().optional(),
    childNames: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    quote: z.string().trim().min(8).max(1200).optional(),
    page: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type RuleEdit = z.infer<typeof ruleEditSchema>;

export const rulePatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }).strict(),
  z.object({ action: z.literal("reject") }).strict(),
  z.object({ action: z.literal("undo") }).strict(),
  z.object({ action: z.literal("edit"), changes: ruleEditSchema }).strict(),
]);
export type RulePatch = z.infer<typeof rulePatchSchema>;

export const manualRuleSchema = z
  .object({
    category: categorySchema,
    label: z.string().trim().min(1).max(120),
    owedPct: pct,
    approval: approvalSchema.nullable().optional(),
    receiptDeadlineDays: days.nullable().optional(),
    reimburseWithinDays: days.nullable().optional(),
    childNames: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    quote: z.string().trim().min(8, "Copy the exact sentence from the agreement").max(1200),
    page: z.number().int().min(1).max(50),
  })
  .strict();
export type ManualRule = z.infer<typeof manualRuleSchema>;

export const rulesAckSchema = z
  .object({ perRule: z.record(z.string().max(64), z.enum(["agree", "disagree"])) })
  .strict();
