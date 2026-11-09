import { z } from "zod";
import { categorySchema } from "./agreement";

// Expense, preflight and quick add contracts (Phase 2). Money is integer cents (rule 8).

export const MAX_AMOUNT_CENTS = 10_000_000; // $100,000

export const amountCentsSchema = z
  .number({ error: "Enter an amount" })
  .int("Enter the amount in cents")
  .positive("Enter an amount greater than $0")
  .max(MAX_AMOUNT_CENTS, "The amount cannot be more than $100,000");

/** Calendar date "YYYY-MM-DD" in the user's time zone. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date");

const base = {
  childId: z.string().regex(/^[A-Za-z0-9]{6,32}$/, "Choose a child"),
  category: categorySchema,
  description: z.string().trim().min(1, "Describe the expense").max(200, "Keep it under 200 characters"),
  vendor: z.string().trim().max(120).optional(),
  amountCents: amountCentsSchema,
  currency: z.literal("USD", { error: "Only US dollars (USD) are supported" }).default("USD"),
  mode: z.enum(["planned", "purchased"]),
  /** Planned date (mode planned) or purchase date (mode purchased). */
  date: isoDateSchema.optional(),
  paidByRole: z.enum(["owner", "coparent"]),
};

export const preflightSchema = z.object(base).strict();
export type PreflightInput = z.infer<typeof preflightSchema>;

export const expenseCreateSchema = z
  .object({
    ...base,
    /** Set after the user saw the duplicate warning and confirmed (PF-7). */
    confirmDuplicate: z.boolean().optional(),
  })
  .strict();
export type ExpenseCreate = z.infer<typeof expenseCreateSchema>;

export const expensePatchSchema = z
  .object({
    childId: base.childId.optional(),
    category: categorySchema.optional(),
    description: base.description.optional(),
    vendor: z.string().trim().max(120).nullable().optional(),
    amountCents: amountCentsSchema.optional(),
    mode: base.mode.optional(),
    date: isoDateSchema.nullable().optional(),
    paidByRole: base.paidByRole.optional(),
    /** Optimistic concurrency: the version the user edited. */
    version: z.number().int().positive(),
  })
  .strict();
export type ExpensePatch = z.infer<typeof expensePatchSchema>;

export const expenseListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  before: z.iso.datetime().optional(),
});

export const quickAddSchema = z.object({ text: z.string().trim().min(3, "Type a short description").max(500) }).strict();

/** What quick add returns to the form. Unknown values are null and the form leaves them empty. */
export const quickAddResultSchema = z.object({
  childId: z.string().nullable(),
  category: categorySchema.nullable(),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS).nullable(),
  date: isoDateSchema.nullable(),
  vendor: z.string().max(120).nullable(),
  description: z.string().max(200).nullable(),
  mode: z.enum(["planned", "purchased"]).nullable(),
});
export type QuickAddResult = z.infer<typeof quickAddResultSchema>;
