import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as billingRoute } from "@/app/api/billing/route";
import { POST as cancelPlanRoute } from "@/app/api/billing/cancel/route";
import { POST as subscribeRoute } from "@/app/api/billing/subscription/route";
import { POST as disputeRoute } from "@/app/api/expenses/[id]/dispute/route";
import { POST as retryRoute } from "@/app/api/expenses/[id]/payout/retry/route";
import { POST as reconcileRoute } from "@/app/api/expenses/[id]/reconcile/route";
import { POST as refundRoute } from "@/app/api/expenses/[id]/refund/route";
import { GET as getExpense } from "@/app/api/expenses/[id]/route";
import { DELETE as disconnectRoute } from "@/app/api/paypal/connect/route";
import { POST as createOrderRoute } from "@/app/api/links/[token]/orders/route";
import { POST as captureRoute } from "@/app/api/links/[token]/orders/[orderId]/capture/route";
import { GET as linkSummary } from "@/app/api/links/[token]/route";
import { POST as connectEmail } from "@/app/api/paypal/connect/email/route";
import { POST as webhookRoute } from "@/app/api/webhooks/paypal/route";
import { DAY_MS, MINUTE_MS, setClock } from "@/lib/clock";
import { resetEnvCache } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { checkInvariants } from "@/lib/invariants";
import { call, type CookieJar } from "../helpers/api";
import { claimSent, clearCloudinary, guestSession, linkFromEmail, newExpense, receiptReady, withCloudinary, type Fam } from "../helpers/claims";
import { resetEmulators } from "../helpers/emulator";
import { expectOk, ownerWithFamily } from "../helpers/flows";
import { clearPayPal, FakePayPal, PLAN_ID, webhookHeaders } from "../helpers/paypal";
import { StubServer } from "../helpers/stub-server";

const stub = new StubServer();
let pp: FakePayPal;
beforeAll(async () => {
  await resetEmulators();
  await stub.start();
});
afterAll(async () => {
  clearPayPal();
  await stub.stop();
});
beforeEach(() => {
  stub.reset();
  withCloudinary(stub);
  pp = new FakePayPal(stub).install();
});
afterEach(clearCloudinary);

let subSeq = 0;
export async function subscribe(f: Fam, over: Partial<Parameters<FakePayPal["addSub"]>[0]> = {}) {
  const sub = pp.addSub({ id: `I-TESTSUB${String(++subSeq).padStart(6, "0")}`, status: "ACTIVE", plan_id: PLAN_ID, custom_id: f.familyId, next_billing_time: new Date(Date.now() + 30 * DAY_MS).toISOString(), ...over });
  const r = await call(subscribeRoute, { method: "POST", jar: f.owner.jar, body: { subscriptionId: sub.id } });
  return { sub, r };
}

async function connectOwner(f: Fam, email = "alex.receiver@example.com") {
  await expectOk(call(connectEmail, { method: "POST", jar: f.owner.jar, body: { for: "owner", email, confirmEmail: email } }));
}

/** Family plan, owner connected, $120 dentist claim sent; Sara owes $60 and has a link session. */
async function payable(opts: { plan?: boolean; connect?: boolean; amountCents?: number } = {}) {
  const f = await ownerWithFamily();
  if (opts.plan !== false) await expectOk(subscribe(f).then((x) => x.r));
  if (opts.connect !== false) await connectOwner(f);
  const amount = opts.amountCents ?? 12000;
  const e = await newExpense(f, { category: "dental", description: "Bright Smile cleaning", vendor: "Bright Smile Dental", amountCents: amount });
  await receiptReady(f, e.id, { merchant: "Bright Smile Dental", totalCents: amount });
  await claimSent(f, e.id);
  const token = linkFromEmail(f.coParentEmail, "p");
  const jar = await guestSession(token, f.coParentEmail);
  return { f, e, token, jar };
}

async function order(token: string, jar: CookieJar, body: unknown = {}) {
  return call(createOrderRoute, { method: "POST", params: { token }, jar, body });
}
async function capture(token: string, jar: CookieJar, orderId: string) {
  return call(captureRoute, { method: "POST", params: { token, orderId }, jar });
}
async function settlementOf(f: Fam, id: string) {
  return (await expectOk(call(getExpense, { jar: f.owner.jar, params: { id } }))).json.expense.settlement;
}
async function webhook(event: Record<string, unknown>, sig?: string) {
  return call(webhookRoute, { method: "POST", path: "/api/webhooks/paypal", body: event, headers: webhookHeaders(sig) });
}

describe("checkout and payout", () => {
  it("PY-1: capture COMPLETED -> PAID -> PAYOUT_PROCESSING; item SUCCEEDED webhook -> SETTLED", async () => {
    const { f, e, token, jar } = await payable();
    const o = await expectOk(order(token, jar));
    expect(o.json.breakdown).toMatchObject({ owedCents: 6000, feeLineCents: 0, totalCents: 6000 });
    pp.approve(o.json.orderId);
    const c = await expectOk(capture(token, jar, o.json.orderId));
    expect(c.json).toMatchObject({ status: "COMPLETED", state: "PAYOUT_PROCESSING" });

    const [batch] = pp.batchFor(e.id);
    expect(batch).toMatchObject({ senderBatchId: `${e.id}-1`, amount: "60.00", receiver: "alex.receiver@example.com" });
    const pay = (await db().collection("payments").doc(e.id).get()).data()!;
    expect(pay).toMatchObject({ captureStatus: "COMPLETED", capturedCents: 6000, paypalFeeCents: 258, feeLineCents: 0 });

    const w = await webhook({ id: "WH-EVT-PY1", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_item_id: batch.itemId, payout_batch_id: batch.id, transaction_status: "SUCCESS", payout_item: { sender_item_id: e.id } } });
    expect(w.status).toBe(200);
    expect(w.json.outcome).toBe("applied");
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "SETTLED" });

    const s = await expectOk(call(linkSummary, { params: { token }, jar }));
    expect(s.json.summary.state).toBe("SETTLED");
    const inv = await checkInvariants({ familyId: f.familyId });
    expect(inv.violations).toEqual([]);
  });
});

const JOB = { authorization: "Bearer test-job-secret-0123456789abcdef0123456789" };

async function paidAndProcessing() {
  const x = await payable();
  const o = await expectOk(order(x.token, x.jar));
  await expectOk(capture(x.token, x.jar, o.json.orderId));
  const [batch] = pp.batchFor(x.e.id);
  return { ...x, orderId: o.json.orderId as string, batch };
}
const itemEvent = (id: string, type: string, status: string, b: { id: string; itemId: string }, expenseId: string) => ({
  id, event_type: type, resource: { payout_item_id: b.itemId, payout_batch_id: b.id, transaction_status: status, payout_item: { sender_item_id: expenseId } },
});
const captureEvent = (id: string, captureId: string, expenseId: string, orderId: string) => ({
  id, event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { id: captureId, status: "COMPLETED", custom_id: expenseId, amount: { currency_code: "USD", value: "60.00" }, supplementary_data: { related_ids: { order_id: orderId } } },
});
async function settlementEvents(expenseId: string) {
  const snap = await db().collection("expenses").doc(expenseId).collection("events").where("machine", "==", "settlement").get();
  return snap.docs.map((d) => d.data().type as string);
}

describe("checkout edge cases", () => {
  it("PY-2: an amount in the body is ignored", async () => {
    const { token, jar } = await payable();
    const o = await expectOk(order(token, jar, { amount: "1.00", amountCents: 100 }));
    expect(pp.orders.get(o.json.orderId)!.amount).toBe("60.00");
  });

  it("PY-3: no Family plan -> 402 and no order at PayPal", async () => {
    const { token, jar } = await payable({ plan: false });
    const r = await order(token, jar);
    expect(r.status).toBe(402);
    expect(r.json.error.code).toBe("PLAN_REQUIRED");
    expect(pp.orders.size).toBe(0);
  });

  it("PY-4: a DISPUTED claim cannot be paid (409)", async () => {
    const { e, token, jar } = await payable();
    await expectOk(call(disputeRoute, { method: "POST", params: { id: e.id }, jar, body: { reason: "The cleaning was covered by insurance." } }));
    const r = await order(token, jar);
    expect(r.status).toBe(409);
  });

  it("orders need the link code: no link session is 401", async () => {
    const { token } = await payable();
    const r = await call(createOrderRoute, { method: "POST", params: { token }, body: {} });
    expect(r.status).toBe(401);
  });

  it("PY-5: two concurrent captures -> one capture at PayPal, one payout", async () => {
    const { e, token, jar } = await payable();
    const o = await expectOk(order(token, jar));
    const [a, b] = await Promise.all([capture(token, jar, o.json.orderId), capture(token, jar, o.json.orderId)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(pp.captureCalls).toBe(1);
    expect(pp.batchFor(e.id)).toHaveLength(1);
    expect((await settlementEvents(e.id)).filter((t) => t === "settlement.AWAITING_PAYMENT->PAID")).toHaveLength(1);
  });

  it("PY-6: checkout cancelled -> still AWAITING_PAYMENT, nothing captured", async () => {
    const { f, e, token, jar } = await payable();
    await expectOk(order(token, jar));
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "AWAITING_PAYMENT" });
    const pay = (await db().collection("payments").doc(e.id).get()).data()!;
    expect(pay.captureStatus).toBeUndefined();
    expect(pay.attempts).toHaveLength(1);
  });

  it("PY-7: INSTRUMENT_DECLINED -> PAYMENT_FAILED with restart; another try on the same order succeeds", async () => {
    const { f, e, token, jar } = await payable();
    const o = await expectOk(order(token, jar));
    pp.captureMode = "INSTRUMENT_DECLINED";
    const r = await capture(token, jar, o.json.orderId);
    expect(r.status).toBe(409);
    expect(r.json.error).toMatchObject({ code: "PAYPAL_DECLINED", details: { restart: true } });
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "PAYMENT_FAILED" });
    pp.captureMode = "COMPLETED";
    const ok = await expectOk(capture(token, jar, o.json.orderId));
    expect(ok.json.state).toBe("PAYOUT_PROCESSING");
  });

  it("PY-8: capture PENDING -> no payout until the COMPLETED webhook", async () => {
    const { f, e, token, jar } = await payable();
    const o = await expectOk(order(token, jar));
    pp.captureMode = "PENDING";
    const c = await expectOk(capture(token, jar, o.json.orderId));
    expect(c.json).toMatchObject({ status: "PENDING", state: "AWAITING_PAYMENT" });
    expect(pp.batchFor(e.id)).toHaveLength(0);
    const cap = pp.orders.get(o.json.orderId)!.capture!;
    const w = await webhook(captureEvent("WH-PY8", cap.id, e.id, o.json.orderId));
    expect(w.json.outcome).toBe("applied");
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "PAYOUT_PROCESSING" });
    expect(pp.batchFor(e.id)).toHaveLength(1);
  });

  it("PY-9: webhook before the capture response -> one transition, the other is a noop", async () => {
    const { f, e, token, jar } = await payable();
    const o = await expectOk(order(token, jar));
    const ord = pp.orders.get(o.json.orderId)!;
    ord.capture = { id: "CAPEARLY000000001", status: "COMPLETED", amount: "60.00" };
    ord.status = "COMPLETED";
    expect((await webhook(captureEvent("WH-PY9-A", "CAPEARLY000000001", e.id, o.json.orderId))).json.outcome).toBe("applied");
    const c = await expectOk(capture(token, jar, o.json.orderId));
    expect(c.json.state).toBe("PAYOUT_PROCESSING");
    expect((await webhook(captureEvent("WH-PY9-B", "CAPEARLY000000001", e.id, o.json.orderId))).json.outcome).toBe("noop");
    expect((await settlementEvents(e.id)).filter((t) => t.endsWith("->PAID"))).toHaveLength(1);
    expect(pp.batchFor(e.id)).toHaveLength(1);
    expect((await checkInvariants({ familyId: f.familyId })).violations).toEqual([]);
  });
});

describe("webhooks", () => {
  it("SE-3: an invalid signature is 400 and changes nothing", async () => {
    const { f, e, batch } = await paidAndProcessing();
    const r = await webhook(itemEvent("WH-SE3", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "SUCCESS", batch, e.id), "forged");
    expect(r.status).toBe(400);
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "PAYOUT_PROCESSING" });
    expect((await db().collection("webhookEvents").doc("WH-SE3").get()).exists).toBe(false);
  });

  it("PY-10: the same event 3 times is processed once", async () => {
    const { f, e, batch } = await paidAndProcessing();
    const ev = itemEvent("WH-PY10", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "SUCCESS", batch, e.id);
    const outcomes = [];
    for (let i = 0; i < 3; i++) outcomes.push((await webhook(ev)).json.outcome);
    expect(outcomes).toEqual(["applied", "duplicate", "duplicate"]);
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "SETTLED" });
    expect((await settlementEvents(e.id)).filter((t) => t.endsWith("->SETTLED"))).toHaveLength(1);
    const notes = await db().collection("notifications").where("expenseId", "==", e.id).where("type", "==", "settled").get();
    expect(notes.size).toBe(2);
  });

  it("PY-17: an unknown resource is 200 ignored_unknown", async () => {
    const r = await webhook({ id: "WH-PY17", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_item_id: "X", payout_batch_id: "NOPE", payout_item: { sender_item_id: "doesnotexist00000000" } } });
    expect(r.status).toBe(200);
    expect(r.json.outcome).toBe("ignored_unknown");
    const r2 = await webhook({ id: "WH-PY17-B", event_type: "SOMETHING.NEW", resource: {} });
    expect(r2.json.outcome).toBe("ignored_unknown");
  });

  it("PY-18: a handler error answers 500 and the retry is processed", async () => {
    const f = await ownerWithFamily();
    const { sub } = await subscribe(f);
    pp.subs.delete(sub.id); // PayPal GET fails while handling the sale
    const ev = { id: "WH-PY18", event_type: "PAYMENT.SALE.COMPLETED", resource: { id: "SALE1", billing_agreement_id: sub.id } };
    const r = await webhook(ev);
    expect(r.status).toBe(500);
    expect((await db().collection("webhookEvents").doc("WH-PY18").get()).data()).toMatchObject({ outcome: "error" });
    pp.addSub({ ...sub, next_billing_time: new Date(Date.now() + 60 * DAY_MS).toISOString() });
    const again = await webhook(ev);
    expect(again.json.outcome).toBe("applied");
    const doc = (await db().collection("subscriptions").doc(f.familyId).get()).data()!;
    expect(doc.paidThrough.toMillis()).toBeGreaterThan(Date.now() + 50 * DAY_MS);
  });
});

describe("payouts", () => {
  it("PY-11: payout response lost -> stays PAID; reconcile finds the same batch (one payout)", async () => {
    const { f, e, token, jar } = await payable();
    pp.payoutLostResponses = 3; // first try + 2 retries all time out
    const o = await expectOk(order(token, jar));
    const c = await expectOk(capture(token, jar, o.json.orderId));
    expect(c.json.state).toBe("PAID");
    expect(pp.batchFor(e.id)).toHaveLength(1);
    const r = await expectOk(call(reconcileRoute, { method: "POST", params: { id: e.id }, headers: JOB }));
    expect(r.json.result.state).toBe("PAYOUT_PROCESSING");
    expect(pp.batchFor(e.id)).toHaveLength(1);
    expect(pp.batchFor(e.id)[0].senderBatchId).toBe(`${e.id}-1`);
    expect((await checkInvariants({ familyId: f.familyId })).violations).toEqual([]);
  });

  it("PY-12: UNCLAIMED then SUCCEEDED -> PAYOUT_UNCLAIMED then SETTLED", async () => {
    const { f, e, batch } = await paidAndProcessing();
    await webhook(itemEvent("WH-PY12-A", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", "UNCLAIMED", batch, e.id));
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "PAYOUT_UNCLAIMED" });
    await webhook(itemEvent("WH-PY12-B", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "SUCCESS", batch, e.id));
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "SETTLED" });
  });

  it("PY-13: FAILED, receiver reconnects, retry -> new attempt; a late event for attempt 1 is ignored", async () => {
    const { f, e, batch } = await paidAndProcessing();
    await webhook(itemEvent("WH-PY13-A", "PAYMENT.PAYOUTS-ITEM.FAILED", "FAILED", batch, e.id));
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "PAYOUT_FAILED" });
    await connectOwner(f, "alex.fixed@example.com");
    const r = await expectOk(call(retryRoute, { method: "POST", params: { id: e.id }, jar: f.owner.jar }));
    expect(r.json.result.state).toBe("PAYOUT_PROCESSING");
    const batches = pp.batchFor(e.id);
    expect(batches.map((b) => b.senderBatchId)).toEqual([`${e.id}-1`, `${e.id}-2`]);
    expect(batches[1].receiver).toBe("alex.fixed@example.com");
    const stale = await webhook(itemEvent("WH-PY13-B", "PAYMENT.PAYOUTS-ITEM.RETURNED", "RETURNED", batch, e.id));
    expect(stale.json.outcome).toBe("noop");
    await webhook(itemEvent("WH-PY13-C", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "SUCCESS", batches[1], e.id));
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "SETTLED" });
    expect((await checkInvariants({ familyId: f.familyId })).violations).toEqual([]);
  });

  it("only the owed parent (signed in) can retry a payout", async () => {
    const { e, jar } = await paidAndProcessing();
    const r = await call(retryRoute, { method: "POST", params: { id: e.id }, jar });
    expect(r.status).toBe(401);
  });

  it("PY-14: insufficient platform balance -> stays PAID; reconcile after funding pays out", async () => {
    const { f, e, token, jar } = await payable();
    pp.payoutMode = "insufficient";
    const o = await expectOk(order(token, jar));
    const c = await expectOk(capture(token, jar, o.json.orderId));
    expect(c.json.state).toBe("PAID");
    const payout = (await db().collection("payouts").doc(e.id).get()).data()!;
    expect(payout.attempts[0]).toMatchObject({ status: "CREATED", lastError: "INSUFFICIENT_FUNDS" });
    pp.payoutMode = "ok";
    const r = await expectOk(call(reconcileRoute, { method: "POST", params: { id: e.id }, jar: f.owner.jar }));
    expect(r.json.result.state).toBe("PAYOUT_PROCESSING");
    expect(pp.batchFor(e.id).map((b) => b.senderBatchId)).toEqual([`${e.id}-1`]);
  });

  it("PY-15: above the covered volume a fee line is charged; the payout is still the owed amount", async () => {
    process.env.PLAN_COVERED_VOLUME_CENTS = "5000";
    resetEnvCache();
    try {
      const { f, e, token, jar } = await payable();
      const o = await expectOk(order(token, jar));
      // $10 uncovered: ceil(1000 x 3.49%) = 35 + 49 fixed = 84 cents.
      expect(o.json.breakdown).toMatchObject({ owedCents: 6000, coveredCents: 5000, uncoveredCents: 1000, feeLineCents: 84, totalCents: 6084 });
      expect(pp.orders.get(o.json.orderId)!.amount).toBe("60.84");
      await expectOk(capture(token, jar, o.json.orderId));
      expect(pp.batchFor(e.id)[0].amount).toBe("60.00");
      expect((await checkInvariants({ familyId: f.familyId })).violations).toEqual([]);
    } finally {
      delete process.env.PLAN_COVERED_VOLUME_CENTS;
      resetEnvCache();
    }
  });

  it("PY-16: refund after a failed payout -> REFUNDED", async () => {
    const { f, e, batch } = await paidAndProcessing();
    await webhook(itemEvent("WH-PY16", "PAYMENT.PAYOUTS-ITEM.FAILED", "FAILED", batch, e.id));
    const r = await expectOk(call(refundRoute, { method: "POST", params: { id: e.id }, jar: f.owner.jar }));
    expect(r.json.result.state).toBe("REFUNDED");
    expect(pp.refunds).toHaveLength(1);
    expect((await db().collection("payments").doc(e.id).get()).data()).toMatchObject({ captureStatus: "REFUNDED" });
    expect((await checkInvariants({ familyId: f.familyId })).violations).toEqual([]);
  });

  it("PC-6: receiver not connected -> stays PAID with a notice; connecting sends the payout", async () => {
    const { f, e, token, jar } = await payable({ connect: false });
    const o = await expectOk(order(token, jar));
    const c = await expectOk(capture(token, jar, o.json.orderId));
    expect(c.json.state).toBe("PAID");
    const n = await db().collection("notifications").where("expenseId", "==", e.id).where("type", "==", "connect_paypal_needed").get();
    expect(n.size).toBe(1);
    await connectOwner(f);
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "PAYOUT_PROCESSING" });
    expect(pp.batchFor(e.id)).toHaveLength(1);
  });

  it("PC-5: disconnecting PayPal while a payout is processing is 409", async () => {
    const { f } = await paidAndProcessing();
    const r = await call(disconnectRoute, { method: "DELETE", jar: f.owner.jar });
    expect(r.status).toBe(409);
  });
});

describe("subscriptions", () => {
  it("SB-1: subscribe is ACTIVE only after the server reads it from PayPal", async () => {
    const f = await ownerWithFamily();
    const { r } = await subscribe(f);
    expect(r.status).toBe(200);
    expect(r.json.billing).toMatchObject({ entitled: true, subscription: { status: "ACTIVE" } });
    const fam = (await db().collection("families").doc(f.familyId).get()).data()!;
    expect(fam.plan.tier).toBe("family");
  });

  it("SB-2: someone else's subscription id is 400", async () => {
    const f = await ownerWithFamily();
    const other = pp.addSub({ id: "I-OTHERFAMILY01", status: "ACTIVE", plan_id: PLAN_ID, custom_id: "someOtherFamily00001" });
    const r = await call(subscribeRoute, { method: "POST", jar: f.owner.jar, body: { subscriptionId: other.id } });
    expect(r.status).toBe(400);
    expect((await db().collection("subscriptions").doc(f.familyId).get()).exists).toBe(false);
    const wrongPlan = pp.addSub({ id: "I-WRONGPLAN0001", status: "ACTIVE", plan_id: "P-SOMETHINGELSE", custom_id: f.familyId });
    expect((await call(subscribeRoute, { method: "POST", jar: f.owner.jar, body: { subscriptionId: wrongPlan.id } })).status).toBe(400);
  });

  it("SB-3: cancel -> entitled until paidThrough, then not", async () => {
    const { f, token, jar } = await payable();
    const c = await expectOk(call(cancelPlanRoute, { method: "POST", jar: f.owner.jar, body: {} }));
    expect(c.json.billing).toMatchObject({ entitled: true, subscription: { status: "CANCELLED" } });
    await expectOk(order(token, jar));
    setClock(new Date(Date.now() + 31 * DAY_MS));
    const b = await expectOk(call(billingRoute, { jar: f.owner.jar }));
    expect(b.json.billing.entitled).toBe(false);
  });

  it("SB-4: SUSPENDED webhook -> order creation 402 and an owner notice", async () => {
    const { f, token, jar } = await payable();
    const sub = [...pp.subs.values()].find((s) => s.custom_id === f.familyId)!;
    const w = await webhook({ id: "WH-SB4", event_type: "BILLING.SUBSCRIPTION.SUSPENDED", resource: pp.subJson({ ...sub, status: "SUSPENDED" }) });
    expect(w.json.outcome).toBe("applied");
    expect((await order(token, jar)).status).toBe(402);
    const n = await db().collection("notifications").where("familyId", "==", f.familyId).where("type", "==", "subscription_problem").get();
    expect(n.size).toBe(1);
  });

  it("SB-5: a missed webhook is caught by the billing page after 1 hour", async () => {
    const f = await ownerWithFamily();
    const { sub } = await subscribe(f);
    sub.status = "SUSPENDED"; // PayPal changed it; no webhook arrived
    expect((await expectOk(call(billingRoute, { jar: f.owner.jar }))).json.billing.subscription.status).toBe("ACTIVE");
    setClock(new Date(Date.now() + 61 * MINUTE_MS));
    expect((await expectOk(call(billingRoute, { jar: f.owner.jar }))).json.billing).toMatchObject({ entitled: false, subscription: { status: "SUSPENDED" } });
  });

  it("SB-6: a capture that completes after the plan lapsed still pays out", async () => {
    const { f, e, token, jar } = await payable();
    const o = await expectOk(order(token, jar));
    pp.captureMode = "PENDING";
    await expectOk(capture(token, jar, o.json.orderId));
    const sub = [...pp.subs.values()].find((s) => s.custom_id === f.familyId)!;
    await webhook({ id: "WH-SB6-A", event_type: "BILLING.SUBSCRIPTION.SUSPENDED", resource: pp.subJson({ ...sub, status: "SUSPENDED" }) });
    const cap = pp.orders.get(o.json.orderId)!.capture!;
    await webhook(captureEvent("WH-SB6-B", cap.id, e.id, o.json.orderId));
    expect(await settlementOf(f, e.id)).toMatchObject({ state: "PAYOUT_PROCESSING" });
  });
});
