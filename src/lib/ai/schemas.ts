import "server-only";
import { z } from "zod";
import { RULE_CATEGORIES } from "@/types/firestore";

// Output schemas for Gemini (Phase 2 section 5). Each has a zod schema (validation, always run)
// and a JSON Schema sent as `responseJsonSchema`. Unknown values are omitted, never guessed.
// Amounts come back as dollar strings and are converted to integer cents without floats.

const quoteFields = {
  quote: z.string().min(1).max(1500),
  page: z.number().int().min(1).max(500),
};

export const aiRuleSchema = z.object({
  category: z.enum(RULE_CATEGORIES),
  label: z.string().min(1).max(160),
  payingParentPct: z.number().min(-1000).max(1000).optional(),
  otherParentPct: z.number().min(-1000).max(1000).optional(),
  sharesNonNumeric: z.boolean().optional(),
  approvalRequired: z.boolean().optional(),
  approvalOperator: z.enum(["gt", "gte"]).optional(),
  approvalThresholdDollars: z.string().max(20).optional(),
  receiptDeadlineDays: z.number().int().min(1).max(3650).optional(),
  receiptDeadlineQuote: z.string().max(1500).optional(),
  receiptDeadlinePage: z.number().int().min(1).max(500).optional(),
  reimburseWithinDays: z.number().int().min(1).max(3650).optional(),
  reimburseQuote: z.string().max(1500).optional(),
  reimbursePage: z.number().int().min(1).max(500).optional(),
  childFirstNames: z.array(z.string().max(40)).max(10).optional(),
  vagueTerms: z.array(z.string().max(40)).max(10).optional(),
  ...quoteFields,
});
export type AiRule = z.infer<typeof aiRuleSchema>;

export const aiExtractionSchema = z.object({
  rules: z.array(aiRuleSchema).max(60),
  parents: z.array(z.object({ name: z.string().min(1).max(80), ...quoteFields })).max(4).optional(),
  children: z.array(z.object({ firstName: z.string().min(1).max(40), birthYear: z.number().int().min(1990).max(2100).optional(), ...quoteFields })).max(10).optional(),
});
export type AiExtraction = z.infer<typeof aiExtractionSchema>;

const str = { type: "string" } as const;
const int = { type: "integer" } as const;
const num = { type: "number" } as const;
const bool = { type: "boolean" } as const;

export const aiExtractionJsonSchema = {
  type: "object",
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: [...RULE_CATEGORIES] },
          label: { ...str, description: "Short human label, e.g. 'Extracurricular activities'" },
          payingParentPct: { ...num, description: "Percent paid by the parent who bought the item, as written" },
          otherParentPct: { ...num, description: "Percent the other parent owes, as written" },
          sharesNonNumeric: { ...bool, description: "true when shares are not fixed numbers, e.g. proportional to income" },
          approvalRequired: { ...bool, description: "true only if the text says prior written approval or consent is needed" },
          approvalOperator: { type: "string", enum: ["gt", "gte"], description: "gt = above/more than/exceeding; gte = or more/at least" },
          approvalThresholdDollars: { ...str, description: "Dollar amount exactly as written, digits only, e.g. '200' or '1500.50'" },
          receiptDeadlineDays: int,
          receiptDeadlineQuote: { ...str, description: "Verbatim sentence that states the receipt deadline" },
          receiptDeadlinePage: int,
          reimburseWithinDays: int,
          reimburseQuote: { ...str, description: "Verbatim sentence that states the reimbursement deadline" },
          reimbursePage: int,
          childFirstNames: { type: "array", items: str, description: "Only if the clause applies to specific children" },
          vagueTerms: { type: "array", items: str, description: "Vague words in the clause, e.g. 'reasonable', 'necessary'" },
          quote: { ...str, description: "Verbatim text copied exactly from the document" },
          page: { ...int, description: "Page number from the PAGE marker where the quote starts" },
        },
        required: ["category", "label", "quote", "page"],
      },
    },
    parents: {
      type: "array",
      items: { type: "object", properties: { name: str, quote: str, page: int }, required: ["name", "quote", "page"] },
    },
    children: {
      type: "array",
      items: { type: "object", properties: { firstName: str, birthYear: int, quote: str, page: int }, required: ["firstName", "quote", "page"] },
    },
  },
  required: ["rules"],
} as const;

export const aiQuickAddSchema = z.object({
  childFirstName: z.string().max(40).nullable().optional(),
  category: z.enum(RULE_CATEGORIES).nullable().optional(),
  amountDollars: z.string().max(20).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  vendor: z.string().max(120).nullable().optional(),
  description: z.string().max(200).nullable().optional(),
  alreadyPurchased: z.boolean().nullable().optional(),
});
export type AiQuickAdd = z.infer<typeof aiQuickAddSchema>;

export const aiQuickAddJsonSchema = {
  type: "object",
  properties: {
    childFirstName: { ...str, description: "One of the allowed child names, or omit" },
    category: { type: "string", enum: [...RULE_CATEGORIES] },
    amountDollars: { ...str, description: "Amount in US dollars as digits, e.g. '350' or '19.99'. Omit if not stated" },
    date: { ...str, description: "YYYY-MM-DD resolved from the text using today's date. Omit if not stated" },
    vendor: str,
    description: { ...str, description: "Short description of what is being bought" },
    alreadyPurchased: { ...bool, description: "true if the text says it was already bought (past tense)" },
  },
} as const;
