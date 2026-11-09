import "server-only";
import { z } from "zod";
import { centsToDecimalString, CURRENCY, decimalStringToCents } from "@/lib/money";
import { PayPalError, paypalRequest } from "./http";

// Payouts API through http.ts (Section G.4; the Server SDK has no Payouts controller).
// sender_batch_id = {expenseId}-{payoutAttempt}: PayPal refuses a second batch with the same id,
// so a retry after a timeout can never pay twice (PY-11). PayPal-Request-Id is
// payout-{sender_batch_id}[-{n}]: the same key after a timeout (PayPal answers with the original
// response), a new key after a definitive rejection (e.g. INSUFFICIENT_FUNDS), which created no
// batch and would otherwise be replayed from PayPal's idempotency cache.

export type PayoutItemStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "UNCLAIMED" | "FAILED" | "RETURNED" | "BLOCKED" | "REFUNDED" | "HELD" | "CANCELED" | "DENIED";

export function senderBatchId(expenseId: string, attempt: number) {
  return `${expenseId}-${attempt}`;
}

/** Expense id from a sender_batch_id (expense ids never contain "-"). */
export function expenseIdFromBatch(senderBatch: string): string | null {
  const i = senderBatch.lastIndexOf("-");
  return i > 0 ? senderBatch.slice(0, i) : null;
}

const createdSchema = z.object({
  batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string() }).loose(),
}).loose();

export type PayoutReceiver = { recipientType: "PAYPAL_ID" | "EMAIL"; receiver: string };

export type CreatePayoutResult =
  | { kind: "created"; payoutBatchId: string; batchStatus: string }
  /** PayPal already has a batch with this sender_batch_id; its id when PayPal linked it. */
  | { kind: "duplicate"; payoutBatchId: string | null };

const BATCH_ID_IN_LINK = /\/v1\/payments\/payouts\/([A-Z0-9]+)/;

/** POST /v1/payments/payouts with one item. Throws PayPalError for other failures. */
export async function createPayout(input: {
  senderBatchId: string;
  expenseId: string;
  amountCents: number;
  to: PayoutReceiver;
  note: string;
  /** Definitive rejections of this sender_batch_id so far. */
  rejections?: number;
  requestId?: string;
}): Promise<CreatePayoutResult> {
  try {
    const { data } = await paypalRequest(
      {
        method: "POST",
        path: "/v1/payments/payouts",
        headers: { "PayPal-Request-Id": input.rejections ? `payout-${input.senderBatchId}-${input.rejections}` : `payout-${input.senderBatchId}` },
        idempotent: true,
        requestId: input.requestId,
        body: {
          sender_batch_header: {
            sender_batch_id: input.senderBatchId,
            email_subject: "You received a reimbursement through Two Homes Preflight",
            email_message: "Your co-parent's share of a child expense was sent to you.",
          },
          items: [
            {
              recipient_type: input.to.recipientType,
              receiver: input.to.receiver,
              amount: { value: centsToDecimalString(input.amountCents), currency: CURRENCY },
              note: input.note.slice(0, 4000),
              sender_item_id: input.expenseId,
            },
          ],
        },
      },
      createdSchema,
    );
    return { kind: "created", payoutBatchId: data.batch_header.payout_batch_id, batchStatus: data.batch_header.batch_status };
  } catch (e) {
    // [Confirm 6] Exact sandbox shape: USER_BUSINESS_ERROR / DUPLICATE_REQUEST_ID with a link to the existing batch.
    if (e instanceof PayPalError && (e.has("DUPLICATE_REQUEST_ID") || e.has("SENDER_BATCH_ID_ALREADY_USED") || /sender_batch_id/i.test(e.issues.join(" ")))) {
      const link = e.links.map((l) => BATCH_ID_IN_LINK.exec(l)?.[1]).find(Boolean) ?? null;
      return { kind: "duplicate", payoutBatchId: link };
    }
    throw e;
  }
}

const batchSchema = z
  .object({
    batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string(), sender_batch_header: z.object({ sender_batch_id: z.string() }).loose().optional() }).loose(),
    items: z
      .array(
        z
          .object({
            payout_item_id: z.string(),
            transaction_status: z.string().optional(),
            payout_item: z.object({ sender_item_id: z.string().optional(), amount: z.object({ value: z.string(), currency: z.string() }).optional() }).loose().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

export type PayoutBatchInfo = { payoutBatchId: string; batchStatus: string; item: { payoutItemId: string; status: PayoutItemStatus; amountCents: number | null } | null };

const ITEM_STATUS: Record<string, PayoutItemStatus> = {
  SUCCESS: "SUCCESS", UNCLAIMED: "UNCLAIMED", FAILED: "FAILED", RETURNED: "RETURNED", BLOCKED: "BLOCKED", REFUNDED: "REFUNDED",
  ONHOLD: "HELD", HELD: "HELD", CANCELED: "CANCELED", DENIED: "DENIED", PENDING: "PENDING", NEW: "PENDING", PROCESSING: "PROCESSING",
};

export function itemStatus(raw: string | undefined): PayoutItemStatus {
  return ITEM_STATUS[(raw ?? "PENDING").toUpperCase()] ?? "PENDING";
}

/** GET /v1/payments/payouts/{payout_batch_id}. */
export async function getPayoutBatch(payoutBatchId: string, requestId?: string): Promise<PayoutBatchInfo> {
  const { data } = await paypalRequest({ method: "GET", path: `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`, idempotent: true, requestId }, batchSchema);
  const it = data.items?.[0];
  return {
    payoutBatchId: data.batch_header.payout_batch_id,
    batchStatus: data.batch_header.batch_status,
    item: it
      ? {
          payoutItemId: it.payout_item_id,
          status: itemStatus(it.transaction_status),
          amountCents: it.payout_item?.amount ? decimalStringToCents(it.payout_item.amount.value) : null,
        }
      : null,
  };
}

/** Where a payout item status moves the settlement machine (Section G.7). null = stay. */
export function payoutEventFor(status: PayoutItemStatus): "PAYOUT_SUCCESS" | "PAYOUT_UNCLAIMED" | "PAYOUT_FAILED" | null {
  switch (status) {
    case "SUCCESS":
      return "PAYOUT_SUCCESS";
    case "UNCLAIMED":
      return "PAYOUT_UNCLAIMED";
    case "FAILED":
    case "RETURNED":
    case "BLOCKED":
    case "CANCELED":
    case "REFUNDED":
    case "DENIED":
      return "PAYOUT_FAILED";
    default:
      return null;
  }
}
