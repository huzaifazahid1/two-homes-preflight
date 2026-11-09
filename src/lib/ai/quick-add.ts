import "server-only";
import type { FamilyContext } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { parseDollarsToCents } from "@/lib/money";
import { MAX_AMOUNT_CENTS, quickAddResultSchema, type QuickAddResult } from "@/schemas";
import { RULE_CATEGORIES } from "@/types/firestore";
import { AiError, generateJson } from "./gemini";
import { QUICK_ADD_SYSTEM, quickAddUserPrompt } from "./prompts";
import { aiQuickAddJsonSchema, aiQuickAddSchema } from "./schemas";

// AI quick add (PF-10, PF-11): fills the form only. The verdict is computed after the parent
// reviews the fields. Values the note does not contain are returned as null (left empty).

export function todayIn(timeZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function mentions(text: string, word: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu").test(text);
}

/** Digits of the amount must appear in the note: a model never invents an amount here. */
function amountMentioned(text: string, cents: number): boolean {
  const whole = String(Math.trunc(cents / 100));
  const plain = text.replace(/,/g, "");
  return new RegExp(`(^|[^\\d])${whole}([^\\d]|$)`).test(plain);
}

export async function quickAdd(ctx: FamilyContext, text: string, requestId?: string): Promise<QuickAddResult> {
  const at = now();
  const tz = ctx.userDoc.timeZone || "UTC";
  const children = ctx.family.children;
  let data;
  try {
    ({ data } = await generateJson({
      label: "quick_add",
      system: QUICK_ADD_SYSTEM,
      prompt: quickAddUserPrompt({ text, today: todayIn(tz, at), timeZone: tz, children: children.map((c) => c.firstName), categories: RULE_CATEGORIES }),
      jsonSchema: aiQuickAddJsonSchema,
      schema: aiQuickAddSchema,
      requestId,
      maxOutputTokens: 1024,
      thinking: "MINIMAL",
    }));
  } catch (err) {
    if (err instanceof AiError) {
      throw new AppError("UPSTREAM_FAILED", `${err.message} Fill in the form instead.`, { details: { reason: err.reason }, cause: err });
    }
    throw err;
  }

  const child = data.childFirstName ? children.find((c) => c.firstName.toLowerCase() === data.childFirstName!.trim().toLowerCase()) : undefined;
  const cents = data.amountDollars ? parseDollarsToCents(data.amountDollars) : null;
  const result = {
    childId: child && mentions(text, child.firstName) ? child.id : null,
    category: data.category ?? null,
    amountCents: cents !== null && cents > 0 && cents <= MAX_AMOUNT_CENTS && amountMentioned(text, cents) ? cents : null,
    date: data.date ?? null,
    vendor: data.vendor?.trim().slice(0, 120) || null,
    description: data.description?.trim().slice(0, 200) || null,
    mode: data.alreadyPurchased === true ? ("purchased" as const) : data.alreadyPurchased === false ? ("planned" as const) : null,
  };
  return quickAddResultSchema.parse(result);
}
