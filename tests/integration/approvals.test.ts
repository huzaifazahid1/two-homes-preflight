import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as cancelRequest } from "@/app/api/expenses/[id]/approval-request/route";
import { GET as getExpense } from "@/app/api/expenses/[id]/route";
import { POST as dailyJob } from "@/app/api/jobs/daily/route";
import { GET as linkSummary } from "@/app/api/links/[token]/route";
import { POST as decision } from "@/app/api/links/[token]/decision/route";
import { POST as sendOtp } from "@/app/api/links/[token]/otp/route";
import { DAY_MS, setClock } from "@/lib/clock";
import { readMemoryOutbox } from "@/lib/email/outbox";
import { db } from "@/lib/firebase/admin";
import { call, CookieJar } from "../helpers/api";
import { approve, askApproval, clearCloudinary, guestSession, linkFromEmail, newExpense, upload, jpegBytes, withCloudinary, type Fam } from "../helpers/claims";
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

const JOB = { authorization: `Bearer ${process.env.JOB_SECRET}` };
const runJob = () => call(dailyJob, { method: "POST", headers: JOB });

async function detail(f: Fam, id: string) {
  return (await expectOk(call(getExpense, { jar: f.owner.jar, params: { id } }))).json;
}

describe("approval request and decision", () => {
  it("AP-1: approve via link with code; the requester sees APPROVED with one timeline row and a notification", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    expect(e.approval.state).toBe("REQUIRED");
    const req = await expectOk(askApproval(f, e.id));
    expect(req.json.sent).toMatchObject({ email: { status: "sent" } });
    expect(req.json.expense.approval.state).toBe("REQUESTED");
    const mail = readMemoryOutbox().find((m) => m.to === f.coParentEmail && m.subject.includes("asks for your approval"))!;
    expect(mail.text).toContain("$140.00"); // Sara's 40% share of $350
    const token = linkFromEmail(f.coParentEmail, "a");

    // Read-only before the code: the summary shows amount, split, clause; no action possible.
    const summary = await expectOk(call(linkSummary, { params: { token } }));
    expect(summary.json.summary).toMatchObject({ purpose: "approval", amountCents: 35000, owedShareCents: 14000, owedPct: 40, canAct: false, decision: null, clause: { page: 4 } });
    const noSession = await call(decision, { method: "POST", params: { token }, body: { decision: "APPROVED" } });
    expect(noSession.status).toBe(401);

    const jar = await guestSession(token, f.coParentEmail);
    const r = await expectOk(call(decision, { method: "POST", params: { token }, jar, body: { decision: "APPROVED" } }));
    expect(r.json.result).toMatchObject({ decision: "APPROVED", approvedCents: 35000 });

    const d = await detail(f, e.id);
    expect(d.expense.approval).toMatchObject({ state: "APPROVED", approvedCents: 35000 });
    expect(d.events.filter((x: { machine: string }) => x.machine === "approval").map((x: { type: string }) => x.type)).toEqual(["approval.REQUIRED->REQUESTED", "approval.REQUESTED->APPROVED"]);
    const notif = await db().collection("notifications").where("toUid", "==", f.owner.uid).where("type", "==", "approval_decision").get();
    expect(notif.size).toBe(1);
    expect(readMemoryOutbox().some((m) => m.to === f.owner.email && m.subject.includes("approved"))).toBe(true);
  });

  it("AP-2: partial approval of $200 of $350 stores approvedCents 20000", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    const { r } = await approve(f, e.id, { decision: "PARTIALLY_APPROVED", approvedCents: 20000, reason: "Only the camp fee" });
    expect(r.status).toBe(200);
    const d = await detail(f, e.id);
    expect(d.expense.approval).toMatchObject({ state: "PARTIALLY_APPROVED", approvedCents: 20000, reason: "Only the camp fee" });
  });

  it("partial approval must be below the full amount (400)", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    const { r } = await approve(f, e.id, { decision: "PARTIALLY_APPROVED", approvedCents: 35000 });
    expect(r.status).toBe(400);
  });

  it("AP-3: decline, then a new request within 7 days is 409 with the date; after 7 days it works", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    const { r } = await approve(f, e.id, { decision: "DECLINED", reason: "Too expensive" });
    expect(r.status).toBe(200);
    const again = await askApproval(f, e.id);
    expect(again.status).toBe(409);
    expect(again.json.error.details.blockedUntil).toBeTruthy();
    expect(again.json.error.message).toMatch(/ask again from/);
    setClock(new Date(Date.now() + 7 * DAY_MS + 60_000));
    const later = await expectOk(askApproval(f, e.id));
    expect(later.json.expense.approval.state).toBe("REQUESTED");
    const approvals = await db().collection("approvals").where("expenseId", "==", e.id).get();
    expect(approvals.docs.map((d) => d.id).sort()).toEqual([`${e.id}_1`, `${e.id}_2`]);
  });

  it("AP-4 and CL-10: no decision for 3 days sends exactly one reminder, even if the job runs twice", async () => {
    await resetEmulators(); // the job scans every family: start from an empty database
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await expectOk(askApproval(f, e.id));
    const firstToken = linkFromEmail(f.coParentEmail, "a");
    setClock(new Date(Date.now() + 2 * DAY_MS));
    expect((await expectOk(runJob())).json.summary.approvalReminders).toBe(0);
    setClock(new Date(Date.now() + 3 * DAY_MS + 60_000));
    const one = await expectOk(runJob());
    expect(one.json.summary.approvalReminders).toBe(1);
    const two = await expectOk(runJob());
    expect(two.json.summary.approvalReminders).toBe(0);
    const reminders = readMemoryOutbox().filter((m) => m.to === f.coParentEmail && m.subject.startsWith("Reminder:"));
    expect(reminders).toHaveLength(1);
    // The reminder carries a new link; the first one is revoked.
    const newToken = linkFromEmail(f.coParentEmail, "a");
    expect(newToken).not.toBe(firstToken);
    expect((await call(linkSummary, { params: { token: firstToken } })).status).toBe(410);
    expect((await call(linkSummary, { params: { token: newToken } })).status).toBe(200);
  });

  it("AP-5: 15 days later the request is effectively EXPIRED, the link is 410 and the job persists it", async () => {
    await resetEmulators();
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await expectOk(askApproval(f, e.id));
    const token = linkFromEmail(f.coParentEmail, "a");
    const jar = await guestSession(token, f.coParentEmail);
    setClock(new Date(Date.now() + 15 * DAY_MS));
    expect((await detail(f, e.id)).expense.approval.state).toBe("EXPIRED");
    expect((await call(linkSummary, { params: { token } })).status).toBe(410);
    const late = await call(decision, { method: "POST", params: { token }, jar, body: { decision: "APPROVED" } });
    expect(late.status).toBe(410);
    const job = await expectOk(runJob());
    expect(job.json.summary.expiredApprovals).toBe(1);
    const stored = (await db().collection("expenses").doc(e.id).get()).data()!;
    expect(stored.approval.state).toBe("EXPIRED");
    expect((await expectOk(runJob())).json.summary.expiredApprovals).toBe(0);
    // The owner can send it again.
    expect((await expectOk(askApproval(f, e.id))).json.expense.approval.state).toBe("REQUESTED");
  });

  it("AP-6 and LK-7: a second decision is 409; the used link stays read-only and shows the first answer", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    const { token, jar } = await approve(f, e.id);
    const second = await call(decision, { method: "POST", params: { token }, jar, body: { decision: "DECLINED" } });
    expect(second.status).toBe(409);
    expect(second.json.error.details.alreadyDecided).toBe(true);
    const s = await expectOk(call(linkSummary, { params: { token } }));
    expect(s.json.summary.decision).toMatchObject({ decision: "APPROVED", approvedCents: 35000 });
    // No new code for a used link.
    expect((await call(sendOtp, { method: "POST", params: { token }, jar: new CookieJar() })).status).toBe(410);
    expect((await detail(f, e.id)).expense.approval.state).toBe("APPROVED");
  });

  it("concurrent decisions: exactly one wins", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await expectOk(askApproval(f, e.id));
    const token = linkFromEmail(f.coParentEmail, "a");
    const jar = await guestSession(token, f.coParentEmail);
    const [a, b] = await Promise.all([
      call(decision, { method: "POST", params: { token }, jar, body: { decision: "APPROVED" } }),
      call(decision, { method: "POST", params: { token }, jar, body: { decision: "DECLINED" } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const events = await db().collection("expenses").doc(e.id).collection("events").where("machine", "==", "approval").get();
    expect(events.size).toBe(2); // REQUESTED + one decision
  });

  it("AP-7: the 6th approval request of the family in a day is 429", async () => {
    const f = await ownerWithFamily();
    for (let i = 0; i < 5; i++) {
      const e = await newExpense(f, { description: `Camp week ${i}` });
      await expectOk(askApproval(f, e.id));
    }
    const sixth = await newExpense(f, { description: "Camp week 6" });
    const r = await askApproval(f, sixth.id);
    expect(r.status).toBe(429);
    expect(r.res.headers.get("retry-after")).toBeTruthy();
    expect((await detail(f, sixth.id)).expense.approval.state).toBe("REQUIRED");
  });

  it("AP-8: the owner cancels a pending request: link 410, state CANCELLED", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await expectOk(askApproval(f, e.id));
    const token = linkFromEmail(f.coParentEmail, "a");
    const r = await expectOk(call(cancelRequest, { method: "DELETE", jar: f.owner.jar, params: { id: e.id } }));
    expect(r.json.expense.approval.state).toBe("CANCELLED");
    expect((await call(linkSummary, { params: { token } })).status).toBe(410);
  });

  it("only the buying parent can ask for approval (403 for the other parent's expense)", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f, { paidByRole: "coparent" });
    expect((await askApproval(f, e.id)).status).toBe(403);
  });

  it("AP-9: a receipt uploaded while the request is open marks it purchased before approval (banner on the link)", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await expectOk(askApproval(f, e.id));
    const token = linkFromEmail(f.coParentEmail, "a");
    expect((await expectOk(call(linkSummary, { params: { token } }))).json.summary.purchasedBeforeApproval).toBe(false);
    const up = await upload(f.owner.jar, e.id, jpegBytes());
    expect(up.status).toBe(201);
    expect((await expectOk(call(linkSummary, { params: { token } }))).json.summary.purchasedBeforeApproval).toBe(true);
    expect((await detail(f, e.id)).expense.purchasedBeforeApproval).toBe(true);
  });

  it("cancelling the expense revokes the open approval link", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await expectOk(askApproval(f, e.id));
    const token = linkFromEmail(f.coParentEmail, "a");
    const { POST: cancelExpense } = await import("@/app/api/expenses/[id]/cancel/route");
    await expectOk(call(cancelExpense, { method: "POST", jar: f.owner.jar, params: { id: e.id } }));
    expect((await call(linkSummary, { params: { token } })).status).toBe(410);
  });
});
