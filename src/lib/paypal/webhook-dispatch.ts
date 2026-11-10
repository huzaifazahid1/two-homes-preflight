import "server-only";
import { z } from "zod";
import { now } from "@/lib/clock";
import { subscriptionProblemEmail } from "@/lib/email/templates/settlement";
import { applySubscriptionInfo, familyPlanId } from "@/lib/entitlement";
import { AppError } from "@/lib/errors";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { log } from "@/lib/log";
import { decimalStringToCents } from "@/lib/money";
import { dedupeKey, deliverNotificationEmail, filterNewNotifications, writeNotifications } from "@/lib/notifications";
import { appUrl, footerForRole, party } from "@/lib/parties";
import { applyCapture, applyPayoutStatus, PAYPAL_ACTOR, recordPayPalNote } from "@/lib/settlement";
import { transition } from "@/lib/state/transition";
import type { ExpenseDoc, FamilyDoc, PaymentDoc, SubscriptionDoc, WebhookEventDoc } from "@/types/firestore";
import { expenseIdFromBatch, itemStatus, type PayoutItemStatus } from "./payouts";
import { fromWebhookResource, getSubscription } from "./subscriptions";
import { verifyWebhookSignature, webhookEventSchema, type WebhookEvent } from "./webhooks";

// POST /api/webhooks/paypal (Section L.1): verify, dedupe on webhookEvents/{event.id}, dispatch
// (G.7), record the outcome. Out-of-order and repeated events are safe: transitions are guarded
// and repeats are recorded as noop. A handler error answers 500 so PayPal delivers it again; an
// event whose last outcome is 'error' may be processed again.

export type Outcome = "applied" | "noop" | "ignored_unknown";
export type WebhookResult = { status: 200 | 400 | 500; outcome: Outcome | "duplicate" | "invalid_signature" | "invalid" | "error" | "unavailable" };

const eventRef = (id: string) => db().collection("webhookEvents").doc(id);

export async function handleWebhook(rawBody: string, headers: Headers, requestId: string): Promise<WebhookResult> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    log.warn("webhook.invalid_json", { requestId });
    return { status: 400, outcome: "invalid" };
  }
  const verified = await verifyWebhookSignature(headers, parsedJson, requestId);
  if (verified === "unavailable") return { status: 500, outcome: "unavailable" };
  if (verified === "invalid") {
    log.warn("webhook.invalid_signature", { requestId }); // SE-3: no state change
    return { status: 400, outcome: "invalid_signature" };
  }
  const p = webhookEventSchema.safeParse(parsedJson);
  if (!p.success) return { status: 400, outcome: "invalid" };
  const event = p.data;
  const resourceId = typeof event.resource.id === "string" ? event.resource.id : null;
  const started = Date.now();

  const fresh = await db().runTransaction(async (tx) => {
    const snap = await tx.get(eventRef(event.id));
    const doc = snap.data() as WebhookEventDoc | undefined;
    if (doc && doc.outcome !== "error") return false;
    if (doc) tx.update(eventRef(event.id), { attempts: FieldValue.increment(1), outcome: FieldValue.delete(), error: FieldValue.delete() });
    else tx.create(eventRef(event.id), { type: event.event_type, resourceId, receivedAt: Timestamp.fromDate(now()), attempts: 1 } satisfies WebhookEventDoc);
    return true;
  });
  if (!fresh) {
    log.info("webhook", { requestId, eventId: event.id, event_type: event.event_type, resourceId, outcome: "duplicate" });
    return { status: 200, outcome: "duplicate" };
  }

  try {
    const outcome = await dispatch(event, requestId);
    await eventRef(event.id).update({ processedAt: Timestamp.fromDate(now()), outcome });
    log.info("webhook", { requestId, eventId: event.id, event_type: event.event_type, resourceId, outcome, durationMs: Date.now() - started });
    return { status: 200, outcome };
  } catch (err) {
    const code = err instanceof AppError ? err.code : err instanceof Error ? err.name : "UNKNOWN";
    log.error("webhook", { requestId, eventId: event.id, event_type: event.event_type, resourceId, outcome: "error", errorCode: code, error: err, durationMs: Date.now() - started });
    await eventRef(event.id).update({ outcome: "error", error: String(code).slice(0, 120) }).catch((e2) => log.error("webhook.mark_error_failed", { requestId, error: e2 }));
    return { status: 500, outcome: "error" };
  }
}

// ---------------- Dispatch ----------------

const PAYOUT_ITEM: Record<string, PayoutItemStatus> = {
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "FAILED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "RETURNED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": "BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "CANCELED",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": "REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.HELD": "HELD",
};
const CAPTURE_STATUS: Record<string, "COMPLETED" | "PENDING" | "DECLINED"> = {
  "PAYMENT.CAPTURE.COMPLETED": "COMPLETED",
  "PAYMENT.CAPTURE.PENDING": "PENDING",
  "PAYMENT.CAPTURE.DENIED": "DECLINED",
  "PAYMENT.CAPTURE.DECLINED": "DECLINED",
};

async function dispatch(event: WebhookEvent, requestId: string): Promise<Outcome> {
  const t = event.event_type;
  const meta = { requestId };
  if (CAPTURE_STATUS[t]) return onCapture(event, CAPTURE_STATUS[t], meta);
  if (t === "PAYMENT.CAPTURE.REFUNDED" || t === "PAYMENT.CAPTURE.REVERSED") return onRefund(event, meta);
  if (PAYOUT_ITEM[t]) return onPayoutItem(event, PAYOUT_ITEM[t], meta);
  if (t.startsWith("PAYMENT.PAYOUTSBATCH.")) return onPayoutBatch(event, meta);
  if (t.startsWith("BILLING.SUBSCRIPTION.")) return onSubscription(event, meta);
  if (t === "PAYMENT.SALE.COMPLETED") return onSale(event, meta);
  if (t === "CUSTOMER.DISPUTE.CREATED") return onDispute(event);
  if (t === "CHECKOUT.ORDER.APPROVED") return "noop"; // informational
  return "ignored_unknown";
}

async function versionOf(expenseId: string): Promise<number | null> {
  const s = await db().collection("expenses").doc(expenseId).get();
  return s.exists ? (s.data() as ExpenseDoc).version : null;
}
const changed = async (expenseId: string, before: number | null): Promise<Outcome> => ((await versionOf(expenseId)) !== before ? "applied" : "noop");

const money = z.object({ currency_code: z.string(), value: z.string() }).loose();
const captureResource = z
  .object({
    id: z.string(),
    custom_id: z.string().optional(),
    amount: money.optional(),
    seller_receivable_breakdown: z.object({ paypal_fee: money.optional(), net_amount: money.optional() }).loose().optional(),
    supplementary_data: z.object({ related_ids: z.object({ order_id: z.string().optional() }).loose().optional() }).loose().optional(),
  })
  .loose();

async function onCapture(event: WebhookEvent, status: "COMPLETED" | "PENDING" | "DECLINED", meta: { requestId: string }): Promise<Outcome> {
  const r = captureResource.safeParse(event.resource);
  if (!r.success || !r.data.custom_id) return "ignored_unknown";
  const expenseId = r.data.custom_id;
  const pay = (await db().collection("payments").doc(expenseId).get()).data() as PaymentDoc | undefined;
  const orderId = r.data.supplementary_data?.related_ids?.order_id ?? null;
  // Only captures of orders this app created for this expense.
  if (!pay || !(pay.attempts.some((a) => a.orderId === orderId) || pay.captureId === r.data.id)) return "ignored_unknown";
  const before = await versionOf(expenseId);
  const cents = (m?: { currency_code: string; value: string }) => (m && m.currency_code === "USD" ? decimalStringToCents(m.value) : null);
  await applyCapture(
    expenseId,
    orderId ?? pay.orderId ?? null,
    { id: r.data.id, status, amountCents: cents(r.data.amount) ?? 0, paypalFeeCents: cents(r.data.seller_receivable_breakdown?.paypal_fee), netCents: cents(r.data.seller_receivable_breakdown?.net_amount) },
    PAYPAL_ACTOR,
    meta,
  );
  return changed(expenseId, before);
}

const UP_CAPTURE = /\/v2\/payments\/captures\/([A-Z0-9]+)/;

async function expenseByCapture(captureId: string): Promise<string | null> {
  const q = await db().collection("payments").where("captureId", "==", captureId).limit(1).get();
  return q.empty ? null : (q.docs[0].data() as PaymentDoc).expenseId;
}

async function onRefund(event: WebhookEvent, meta: { requestId: string }): Promise<Outcome> {
  const res = event.resource as { id?: string; custom_id?: string; links?: { href?: string; rel?: string }[] };
  const captureId = event.event_type === "PAYMENT.CAPTURE.REVERSED" ? res.id : res.links?.map((l) => UP_CAPTURE.exec(l.href ?? "")?.[1]).find(Boolean);
  const expenseId = (captureId && (await expenseByCapture(captureId))) || null;
  if (!expenseId) return "ignored_unknown";
  const e = (await db().collection("expenses").doc(expenseId).get()).data() as ExpenseDoc;
  if (e.settlement.state === "REFUNDED") return "noop"; // our own refund
  if (e.settlement.state === "PAYOUT_FAILED") {
    // Refunded from the PayPal dashboard after a failed payout.
    const r = await transition({ expenseId, machine: "settlement", event: "REFUND_PAYER", actor: PAYPAL_ACTOR, payload: { extra: { source: event.event_type } }, ...meta });
    return r.outcome;
  }
  // After payout success there is no in-app refund (G.5): record it for the timeline and audit.
  await recordPayPalNote(expenseId, "paypal.capture_refunded", { event: event.event_type, captureId: captureId ?? "" });
  return "applied";
}

const payoutItemResource = z
  .object({ payout_item_id: z.string().optional(), payout_batch_id: z.string(), transaction_status: z.string().optional(), payout_item: z.object({ sender_item_id: z.string().optional() }).loose().optional() })
  .loose();

async function onPayoutItem(event: WebhookEvent, status: PayoutItemStatus, meta: { requestId: string }): Promise<Outcome> {
  const r = payoutItemResource.safeParse(event.resource);
  const expenseId = r.success ? r.data.payout_item?.sender_item_id : undefined;
  if (!r.success || !expenseId || (await versionOf(expenseId)) === null) return "ignored_unknown";
  const out = await applyPayoutStatus(expenseId, r.data.payout_batch_id, r.data.transaction_status ? itemStatus(r.data.transaction_status) : status, r.data.payout_item_id ?? null, PAYPAL_ACTOR, meta);
  return out === "applied" ? "applied" : out === "stale" ? "noop" : "noop";
}

const batchResource = z
  .object({ batch_header: z.object({ payout_batch_id: z.string(), batch_status: z.string().optional(), sender_batch_header: z.object({ sender_batch_id: z.string() }).loose() }).loose() })
  .loose();

async function onPayoutBatch(event: WebhookEvent, meta: { requestId: string }): Promise<Outcome> {
  const r = batchResource.safeParse(event.resource);
  if (!r.success) return "ignored_unknown";
  const expenseId = expenseIdFromBatch(r.data.batch_header.sender_batch_header.sender_batch_id);
  if (!expenseId || (await versionOf(expenseId)) === null) return "ignored_unknown";
  // Only a denied batch moves state; PROCESSING/SUCCESS are followed by item events (or reconcile).
  if (event.event_type !== "PAYMENT.PAYOUTSBATCH.DENIED") return "noop";
  const out = await applyPayoutStatus(expenseId, r.data.batch_header.payout_batch_id, "DENIED", null, PAYPAL_ACTOR, meta);
  return out === "applied" ? "applied" : "noop";
}

async function onSubscription(event: WebhookEvent, meta: { requestId: string }): Promise<Outcome> {
  const info = fromWebhookResource(event.resource);
  if (!info?.customId) return "ignored_unknown";
  const familyId = info.customId;
  const famSnap = await db().collection("families").doc(familyId).get();
  const plan = familyPlanId();
  if (!famSnap.exists || (plan && info.planId && info.planId !== plan)) return "ignored_unknown";
  const current = (await db().collection("subscriptions").doc(familyId).get()).data() as SubscriptionDoc | undefined;
  // A webhook for an older subscription of this family must not overwrite the current one.
  if (current && current.paypalSubscriptionId !== info.id && current.status === "ACTIVE") return "noop";
  // PAYMENT.FAILED carries the subscription but not a status change.
  await applySubscriptionInfo(familyId, info, event.event_type);
  if (event.event_type === "BILLING.SUBSCRIPTION.SUSPENDED" || event.event_type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
    await notifySubscriptionProblem(famSnap.data() as FamilyDoc, familyId, event.event_type === "BILLING.SUBSCRIPTION.SUSPENDED" ? "suspended" : "payment_failed", event.id, meta.requestId);
  }
  return "applied";
}

async function onSale(event: WebhookEvent, meta: { requestId: string }): Promise<Outcome> {
  const subId = (event.resource as { billing_agreement_id?: string }).billing_agreement_id;
  if (!subId) return "ignored_unknown";
  const q = await db().collection("subscriptions").where("paypalSubscriptionId", "==", subId).limit(1).get();
  if (q.empty) return "ignored_unknown";
  const familyId = q.docs[0].id;
  // The sale extends paidThrough: read the new next_billing_time from PayPal.
  const info = await getSubscription(subId, meta.requestId);
  if (info.customId && info.customId !== familyId) return "ignored_unknown";
  await applySubscriptionInfo(familyId, info, event.event_type);
  return "applied";
}

async function onDispute(event: WebhookEvent): Promise<Outcome> {
  const txs = (event.resource as { disputed_transactions?: { seller_transaction_id?: string }[] }).disputed_transactions ?? [];
  for (const t of txs) {
    const expenseId = t.seller_transaction_id ? await expenseByCapture(t.seller_transaction_id) : null;
    if (expenseId) {
      await recordPayPalNote(expenseId, "paypal.dispute_created", { disputeId: String((event.resource as { dispute_id?: string }).dispute_id ?? "") });
      return "applied";
    }
  }
  return "ignored_unknown";
}

async function notifySubscriptionProblem(family: FamilyDoc, familyId: string, problem: "suspended" | "payment_failed", eventId: string, requestId: string) {
  const owner = party(family, "owner");
  const key = dedupeKey("subscription_problem", familyId, eventId);
  const created = await db().runTransaction(async (tx) => {
    const fresh = await filterNewNotifications(tx, [
      { dedupeKey: key, familyId, toUid: owner.uid, toEmail: owner.email, type: "subscription_problem", title: problem === "suspended" ? "Your Family plan is paused" : "Family plan payment failed", body: "In-app settlement and automatic reminders are off until it is fixed.", link: "/app/billing", sendEmail: true },
    ]);
    writeNotifications(tx, fresh);
    return fresh.length > 0;
  });
  if (created) {
    await deliverNotificationEmail({ dedupeKey: key, to: owner.email, email: subscriptionProblemEmail({ problem, url: appUrl("/app/billing"), footer: footerForRole(family, "owner") }), requestId });
  }
}
