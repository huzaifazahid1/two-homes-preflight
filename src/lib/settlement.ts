import "server-only";
import { auditInTx } from "@/lib/audit";
import { actorOf, type FamilyContext } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { usageMonth } from "@/lib/fees";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { log } from "@/lib/log";
import { filterNewNotifications, writeNotifications } from "@/lib/notifications";
import { PayPalError, paypalAppError } from "@/lib/paypal/http";
import { getOrder, refundCapture, type CaptureInfo } from "@/lib/paypal/orders";
import { createPayout, getPayoutBatch, payoutEventFor, senderBatchId, type PayoutItemStatus } from "@/lib/paypal/payouts";
import { buildNotices, deliverNotices, type SettlementNotice } from "@/lib/settlement-notices";
import { transition } from "@/lib/state/transition";
import type { Actor, ExpenseDoc, FamilyDoc, PaymentDoc, PayoutAttempt, PayoutDoc, SettlementState } from "@/types/firestore";

// Capture -> payout orchestration (Section G.3, G.4, G.9). Every state change goes through
// transition(); PayPal calls are keyed (G.8) so a retry, a double click, a webhook racing the
// capture response, or reconcile can never capture or pay out twice.

type Meta = { requestId?: string; ip?: string | null; userAgent?: string | null };
export const PAYPAL_ACTOR: Actor = { kind: "paypal" };

const expenseRef = (id: string) => db().collection("expenses").doc(id);
const paymentRef = (id: string) => db().collection("payments").doc(id);
const payoutRef = (id: string) => db().collection("payouts").doc(id);

async function loadExpense(id: string): Promise<ExpenseDoc> {
  const snap = await expenseRef(id).get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "Expense not found.");
  return snap.data() as ExpenseDoc;
}
async function loadFamily(id: string): Promise<FamilyDoc> {
  return (await db().collection("families").doc(id).get()).data() as FamilyDoc;
}

// ---------------- Capture ----------------

export type CaptureOutcome = { state: SettlementState; capture: CaptureInfo["status"] };

/**
 * Applies a capture result from the capture response, a webhook or reconcile. COMPLETED moves
 * AWAITING_PAYMENT -> PAID once (later calls are recorded as noop) and then makes sure a payout
 * exists. PENDING only stores the status (PY-8). DECLINED/FAILED -> PAYMENT_FAILED (PY-7).
 */
export async function applyCapture(expenseId: string, orderId: string | null, capture: CaptureInfo, actor: Actor, meta: Meta = {}): Promise<CaptureOutcome> {
  const e = await loadExpense(expenseId);
  const at = Timestamp.fromDate(now());

  if (capture.status === "PENDING") {
    await paymentRef(expenseId).set({ captureId: capture.id, captureStatus: "PENDING", ...(orderId ? { orderId } : {}), updatedAt: at }, { merge: true });
    return { state: e.settlement.state, capture: "PENDING" };
  }
  if (capture.status === "DECLINED" || capture.status === "FAILED") {
    await paymentRef(expenseId).set({ captureId: capture.id, captureStatus: "DECLINED", updatedAt: at }, { merge: true });
    if (e.settlement.state === "AWAITING_PAYMENT") {
      await transition({ expenseId, machine: "settlement", event: "CAPTURE_FAILED", actor, payload: { extra: { captureId: capture.id } }, ...meta });
    }
    return { state: (await loadExpense(expenseId)).settlement.state, capture: capture.status };
  }
  if (capture.status !== "COMPLETED") return { state: e.settlement.state, capture: capture.status };

  if (e.settlement.state === "PAYMENT_FAILED") {
    // A capture that completed after an earlier decline (the payer chose another card).
    await transition({ expenseId, machine: "settlement", event: "RETRY_PAYMENT", actor, ...meta });
  }

  let payment: PaymentDoc | undefined;
  await transition({
    expenseId,
    machine: "settlement",
    event: "CAPTURE_COMPLETED",
    actor,
    payload: { extra: { captureId: capture.id, capturedCents: capture.amountCents, ...(orderId ? { orderId } : {}) } },
    ...meta,
    loadFacts: async (tx) => {
      payment = (await tx.get(paymentRef(expenseId))).data() as PaymentDoc | undefined;
      // Entitlement was checked when the order was created (402 otherwise). A plan that lapses
      // between checkout and capture must not strand money already taken (SB-6).
      const ours = Boolean(payment?.attempts.some((a) => a.orderId === (orderId ?? payment?.orderId)));
      return { entitled: ours };
    },
    extraWrites: (tx, { expense }) => {
      const attempts = (payment?.attempts ?? []).map((a) => (a.orderId === orderId ? { ...a, status: "COMPLETED" as const } : a));
      const feeLineCents = attempts.find((a) => a.orderId === orderId)?.feeLineCents ?? 0;
      const owed = expense.settlement.owedCents ?? 0;
      if (capture.amountCents !== owed + feeLineCents) {
        log.error("settlement.capture_amount_mismatch", { requestId: meta.requestId, expenseId, captured: capture.amountCents, expected: owed + feeLineCents });
      }
      tx.set(
        paymentRef(expenseId),
        {
          familyId: expense.familyId, expenseId, attempts, ...(orderId ? { orderId } : {}), captureId: capture.id, captureStatus: "COMPLETED",
          capturedCents: capture.amountCents, feeLineCents, paypalFeeCents: capture.paypalFeeCents, netCents: capture.netCents, capturedAt: at, updatedAt: at,
        },
        { merge: true },
      );
      tx.set(db().collection("usage").doc(`${expense.familyId}_${usageMonth(now())}`), { coveredSettledCents: FieldValue.increment(owed) }, { merge: true });
    },
  });

  const payout = await ensurePayout(expenseId, meta);
  return { state: payout.state, capture: "COMPLETED" };
}

// ---------------- Payout ----------------

export type PayoutOutcome = { state: SettlementState; waiting?: "connection" | "platform_balance" | "paypal" };

function receiverFor(family: FamilyDoc, e: ExpenseDoc): Pick<PayoutAttempt, "recipientType" | "receiver"> | null {
  const c = family.payout?.[e.paidByRole];
  if (!c) return null;
  return c.payerId ? { recipientType: "PAYPAL_ID", receiver: c.payerId } : { recipientType: "EMAIL", receiver: c.email };
}

async function notice(kind: SettlementNotice, expenseId: string, version: number | string, meta: Meta) {
  const e = await loadExpense(expenseId);
  const family = await loadFamily(e.familyId);
  const built = buildNotices(kind, family, e.familyId, expenseId, e, version);
  const created = await db().runTransaction(async (tx) => {
    const fresh = await filterNewNotifications(tx, built.map((b) => b.input));
    writeNotifications(tx, fresh);
    return fresh;
  });
  await deliverNotices(built, created, meta.requestId);
}

/**
 * Reserves the payout attempt to use: the current one when PayPal has not accepted it yet (same
 * sender_batch_id, so a retry cannot pay twice), otherwise a new attempt number (`fresh`).
 */
async function reserveAttempt(expenseId: string, e: ExpenseDoc, to: Pick<PayoutAttempt, "recipientType" | "receiver">, fresh: boolean): Promise<{ attempt: PayoutAttempt; index: number }> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(payoutRef(expenseId));
    const at = Timestamp.fromDate(now());
    const doc = snap.data() as PayoutDoc | undefined;
    const attempts = [...(doc?.attempts ?? [])];
    const last = attempts[attempts.length - 1];
    const reusable = last && !last.payoutBatchId && last.status === "CREATED" && last.receiver === to.receiver;
    if (last && (reusable || (last.payoutBatchId && !fresh))) return { attempt: last, index: attempts.length - 1 };
    if (last && !last.payoutBatchId && last.status === "CREATED") attempts[attempts.length - 1] = { ...last, status: "CANCELED", lastError: "RECEIVER_CHANGED" };
    const attempt: PayoutAttempt = { senderBatchId: senderBatchId(expenseId, attempts.length + 1), ...to, amountCents: e.settlement.owedCents ?? 0, status: "CREATED", at };
    attempts.push(attempt);
    tx.set(payoutRef(expenseId), { familyId: e.familyId, expenseId, receiverRole: e.paidByRole, attempts, status: "CREATED", updatedAt: at } satisfies PayoutDoc);
    return { attempt, index: attempts.length - 1 };
  });
}

async function patchAttempt(expenseId: string, senderBatch: string, patch: Partial<PayoutAttempt>) {
  await db().runTransaction(async (tx) => {
    const doc = (await tx.get(payoutRef(expenseId))).data() as PayoutDoc | undefined;
    if (!doc) return;
    const attempts = doc.attempts.map((a) => (a.senderBatchId === senderBatch ? { ...a, ...patch } : a));
    const current = attempts[attempts.length - 1];
    tx.update(payoutRef(expenseId), { attempts, status: current.status, updatedAt: Timestamp.fromDate(now()) });
  });
}

/** Creates the PayPal payout for the reserved attempt. Returns the batch id, or why it is waiting. */
async function sendAttempt(expenseId: string, e: ExpenseDoc, attempt: PayoutAttempt, meta: Meta): Promise<{ batchId: string } | { waiting: NonNullable<PayoutOutcome["waiting"]> }> {
  if (attempt.payoutBatchId) return { batchId: attempt.payoutBatchId };
  try {
    const res = await createPayout({
      senderBatchId: attempt.senderBatchId,
      expenseId,
      amountCents: attempt.amountCents,
      to: attempt,
      note: `Your co-parent's share of ${e.description}.`,
      rejections: attempt.rejections ?? 0,
      requestId: meta.requestId,
    });
    if (!res.payoutBatchId) {
      log.error("payout.duplicate_without_id", { requestId: meta.requestId, expenseId, senderBatchId: attempt.senderBatchId });
      await patchAttempt(expenseId, attempt.senderBatchId, { lastError: "DUPLICATE_UNKNOWN" });
      return { waiting: "paypal" };
    }
    await patchAttempt(expenseId, attempt.senderBatchId, { payoutBatchId: res.payoutBatchId, status: "PENDING", lastError: undefined });
    return { batchId: res.payoutBatchId };
  } catch (err) {
    const issue = err instanceof PayPalError ? (err.network ? "NETWORK" : err.paypalName ?? `HTTP_${err.status}`) : "UNKNOWN";
    if (err instanceof PayPalError && err.has("INSUFFICIENT_FUNDS")) {
      // PY-14: an operator must fund the platform account; reconcile retries the same batch id.
      log.error("payout.insufficient_funds", { requestId: meta.requestId, expenseId, alert: "fund the platform sandbox account" });
      await patchAttempt(expenseId, attempt.senderBatchId, { lastError: "INSUFFICIENT_FUNDS", rejections: (attempt.rejections ?? 0) + 1 });
      return { waiting: "platform_balance" };
    }
    log.error("payout.create_failed", { requestId: meta.requestId, expenseId, issue, error: err });
    const definitive = err instanceof PayPalError && !err.network && err.status >= 400 && err.status < 500;
    await patchAttempt(expenseId, attempt.senderBatchId, { lastError: issue.slice(0, 80), ...(definitive ? { rejections: (attempt.rejections ?? 0) + 1 } : {}) });
    return { waiting: "paypal" };
  }
}

/** After PAID: make sure exactly one payout exists and move to PAYOUT_PROCESSING. Never throws for PayPal problems. */
export async function ensurePayout(expenseId: string, meta: Meta = {}): Promise<PayoutOutcome> {
  const e = await loadExpense(expenseId);
  if (e.settlement.state !== "PAID") return { state: e.settlement.state };
  const family = await loadFamily(e.familyId);
  const to = receiverFor(family, e);
  if (!to) {
    // PC-6: stays PAID with a banner and an email; connecting PayPal triggers the payout.
    await notice("connect_paypal_needed", expenseId, 1, meta);
    return { state: "PAID", waiting: "connection" };
  }
  const { attempt } = await reserveAttempt(expenseId, e, to, false);
  const sent = await sendAttempt(expenseId, e, attempt, meta);
  if ("waiting" in sent) return { state: "PAID", waiting: sent.waiting };
  const r = await transition({ expenseId, machine: "settlement", event: "PAYOUT_CREATED", actor: PAYPAL_ACTOR, payload: { extra: { payoutBatchId: sent.batchId, senderBatchId: attempt.senderBatchId } }, ...meta });
  return { state: r.to };
}

/**
 * A payout status from a webhook or a GET (G.4 step 5). Events for an older attempt are stale and
 * ignored, so a late FAILED for attempt 1 cannot undo a retry.
 */
export async function applyPayoutStatus(expenseId: string, payoutBatchId: string, status: PayoutItemStatus, payoutItemId: string | null, actor: Actor, meta: Meta = {}): Promise<"applied" | "noop" | "stale"> {
  const doc = (await payoutRef(expenseId).get()).data() as PayoutDoc | undefined;
  const current = doc?.attempts[doc.attempts.length - 1];
  if (!current || current.payoutBatchId !== payoutBatchId) return "stale";
  await patchAttempt(expenseId, current.senderBatchId, { status, ...(payoutItemId ? { payoutItemId } : {}), lastCheckedAt: Timestamp.fromDate(now()) });
  const event = payoutEventFor(status);
  if (!event) return "noop";

  let e = await loadExpense(expenseId);
  if (e.settlement.state === "PAID") {
    // The status arrived before our own PAYOUT_CREATED write (webhook racing the create response).
    await transition({ expenseId, machine: "settlement", event: "PAYOUT_CREATED", actor, payload: { extra: { payoutBatchId } }, ...meta });
    e = await loadExpense(expenseId);
  }
  const kind: SettlementNotice = event === "PAYOUT_SUCCESS" ? "settled" : event === "PAYOUT_UNCLAIMED" ? "payout_unclaimed" : "payout_failed";
  const family = await loadFamily(e.familyId);
  let built: ReturnType<typeof buildNotices> = [];
  const r = await transition({
    expenseId, machine: "settlement", event, actor, payload: { extra: { payoutBatchId, payoutStatus: status, ...(payoutItemId ? { payoutItemId } : {}) } }, ...meta,
    notify: ({ expense, version }) => {
      built = buildNotices(kind, family, expense.familyId, expenseId, expense, version);
      return built.map((b) => b.input);
    },
  });
  await deliverNotices(built, r.notifications, meta.requestId);
  return r.outcome;
}

/** GET the current payout batch from PayPal and apply its item status. */
export async function syncPayout(expenseId: string, meta: Meta = {}): Promise<void> {
  const doc = (await payoutRef(expenseId).get()).data() as PayoutDoc | undefined;
  const current = doc?.attempts[doc.attempts.length - 1];
  if (!current?.payoutBatchId) return;
  const batch = await getPayoutBatch(current.payoutBatchId, meta.requestId);
  const status: PayoutItemStatus = batch.batchStatus === "DENIED" ? "DENIED" : batch.item?.status ?? "PENDING";
  await applyPayoutStatus(expenseId, batch.payoutBatchId, status, batch.item?.payoutItemId ?? null, PAYPAL_ACTOR, meta);
}

/** POST /api/expenses/:id/payout/retry (owed parent, after reconnecting PayPal; PY-13). */
export async function retryPayout(ctx: FamilyContext, expenseId: string, meta: Meta = {}): Promise<PayoutOutcome> {
  const e = await loadExpense(expenseId);
  if (e.familyId !== ctx.familyId) throw new AppError("FORBIDDEN", "This expense belongs to another family.");
  if (actorOf(ctx).kind !== e.paidByRole) throw new AppError("FORBIDDEN", "Only the parent who is owed can retry the payout.");
  if (e.settlement.state === "PAID") return ensurePayout(expenseId, meta);
  if (e.settlement.state !== "PAYOUT_FAILED") throw new AppError("STATE_CONFLICT", "There is no failed payout to retry.");
  const to = receiverFor(ctx.family, e);
  if (!to) throw new AppError("STATE_CONFLICT", "Connect your PayPal account first.");
  const { attempt } = await reserveAttempt(expenseId, e, to, true);
  const sent = await sendAttempt(expenseId, e, attempt, meta);
  if ("waiting" in sent) {
    throw new AppError("UPSTREAM_FAILED", sent.waiting === "platform_balance" ? "The payout could not be sent yet. We will retry it automatically." : "PayPal did not accept the payout. Please try again in a few minutes.");
  }
  const r = await transition({ expenseId, machine: "settlement", event: "RETRY_PAYOUT", actor: actorOf(ctx), payload: { extra: { payoutBatchId: sent.batchId, senderBatchId: attempt.senderBatchId } }, ...meta });
  return { state: r.to };
}

/** POST /api/expenses/:id/refund: refund the payer after a failed payout [Should] (PY-16). */
export async function refundPayer(ctx: FamilyContext, expenseId: string, meta: Meta = {}): Promise<{ state: SettlementState }> {
  const e = await loadExpense(expenseId);
  if (e.familyId !== ctx.familyId) throw new AppError("FORBIDDEN", "This expense belongs to another family.");
  if (e.settlement.state !== "PAYOUT_FAILED") throw new AppError("STATE_CONFLICT", "A refund is only possible after a failed payout.");
  const pay = (await paymentRef(expenseId).get()).data() as PaymentDoc | undefined;
  if (!pay?.captureId) throw new AppError("STATE_CONFLICT", "No captured payment was found for this expense.");
  let refund: { refundId: string; status: string };
  try {
    refund = await refundCapture(pay.captureId, { invoiceId: `${expenseId}-refund`, note: `Refund of your share of ${e.description}.`, requestId: meta.requestId });
  } catch (err) {
    throw paypalAppError(err);
  }
  const at = Timestamp.fromDate(now());
  const r = await transition({
    expenseId, machine: "settlement", event: "REFUND_PAYER", actor: actorOf(ctx), payload: { extra: { refundId: refund.refundId } }, ...meta,
    extraWrites: (tx) => {
      tx.set(paymentRef(expenseId), { captureStatus: "REFUNDED", refund: { ...refund, at }, updatedAt: at }, { merge: true });
    },
  });
  return { state: r.to };
}

/** Timeline note + audit for things that change no state (refund/reversal after success, disputes). */
export async function recordPayPalNote(expenseId: string, type: string, data: Record<string, string | number | boolean>) {
  const e = await loadExpense(expenseId);
  await db().runTransaction(async (tx) => {
    tx.create(expenseRef(expenseId).collection("events").doc(), { type, machine: "note", from: e.settlement.state, to: e.settlement.state, actor: PAYPAL_ACTOR, data, at: Timestamp.fromDate(now()) });
    auditInTx(tx, { familyId: e.familyId, actor: PAYPAL_ACTOR, action: type, target: `expenses/${expenseId}` });
  });
}

// ---------------- Reconcile ----------------

const RECONCILABLE: ReadonlySet<SettlementState> = new Set(["AWAITING_PAYMENT", "PAYMENT_FAILED", "PAID", "PAYOUT_PROCESSING", "PAYOUT_UNCLAIMED"]);

/** Re-reads PayPal and applies what is missing (Section G.9). Authorization is the caller's job. */
export async function reconcileExpense(expenseId: string, meta: Meta = {}): Promise<{ state: SettlementState; checked: string[] }> {
  const checked: string[] = [];
  let e = await loadExpense(expenseId);
  if (!RECONCILABLE.has(e.settlement.state)) return { state: e.settlement.state, checked };
  try {
    if (e.settlement.state === "AWAITING_PAYMENT" || e.settlement.state === "PAYMENT_FAILED") {
      const pay = (await paymentRef(expenseId).get()).data() as PaymentDoc | undefined;
      const orderId = pay?.orderId ?? pay?.attempts[pay.attempts.length - 1]?.orderId;
      if (orderId) {
        checked.push("order");
        const order = await getOrder(orderId, meta.requestId);
        if (order.capture) await applyCapture(expenseId, orderId, order.capture, PAYPAL_ACTOR, meta);
      }
    }
    e = await loadExpense(expenseId);
    if (e.settlement.state === "PAID") {
      checked.push("payout_create");
      await ensurePayout(expenseId, meta);
    } else if (e.settlement.state === "PAYOUT_PROCESSING" || e.settlement.state === "PAYOUT_UNCLAIMED") {
      checked.push("payout_status");
      await syncPayout(expenseId, meta);
    }
  } catch (err) {
    throw paypalAppError(err);
  }
  return { state: (await loadExpense(expenseId)).settlement.state, checked };
}
