import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { POST as cancelExpense } from "@/app/api/expenses/[id]/cancel/route";
import { POST as dispute } from "@/app/api/expenses/[id]/dispute/route";
import { POST as externalAction } from "@/app/api/expenses/[id]/external-report/[action]/route";
import { POST as markReceived } from "@/app/api/expenses/[id]/mark-received/route";
import { POST as paymentRequest } from "@/app/api/expenses/[id]/payment-request/route";
import { POST as remind } from "@/app/api/expenses/[id]/remind/route";
import { GET as getExpense } from "@/app/api/expenses/[id]/route";
import { POST as waive } from "@/app/api/expenses/[id]/waive/route";
import { POST as respond } from "@/app/api/disputes/[id]/respond/route";
import { POST as dailyJob } from "@/app/api/jobs/daily/route";
import { GET as linkSummary } from "@/app/api/links/[token]/route";
import { POST as reportExternal } from "@/app/api/links/[token]/report-external/route";
import { GET as receiptUrl } from "@/app/api/receipts/[id]/url/route";
import { DAY_MS, MINUTE_MS, setClock } from "@/lib/clock";
import { readMemoryOutbox } from "@/lib/email/outbox";
import { db, Timestamp } from "@/lib/firebase/admin";
import { call } from "../helpers/api";
import { approve, claimSent, clearCloudinary, guestSession, linkFromEmail, newExpense, receiptReady, todayIso, withCloudinary, type Fam } from "../helpers/claims";
import { resetEmulators } from "../helpers/emulator";
import { expectOk, ownerWithFamily } from "../helpers/flows";
import { StubServer } from "../helpers/stub-server";

const stub = new StubServer();
beforeAll(async () => {
  await resetEmulators();
  await stub.start();
});
afterAll(() => stub.stop());
beforeEach(() => {
  stub.reset();
  withCloudinary(stub);
});
afterEach(clearCloudinary);

async function detail(f: Fam, id: string) {
  return (await expectOk(call(getExpense, { jar: f.owner.jar, params: { id } }))).json;
}

/** Eligible $120 dentist visit, receipt confirmed: READY. Sara owes $60. */
async function readyDentist(f: Fam, over: Record<string, unknown> = {}) {
  const e = await newExpense(f, { category: "dental", description: "Bright Smile cleaning", vendor: "Bright Smile Dental", amountCents: 12000, ...over });
  await receiptReady(f, e.id, { merchant: "Bright Smile Dental", totalCents: (over.amountCents as number) ?? 12000 });
  return e;
}

async function openClaim(f: Fam, over: Record<string, unknown> = {}) {
  const e = await readyDentist(f, over);
  const sent = await claimSent(f, e.id);
  return { e, sent, token: linkFromEmail(f.coParentEmail, "p") };
}

describe("payment request", () => {
  it("CL-2: dueAt comes from the agreement's 30-day clause, which is cited; the payer gets a link", async () => {
    const f = await ownerWithFamily();
    const { e, sent, token } = await openClaim(f);
    expect(sent.json.claim.owedCents).toBe(6000);
    expect(sent.json.claim.dueClause.page).toBeGreaterThan(0);
    const due = new Date(sent.json.claim.dueAt).getTime();
    expect(Math.abs(due - (Date.now() + 30 * DAY_MS))).toBeLessThan(60_000);
    const d = await detail(f, e.id);
    expect(d.expense.settlement).toMatchObject({ state: "AWAITING_PAYMENT", owedCents: 6000, overdue: false });
    const mail = readMemoryOutbox().find((m) => m.to === f.coParentEmail && m.subject.includes("asks for $60.00"))!;
    expect(mail.text).toContain("30 days to reimburse");
    const s = await expectOk(call(linkSummary, { params: { token } }));
    expect(s.json.summary).toMatchObject({ purpose: "payment", owedCents: 6000, state: "AWAITING_PAYMENT", canAct: false, canReport: true });
  });

  it("CL-1: a payment request while approval is REQUESTED is 409; NOT_COVERED is 409", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    const { askApproval } = await import("../helpers/claims");
    await expectOk(askApproval(f, e.id));
    // Force READY to test the guard itself (normally the match would hold it in RECEIPT_ISSUE).
    await db().collection("expenses").doc(e.id).update({ "settlement.state": "READY" });
    const r = await call(paymentRequest, { method: "POST", jar: f.owner.jar, params: { id: e.id } });
    expect(r.status).toBe(409);
    const travel = await newExpense(f, { category: "travel", description: "Flight", amountCents: 42000 });
    await db().collection("expenses").doc(travel.id).update({ "settlement.state": "READY" });
    expect((await call(paymentRequest, { method: "POST", jar: f.owner.jar, params: { id: travel.id } })).status).toBe(409);
  });

  it("AP-2: a partial approval of $200 makes the claim 40% of $200", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await approve(f, e.id, { decision: "PARTIALLY_APPROVED", approvedCents: 20000 });
    await receiptReady(f, e.id, { totalCents: 35000, acknowledge: ["OVER_APPROVED"] });
    const sent = await claimSent(f, e.id);
    expect(sent.json.claim.owedCents).toBe(8000);
  });

  it("AZ-2 and AZ-4: another family is 403; the paying parent cannot request, mark received or waive", async () => {
    const f = await ownerWithFamily();
    const e = await readyDentist(f);
    const other = await ownerWithFamily();
    expect((await call(paymentRequest, { method: "POST", jar: other.owner.jar, params: { id: e.id } })).status).toBe(403);
    // The co-parent bought it, so the owner is the paying parent here.
    const theirs = await newExpense(f, { category: "dental", description: "Sara's dentist trip", vendor: "Bright Smile Dental", amountCents: 9000, paidByRole: "coparent" });
    await db().collection("expenses").doc(theirs.id).update({ "settlement.state": "AWAITING_PAYMENT", "settlement.owedCents": 4500, "settlement.dueAt": Timestamp.fromMillis(Date.now() + DAY_MS) });
    expect((await call(markReceived, { method: "POST", jar: f.owner.jar, params: { id: theirs.id } })).status).toBe(403);
    expect((await call(waive, { method: "POST", jar: f.owner.jar, params: { id: theirs.id }, body: { reason: "x" } })).status).toBe(403);
    expect((await call(paymentRequest, { method: "POST", jar: f.owner.jar, params: { id: theirs.id } })).status).toBe(403);
  });
});

describe("outstanding and overdue", () => {
  it("CL-3: one minute before dueAt it is not overdue; one minute after it is", async () => {
    const f = await ownerWithFamily();
    const { e, sent } = await openClaim(f);
    const due = new Date(sent.json.claim.dueAt).getTime();
    setClock(new Date(due - MINUTE_MS));
    expect((await detail(f, e.id)).expense.settlement.overdue).toBe(false);
    expect((await expectOk(call(dashboard, { jar: f.owner.jar }))).json.totals.overdueToYou).toEqual({ cents: 0, count: 0 });
    setClock(new Date(due + MINUTE_MS));
    expect((await detail(f, e.id)).expense.settlement.overdue).toBe(true);
    expect((await expectOk(call(dashboard, { jar: f.owner.jar }))).json.totals.overdueToYou).toEqual({ cents: 6000, count: 1 });
  });

  it("CL-4: dashboard totals equal the sum of the claims (invariant 10)", async () => {
    const f = await ownerWithFamily();
    await openClaim(f);
    await openClaim(f, { description: "Second cleaning", amountCents: 8000 });
    await readyDentist(f, { description: "Not sent yet", amountCents: 5000 }); // READY, not a claim
    const d = await expectOk(call(dashboard, { jar: f.owner.jar }));
    expect(d.json.totals.owedToYou).toEqual({ cents: 6000 + 4000, count: 2 });
    expect(d.json.totals.youOwe).toEqual({ cents: 0, count: 0 });
    expect(d.json.actions.some((a: { action: { kind: string } }) => a.action.kind === "send_payment_request")).toBe(true);
  });

  it("CL-5: a second manual reminder within 72 hours is 429; after 72 hours it works", async () => {
    const f = await ownerWithFamily();
    const { e } = await openClaim(f);
    await expectOk(call(remind, { method: "POST", jar: f.owner.jar, params: { id: e.id } }));
    const again = await call(remind, { method: "POST", jar: f.owner.jar, params: { id: e.id } });
    expect(again.status).toBe(429);
    expect(Number(again.res.headers.get("retry-after"))).toBeGreaterThan(70 * 3600);
    setClock(new Date(Date.now() + 72 * 3600_000 + MINUTE_MS));
    await expectOk(call(remind, { method: "POST", jar: f.owner.jar, params: { id: e.id } }));
  });
});

describe("settled outside the app", () => {
  it("CL-6 and CL-7: the payer's report stays outstanding until confirmed; reject reopens it; confirm settles it", async () => {
    const f = await ownerWithFamily();
    const { e, token } = await openClaim(f);
    const jar = await guestSession(token, f.coParentEmail);
    await expectOk(call(reportExternal, { method: "POST", params: { token }, jar, body: { method: "Zelle", date: todayIso(), note: "Sent Sunday" } }));
    let d = await detail(f, e.id);
    expect(d.expense.settlement.state).toBe("EXTERNAL_PAYMENT_REPORTED");
    expect((await expectOk(call(dashboard, { jar: f.owner.jar }))).json.totals.owedToYou.cents).toBe(6000);
    await expectOk(call(externalAction, { method: "POST", jar: f.owner.jar, params: { id: e.id, action: "reject" } }));
    expect((await detail(f, e.id)).expense.settlement.state).toBe("AWAITING_PAYMENT");
    // The rejection email has a fresh link; report again, then confirm.
    const token2 = linkFromEmail(f.coParentEmail, "p");
    const jar2 = await guestSession(token2, f.coParentEmail);
    await expectOk(call(reportExternal, { method: "POST", params: { token: token2 }, jar: jar2, body: { method: "cash", date: todayIso() } }));
    await expectOk(call(externalAction, { method: "POST", jar: f.owner.jar, params: { id: e.id, action: "confirm" } }));
    d = await detail(f, e.id);
    expect(d.expense.settlement.state).toBe("SETTLED_EXTERNALLY");
    expect((await expectOk(call(dashboard, { jar: f.owner.jar }))).json.totals.owedToYou.cents).toBe(0);
  });

  it("marking received while the payer's report is pending confirms it: one event, not two", async () => {
    const f = await ownerWithFamily();
    const { e, token } = await openClaim(f);
    const jar = await guestSession(token, f.coParentEmail);
    await expectOk(call(reportExternal, { method: "POST", params: { token }, jar, body: { method: "cash", date: todayIso() } }));
    await expectOk(call(markReceived, { method: "POST", jar: f.owner.jar, params: { id: e.id } }));
    const d = await detail(f, e.id);
    const settlementRows = d.events.filter((x: { machine: string }) => x.machine === "settlement").map((x: { type: string }) => x.type);
    expect(settlementRows.slice(-2)).toEqual(["settlement.AWAITING_PAYMENT->EXTERNAL_PAYMENT_REPORTED", "settlement.EXTERNAL_PAYMENT_REPORTED->SETTLED_EXTERNALLY"]);
  });

  it("CL-8: marked received; the payer can contest on day 6 but not on day 8", async () => {
    const f = await ownerWithFamily();
    const { e } = await openClaim(f);
    await expectOk(call(markReceived, { method: "POST", jar: f.owner.jar, params: { id: e.id } }));
    const token = linkFromEmail(f.coParentEmail, "p");
    setClock(new Date(Date.now() + 8 * DAY_MS));
    const late = await call(dispute, { method: "POST", params: { id: e.id }, jar: await guestSession(token, f.coParentEmail), body: { reason: "I never paid this" } });
    expect(late.status).toBe(409);
    setClock(new Date(Date.now() + 6 * DAY_MS));
    const ok = await call(dispute, { method: "POST", params: { id: e.id }, jar: await guestSession(token, f.coParentEmail), body: { reason: "I never paid this" } });
    expect(ok.status).toBe(200);
    expect((await detail(f, e.id)).expense.settlement.state).toBe("DISPUTED");
  });

  it("CL-9: waiving needs a reason (400); with one it is WAIVED and the payment link stops working", async () => {
    const f = await ownerWithFamily();
    const { e, token } = await openClaim(f);
    expect((await call(waive, { method: "POST", jar: f.owner.jar, params: { id: e.id }, body: { reason: "  " } })).status).toBe(400);
    await expectOk(call(waive, { method: "POST", jar: f.owner.jar, params: { id: e.id }, body: { reason: "Birthday present" } }));
    expect((await detail(f, e.id)).expense.settlement).toMatchObject({ state: "WAIVED", waiverReason: "Birthday present" });
    expect((await call(linkSummary, { params: { token } })).status).toBe(410);
  });

  it("cancel after the payment request is allowed before payment; the payment link is revoked", async () => {
    const f = await ownerWithFamily();
    const { e, token } = await openClaim(f);
    await expectOk(call(cancelExpense, { method: "POST", jar: f.owner.jar, params: { id: e.id } }));
    expect((await detail(f, e.id)).expense.settlement.state).toBe("CANCELLED");
    expect((await call(linkSummary, { params: { token } })).status).toBe(410);
  });

  it("the payer can view the receipt through the payment link session, but not without it", async () => {
    const f = await ownerWithFamily();
    const { e, token } = await openClaim(f);
    const receiptId = (await detail(f, e.id)).expense.receiptId;
    expect((await call(receiptUrl, { params: { id: receiptId } })).status).toBe(401);
    const jar = await guestSession(token, f.coParentEmail);
    const r = await expectOk(call(receiptUrl, { params: { id: receiptId }, jar }));
    expect(r.json.url).toContain("/image/download");
  });
});

describe("disputes", () => {
  it("CL-11: two answers without agreement close the claim as UNRESOLVED; nothing is payable", async () => {
    const f = await ownerWithFamily();
    const { e, token } = await openClaim(f);
    const jar = await guestSession(token, f.coParentEmail);
    await expectOk(call(dispute, { method: "POST", params: { id: e.id }, jar, body: { reason: "We agreed you would cover cleanings", proposedCents: 3000 } }));
    // The same parent cannot answer twice in a row.
    expect((await call(respond, { method: "POST", params: { id: e.id }, jar, body: { action: "counter", reason: "again" } })).status).toBe(409);
    await expectOk(call(respond, { method: "POST", params: { id: e.id }, jar: f.owner.jar, body: { action: "counter", reason: "The agreement says 50/50, p. 2" } }));
    expect((await detail(f, e.id)).expense.settlement.state).toBe("DISPUTED");
    await expectOk(call(respond, { method: "POST", params: { id: e.id }, jar, body: { action: "counter", reason: "Still no" } }));
    const d = await detail(f, e.id);
    expect(d.expense.settlement.state).toBe("UNRESOLVED");
    const s = await expectOk(call(linkSummary, { params: { token: linkFromEmail(f.coParentEmail, "p") } }));
    expect(s.json.summary).toMatchObject({ state: "UNRESOLVED", canReport: false, canDispute: false, dispute: { status: "UNRESOLVED" } });
    expect(s.json.summary.dispute.rounds).toHaveLength(3);
  });

  it("agreeing to the payer's proposal reopens the claim with the revised amount", async () => {
    const f = await ownerWithFamily();
    const { e, token } = await openClaim(f);
    const jar = await guestSession(token, f.coParentEmail);
    await expectOk(call(dispute, { method: "POST", params: { id: e.id }, jar, body: { reason: "Half of it was a toothbrush for you", proposedCents: 5000 } }));
    await expectOk(call(respond, { method: "POST", params: { id: e.id }, jar: f.owner.jar, body: { action: "agree" } }));
    expect((await detail(f, e.id)).expense.settlement).toMatchObject({ state: "AWAITING_PAYMENT", owedCents: 5000 });
  });

  it("only the paying parent can open a dispute", async () => {
    const f = await ownerWithFamily();
    const { e } = await openClaim(f);
    expect((await call(dispute, { method: "POST", params: { id: e.id }, jar: f.owner.jar, body: { reason: "x" } })).status).toBe(403);
  });
});

describe("daily job: payment reminders", () => {
  it("CL-10: Family plan only; due soon, overdue day 1 and day 8 each go out once, even when the job runs twice", async () => {
    await resetEmulators();
    const f = await ownerWithFamily();
    const { sent } = await openClaim(f);
    const due = new Date(sent.json.claim.dueAt).getTime();
    const run = async () => (await expectOk(call(dailyJob, { method: "POST", headers: { authorization: `Bearer ${process.env.JOB_SECRET}` } }))).json.summary;
    const count = () => readMemoryOutbox().filter((m) => m.to === f.coParentEmail && /^(Due soon|Overdue)/.test(m.subject)).length;

    setClock(new Date(due - 2 * DAY_MS));
    expect((await run()).paymentReminders).toBe(0); // Free plan: no automatic reminders
    await db().collection("subscriptions").doc(f.familyId).set({ familyId: f.familyId, memberUids: [f.owner.uid], status: "ACTIVE", paypalSubscriptionId: "I-TEST", planId: "P-TEST", lastSyncedAt: Timestamp.now(), updatedAt: Timestamp.now() });
    expect((await run()).paymentReminders).toBe(1);
    expect((await run()).paymentReminders).toBe(0);
    expect(count()).toBe(1);
    setClock(new Date(due + 2 * 3600_000));
    expect((await run()).paymentReminders).toBe(1); // overdue day 1
    setClock(new Date(due + 9 * DAY_MS)); // a skipped week: only the latest reminder, once
    expect((await run()).paymentReminders).toBe(1);
    expect((await run()).paymentReminders).toBe(0);
    expect(count()).toBe(3);
  });

  it("the job needs the bearer secret", async () => {
    expect((await call(dailyJob, { method: "POST" })).status).toBe(401);
    expect((await call(dailyJob, { method: "POST", headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  });
});
