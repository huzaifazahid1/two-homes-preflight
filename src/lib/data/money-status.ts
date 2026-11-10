import "server-only";
import { now } from "@/lib/clock";
import { db } from "@/lib/firebase/admin";
import { log } from "@/lib/log";
import { toMs } from "@/lib/state/effective";
import type { ExpenseDoc, FamilyDoc, PaymentDoc, PayoutDoc } from "@/types/firestore";

// What the expense page shows about in-app money (Section G.4): capture, payout batch, and why a
// payout is waiting. Server-only facts (payments/payouts docs) reduced to display fields.

export type MoneyStatus = {
  captured: { cents: number; feeLineCents: number; paypalFeeCents: number | null } | null;
  payout: { batchId: string | null; status: string; attempt: number; receiver: string } | null;
  waiting: "connection" | "platform_balance" | "paypal" | null;
  receiverConnected: boolean;
};

export async function moneyStatus(expenseId: string, e: ExpenseDoc, family: FamilyDoc): Promise<MoneyStatus | null> {
  if (!["PAID", "PAYOUT_PROCESSING", "PAYOUT_UNCLAIMED", "PAYOUT_FAILED", "SETTLED", "REFUNDED"].includes(e.settlement.state)) return null;
  const [p, o] = await Promise.all([db().collection("payments").doc(expenseId).get(), db().collection("payouts").doc(expenseId).get()]);
  const pay = p.data() as PaymentDoc | undefined;
  const out = o.data() as PayoutDoc | undefined;
  const last = out?.attempts[out.attempts.length - 1];
  const connected = Boolean(family.payout?.[e.paidByRole]);
  return {
    captured: pay?.capturedCents != null ? { cents: pay.capturedCents, feeLineCents: pay.feeLineCents ?? 0, paypalFeeCents: pay.paypalFeeCents ?? null } : null,
    payout: last ? { batchId: last.payoutBatchId ?? null, status: last.status, attempt: out!.attempts.length, receiver: last.recipientType === "EMAIL" ? last.receiver : "PayPal account" } : null,
    waiting: e.settlement.state !== "PAID" ? null : !connected ? "connection" : last?.lastError === "INSUFFICIENT_FUNDS" ? "platform_balance" : "paypal",
    receiverConnected: connected,
  };
}

const STALE_MS = 60_000;

/** G.4 step 5: on the expense view, re-read a processing payout from PayPal if older than 60 s. */
export async function refreshPayoutIfStale(expenseId: string, e: ExpenseDoc, requestId?: string): Promise<boolean> {
  if (e.settlement.state !== "PAYOUT_PROCESSING" && e.settlement.state !== "PAYOUT_UNCLAIMED") return false;
  const out = (await db().collection("payouts").doc(expenseId).get()).data() as PayoutDoc | undefined;
  const last = out?.attempts[out.attempts.length - 1];
  if (!last?.payoutBatchId) return false;
  const checked = toMs(last.lastCheckedAt) ?? toMs(last.at) ?? 0;
  if (now().getTime() - checked < STALE_MS) return false;
  try {
    const { syncPayout } = await import("@/lib/settlement");
    await syncPayout(expenseId, { requestId });
    return true;
  } catch (err) {
    // The page still renders the stored state; webhooks and the daily job keep trying.
    log.warn("payout.view_refresh_failed", { requestId, expenseId, error: err });
    return false;
  }
}
