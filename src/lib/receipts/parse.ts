import "server-only";
import { AiError, generateJson } from "@/lib/ai/gemini";
import { RECEIPT_PROMPT, RECEIPT_SYSTEM } from "@/lib/ai/prompts";
import { aiReceiptJsonSchema, aiReceiptSchema } from "@/lib/ai/schemas";
import { parseDollarsToCents } from "@/lib/money";
import { MAX_AMOUNT_CENTS } from "@/schemas/expense";
import type { ReceiptDoc } from "@/types/firestore";

// Gemini reads merchant, date, total and line items (A.6.2: AI reads receipts, nothing more).
// A failure is not an error for the user: the receipt is stored and they type the values (RC-7).

export type ParseOutcome =
  | { status: "parsed"; parsed: NonNullable<ReceiptDoc["parsed"]> }
  | { status: "failed"; reason: "unreadable" | "not_configured" | "timeout" | "invalid_output" | "unavailable" | "blocked" };

function cents(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const c = parseDollarsToCents(value);
  return c !== null && c > 0 && c <= MAX_AMOUNT_CENTS ? c : undefined;
}

export async function parseReceipt(input: { bytes: Uint8Array; mimeType: string; requestId?: string }): Promise<ParseOutcome> {
  let data;
  try {
    ({ data } = await generateJson({
      label: "receipt",
      system: RECEIPT_SYSTEM,
      prompt: RECEIPT_PROMPT,
      inline: { mimeType: input.mimeType, data: Buffer.from(input.bytes).toString("base64") },
      jsonSchema: aiReceiptJsonSchema,
      schema: aiReceiptSchema,
      requestId: input.requestId,
      maxOutputTokens: 2048,
      thinking: "MINIMAL",
    }));
  } catch (err) {
    if (err instanceof AiError) return { status: "failed", reason: err.reason };
    throw err;
  }
  const totalCents = cents(data.totalDollars);
  if (!data.readable || totalCents === undefined) return { status: "failed", reason: "unreadable" };
  const lineItems = (data.lineItems ?? [])
    .map((l) => ({ label: l.label.trim().slice(0, 120), amountCents: cents(l.amountDollars) }))
    .filter((l): l is { label: string; amountCents: number } => l.label.length > 0 && l.amountCents !== undefined);
  return {
    status: "parsed",
    parsed: {
      ...(data.merchant?.trim() ? { merchant: data.merchant.trim().slice(0, 120) } : {}),
      ...(data.date ? { date: data.date } : {}),
      totalCents,
      ...(lineItems.length ? { lineItems } : {}),
      confidence: Math.round(data.confidence * 100) / 100,
    },
  };
}
