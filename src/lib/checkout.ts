import "server-only";
import type { SessionUser } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { familyEntitledFresh } from "@/lib/entitlement";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { feeBreakdown, usageMonth, type FeeBreakdown } from "@/lib/fees";
import { db, Timestamp } from "@/lib/firebase/admin";
import { requireLinkActor } from "@/lib/links/actor";
import { assertAction, hashToken, isWellFormedToken, resolveLinkHash } from "@/lib/links/tokens";
import { log } from "@/lib/log";
import { PayPalError, paypalAppError } from "@/lib/paypal/http";
import { captureOrder, createOrder, getOrder, orderRequestId, type OrderInfo } from "@/lib/paypal/orders";
import { applyCapture } from "@/lib/settlement";
import { transition } from "@/lib/state/transition";
import type { ExpenseDoc, PaymentAttempt, PaymentDoc, SettlementState, UsageDoc } from "@/types/firestore";

// The paying parent's checkout on /p/[token] (Section G.3). The amount always comes from the
// server (PY-2); the browser sends nothing but the order id it got from us.

type Meta = { requestId?: string; ip?: string | null; userAgent?: string | null };
type Auth = { linkSession: { tokenHash: string } | null; user: SessionUser | null };

const PAYABLE: ReadonlySet<SettlementState> = new Set(["AWAITING_PAYMENT", "PAYMENT_FAILED"]);
const paymentRef = (id: string) => db().collection("payments").doc(id);

async function payerContext(token: string, auth: Auth) {
  if (!isWellFormedToken(token)) throw new AppError("NOT_FOUND", "This link is not valid.");
  const tokenHash = hashToken(token);
  const { link } = await resolveLinkHash(tokenHash);
  if (link.purpose !== "payment" || !link.resourcePath.startsWith("expenses/")) throw new AppError("NOT_FOUND", "This link is not a payment link.");
  assertAction(link, "pay");
  const actor = await requireLinkActor(auth, tokenHash, link);
  const expenseId = link.resourcePath.slice("expenses/".length);
  const snap = await db().collection("expenses").doc(expenseId).get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "Expense not found.");
  return { link, actor, expenseId, expense: snap.data() as ExpenseDoc };
}

export function feeConfig() {
  const e = env();
  return { coveredVolumeCents: e.PLAN_COVERED_VOLUME_CENTS, feePercentBps: e.FEE_PERCENT_BPS, feeFixedCents: e.FEE_FIXED_CENTS };
}

/** The breakdown shown before checkout and charged in the order (PY-15). */
export async function breakdownFor(familyId: string, owedCents: number): Promise<FeeBreakdown> {
  const usage = (await db().collection("usage").doc(`${familyId}_${usageMonth(now())}`).get()).data() as UsageDoc | undefined;
  return feeBreakdown(owedCents, usage?.coveredSettledCents ?? 0, feeConfig());
}

/** POST /api/links/:token/orders. */
export async function createCheckoutOrder(token: string, auth: Auth, meta: Meta = {}): Promise<{ orderId: string; breakdown: FeeBreakdown }> {
  const { actor, expenseId, expense: e } = await payerContext(token, auth);
  if (e.settlement.state === "DISPUTED") throw new AppError("STATE_CONFLICT", "This claim is disputed. It can be paid after you both agree.");
  if (!PAYABLE.has(e.settlement.state)) throw new AppError("STATE_CONFLICT", "This claim cannot be paid right now.", { details: { state: e.settlement.state } });
  // Invariant 9 / PY-3 / SB-4: no order without the Family plan.
  if (!(await familyEntitledFresh(e.familyId, meta.requestId))) throw new AppError("PLAN_REQUIRED", "Paying in the app is part of the Family plan. You can pay any other way and report it here.");
  const owed = e.settlement.owedCents;
  if (!owed || owed <= 0) throw new AppError("STATE_CONFLICT", "This claim has no amount to pay.");

  const pay = (await paymentRef(expenseId).get()).data() as PaymentDoc | undefined;
  if (pay?.captureStatus === "COMPLETED" || pay?.captureStatus === "PENDING") throw new AppError("STATE_CONFLICT", "A payment for this claim is already with PayPal. Refresh the page.");
  const breakdown = await breakdownFor(e.familyId, owed);
  // Concurrent clicks compute the same attempt number, so PayPal-Request-Id returns one order.
  const attempt = (pay?.attempts.length ?? 0) + 1;

  let order: OrderInfo;
  try {
    order = await createOrder({ expenseId, attempt, amountCents: breakdown.totalCents, description: e.description, requestId: meta.requestId });
  } catch (err) {
    throw paypalAppError(err);
  }

  if (e.settlement.state === "PAYMENT_FAILED") {
    await transition({ expenseId, machine: "settlement", event: "RETRY_PAYMENT", actor, payload: { extra: { orderId: order.orderId } }, ...meta });
  }
  await db().runTransaction(async (tx) => {
    const cur = (await tx.get(paymentRef(expenseId))).data() as PaymentDoc | undefined;
    const attempts = cur?.attempts ?? [];
    if (attempts.some((a) => a.orderId === order.orderId)) return;
    const row: PaymentAttempt = { orderId: order.orderId, requestId: orderRequestId(expenseId, attempt), status: "CREATED", amountCents: breakdown.totalCents, feeLineCents: breakdown.feeLineCents, at: Timestamp.fromDate(now()) };
    tx.set(paymentRef(expenseId), { familyId: e.familyId, expenseId, attempts: [...attempts, row], updatedAt: Timestamp.fromDate(now()) }, { merge: true });
  });
  log.info("checkout.order_created", { requestId: meta.requestId, expenseId, attempt, feeLineCents: breakdown.feeLineCents });
  return { orderId: order.orderId, breakdown };
}

export type CaptureResult = { state: SettlementState; status: "COMPLETED" | "PENDING" | "DECLINED" };

/** POST /api/links/:token/orders/:orderId/capture. Safe to call twice (PY-5). */
export async function captureCheckoutOrder(token: string, orderId: string, auth: Auth, meta: Meta = {}): Promise<CaptureResult> {
  const { actor, expenseId, expense: e } = await payerContext(token, auth);
  const pay = (await paymentRef(expenseId).get()).data() as PaymentDoc | undefined;
  const attempt = pay?.attempts.find((a) => a.orderId === orderId);
  if (!attempt) throw new AppError("NOT_FOUND", "This payment was not started here.");
  if (!PAYABLE.has(e.settlement.state)) {
    // Already captured (second click, refresh, or the webhook got here first).
    return { state: e.settlement.state, status: pay?.captureStatus === "PENDING" ? "PENDING" : "COMPLETED" };
  }

  let order: OrderInfo;
  try {
    order = await captureOrder(orderId, meta.requestId, attempt.declines ?? 0);
  } catch (err) {
    if (err instanceof PayPalError && err.has("ORDER_ALREADY_CAPTURED")) {
      order = await getOrder(orderId, meta.requestId).catch((e2) => {
        throw paypalAppError(e2);
      });
    } else if (err instanceof PayPalError && err.has("INSTRUMENT_DECLINED")) {
      // PY-7: record the failure; the browser restarts the PayPal flow (actions.restart()).
      await db().runTransaction(async (tx) => {
        const cur = (await tx.get(paymentRef(expenseId))).data() as PaymentDoc;
        tx.update(paymentRef(expenseId), { attempts: cur.attempts.map((a) => (a.orderId === orderId ? { ...a, declines: (a.declines ?? 0) + 1 } : a)) });
      });
      if (e.settlement.state === "AWAITING_PAYMENT") {
        await transition({ expenseId, machine: "settlement", event: "CAPTURE_FAILED", actor, payload: { extra: { orderId, issue: "INSTRUMENT_DECLINED" } }, ...meta });
      }
      throw paypalAppError(err);
    } else if (err instanceof PayPalError && err.network) {
      // The capture may have happened: ask PayPal before saying anything (sandbox slow).
      order = await getOrder(orderId, meta.requestId).catch(() => {
        throw paypalAppError(err);
      });
      if (!order.capture) throw paypalAppError(err);
    } else {
      throw paypalAppError(err);
    }
  }
  if (!order.capture) throw new AppError("UPSTREAM_FAILED", "PayPal did not confirm the payment. Nothing was marked paid.");
  if (order.customId && order.customId !== expenseId) {
    log.error("checkout.custom_id_mismatch", { requestId: meta.requestId, expenseId });
    throw new AppError("UPSTREAM_FAILED", "PayPal returned a different payment. Nothing was marked paid.");
  }
  const out = await applyCapture(expenseId, orderId, order.capture, actor, meta);
  const status = out.capture === "COMPLETED" ? "COMPLETED" : out.capture === "PENDING" ? "PENDING" : "DECLINED";
  return { state: out.state, status };
}
