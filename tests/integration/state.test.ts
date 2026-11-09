import { beforeAll, describe, expect, it } from "vitest";
import { setClock } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { db, Timestamp } from "@/lib/firebase/admin";
import { newId } from "@/lib/ids";
import { route } from "@/lib/route";
import { transition } from "@/lib/state/transition";
import { call } from "../helpers/api";
import { resetEmulators } from "../helpers/emulator";

beforeAll(resetEmulators);

const DAY = 86_400_000;

async function makeExpense(approval: Record<string, unknown>, settlement: Record<string, unknown> = { state: "NONE", reminders: [] }) {
  const id = newId();
  const t = Timestamp.now();
  await db().collection("expenses").doc(id).set({
    familyId: "fam1", memberUids: ["u1"], createdBy: "u1", childId: "c1", category: "extracurricular",
    description: "Soccer camp", amountCents: 35_000, currency: "USD", mode: "planned", paidByRole: "owner", owedByRole: "coparent",
    ruleVersionId: "rv1",
    verdict: { code: "NEEDS_APPROVAL", citations: [], explanation: "", owedShareCents: 17_500, inputHash: "h", computedAt: t },
    approval, purchasedBeforeApproval: false, settlement, version: 1, createdAt: t, updatedAt: t,
  });
  return id;
}

async function events(id: string) {
  const s = await db().collection("expenses").doc(id).collection("events").orderBy("at").get();
  return s.docs.map((d) => d.data());
}

const owner = { kind: "owner" as const, uid: "u1" };
const coparent = { kind: "coparent" as const, tokenHash: "th" };

describe("transition()", () => {
  it("applies a row: new state, version + 1, one events row, one audit log", async () => {
    const id = await makeExpense({ state: "REQUIRED" });
    const r = await transition({
      expenseId: id, machine: "approval", event: "SEND_REQUEST", actor: owner,
      payload: { requestId: `${id}_1`, expiresAt: new Date(Date.now() + 14 * DAY) },
      loadFacts: async () => ({ dailyRequestCount: 0 }),
    });
    expect(r).toMatchObject({ outcome: "applied", from: "REQUIRED", to: "REQUESTED", version: 2 });
    const doc = (await db().collection("expenses").doc(id).get()).data()!;
    expect(doc.approval.state).toBe("REQUESTED");
    expect(doc.approval.currentRequestId).toBe(`${id}_1`);
    expect(doc.version).toBe(2);
    const ev = await events(id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "approval.REQUIRED->REQUESTED", machine: "approval", from: "REQUIRED", to: "REQUESTED", actor: { kind: "owner", uid: "u1" } });
    const audits = await db().collection("auditLogs").where("target", "==", `expenses/${id}`).get();
    expect(audits.size).toBe(1);
  });

  it("disallowed pair is 409 and writes nothing", async () => {
    const id = await makeExpense({ state: "DECLINED" });
    await expect(transition({ expenseId: id, machine: "approval", event: "APPROVE", actor: coparent })).rejects.toMatchObject({ status: 409, code: "STATE_CONFLICT" });
    expect((await db().collection("expenses").doc(id).get()).data()!.version).toBe(1);
    expect(await events(id)).toHaveLength(0);
  });

  it("an event that already happened is recorded as noop and not applied twice", async () => {
    const id = await makeExpense({ state: "REQUESTED", expiresAt: Timestamp.fromMillis(Date.now() + DAY) });
    await transition({ expenseId: id, machine: "approval", event: "APPROVE", actor: coparent });
    const again = await transition({ expenseId: id, machine: "approval", event: "APPROVE", actor: coparent });
    expect(again.outcome).toBe("noop");
    const doc = (await db().collection("expenses").doc(id).get()).data()!;
    expect(doc.version).toBe(2);
    const ev = await events(id);
    expect(ev.filter((e) => e.machine === "approval")).toHaveLength(1);
    expect(ev.filter((e) => e.data?.noop)).toHaveLength(1);
  });

  it("derived expiry is persisted by the next write with its own events row", async () => {
    const id = await makeExpense({ state: "REQUESTED", expiresAt: Timestamp.fromMillis(Date.now() + DAY) });
    setClock(new Date(Date.now() + 2 * DAY));
    const r = await transition({
      expenseId: id, machine: "approval", event: "RESEND", actor: owner,
      payload: { requestId: `${id}_2`, expiresAt: new Date(Date.now() + 16 * DAY) },
      loadFacts: async () => ({ dailyRequestCount: 1 }),
    });
    expect(r).toMatchObject({ from: "EXPIRED", to: "REQUESTED", version: 3 });
    const ev = await events(id);
    expect(ev.map((e) => e.type)).toEqual(["approval.REQUESTED->EXPIRED", "approval.EXPIRED->REQUESTED"]);
  });

  it("a decision on an expired request is refused (first decision after expiry is not possible)", async () => {
    const id = await makeExpense({ state: "REQUESTED", expiresAt: Timestamp.fromMillis(Date.now() + DAY) });
    setClock(new Date(Date.now() + 2 * DAY));
    await expect(transition({ expenseId: id, machine: "approval", event: "APPROVE", actor: coparent })).rejects.toMatchObject({ status: 409 });
  });

  it("DB-1: two concurrent decisions: exactly one wins, the other gets 409 or a noop", async () => {
    const id = await makeExpense({ state: "REQUESTED", expiresAt: Timestamp.fromMillis(Date.now() + DAY) });
    const results = await Promise.allSettled([
      transition({ expenseId: id, machine: "approval", event: "APPROVE", actor: coparent }),
      transition({ expenseId: id, machine: "approval", event: "DECLINE", actor: coparent, payload: { reason: "no" } }),
      transition({ expenseId: id, machine: "approval", event: "APPROVE", actor: coparent }),
    ]);
    const applied = results.filter((r) => r.status === "fulfilled" && r.value.outcome === "applied");
    expect(applied).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as AppError).status).toBe(409);
    }
    const ev = (await events(id)).filter((e) => e.machine === "approval");
    expect(ev).toHaveLength(1);
    const doc = (await db().collection("expenses").doc(id).get()).data()!;
    expect(doc.version).toBe(2);
  });

  it("notifications are created in the transaction and deduped by key", async () => {
    const id = await makeExpense({ state: "REQUESTED", expiresAt: Timestamp.fromMillis(Date.now() + DAY) });
    const notify = () => [{ dedupeKey: `test:${id}:1`, familyId: "fam1", toUid: "u1", toEmail: "a@example.com", type: "approval_decision" as const, title: "t", body: "b", sendEmail: false }];
    const first = await transition({ expenseId: id, machine: "approval", event: "APPROVE", actor: coparent, notify });
    expect(first.notifications).toHaveLength(1);
    const id2 = await makeExpense({ state: "REQUESTED", expiresAt: Timestamp.fromMillis(Date.now() + DAY) });
    // Same key from a different transition: not created twice (invariant 12).
    const second = await transition({ expenseId: id2, machine: "approval", event: "APPROVE", actor: coparent, notify });
    expect(second.notifications).toHaveLength(0);
    const doc = await db().collection("notifications").doc(`test:${id}:1`).get();
    expect(doc.data()).toMatchObject({ toUid: "u1", read: false, email: { status: "skipped" } });
  });

  it("settlement: payment request sets owedCents and dueAt", async () => {
    const id = await makeExpense({ state: "APPROVED", approvedCents: 35_000 }, { state: "READY", reminders: [] });
    const due = new Date(Date.now() + 30 * DAY);
    await transition({ expenseId: id, machine: "settlement", event: "SEND_PAYMENT_REQUEST", actor: owner, payload: { owedCents: 17_500, dueAt: due } });
    const doc = (await db().collection("expenses").doc(id).get()).data()!;
    expect(doc.settlement.state).toBe("AWAITING_PAYMENT");
    expect(doc.settlement.owedCents).toBe(17_500);
    expect(doc.settlement.dueAt.toMillis()).toBe(due.getTime());
  });

  it("unknown expense is 404", async () => {
    await expect(transition({ expenseId: "nope", machine: "approval", event: "APPROVE", actor: coparent })).rejects.toMatchObject({ status: 404 });
  });
});

describe("route() error mapping", () => {
  it("DB-2: Firestore unavailable becomes 503 DB_UNAVAILABLE with a request id", async () => {
    const handler = route({ name: "TEST", auth: "none" }, async () => {
      throw Object.assign(new Error("14 UNAVAILABLE: connection refused"), { code: 14 });
    });
    const r = await call(handler);
    expect(r.status).toBe(503);
    expect(r.json.error).toMatchObject({ code: "DB_UNAVAILABLE" });
    expect(r.json.error.requestId).toBeTruthy();
    expect(JSON.stringify(r.json)).not.toContain("connection refused");
  });

  it("unknown errors become 500 without leaking the message", async () => {
    const handler = route({ name: "TEST", auth: "none" }, async () => {
      throw new Error("secret internal detail");
    });
    const r = await call(handler);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.json)).not.toContain("secret internal detail");
  });

  it("invalid JSON is 400", async () => {
    const { z } = await import("zod");
    const handler = route({ name: "TEST", auth: "none", body: z.object({ a: z.string() }) }, async () => ({ ok: true }));
    const req = new Request("http://localhost/api/x", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });
});
