import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listExpenses, POST as createExpense } from "@/app/api/expenses/route";
import { GET as getExpense, PATCH as patchExpense } from "@/app/api/expenses/[id]/route";
import { POST as cancelExpense } from "@/app/api/expenses/[id]/cancel/route";
import { POST as preflight } from "@/app/api/expenses/preflight/route";
import { POST as quickAdd } from "@/app/api/ai/expense-parse/route";
import { POST as sendOtp } from "@/app/api/links/[token]/otp/route";
import { POST as verifyOtp } from "@/app/api/links/[token]/otp/verify/route";
import { POST as rulesAck } from "@/app/api/links/[token]/rules-ack/route";
import { POST as accept } from "@/app/api/links/[token]/accept/route";
import { setClock } from "@/lib/clock";
import { db, Timestamp } from "@/lib/firebase/admin";
import { transition } from "@/lib/state/transition";
import { call, CookieJar } from "../helpers/api";
import { resetEmulators } from "../helpers/emulator";
import { expectOk, lastCodeFor, ownerWithFamily, ownerWithInvite } from "../helpers/flows";
import { GEMINI_PATH, geminiJson, withGemini } from "../helpers/gemini";
import { StubServer } from "../helpers/stub-server";

const stub = new StubServer();
beforeAll(async () => {
  await resetEmulators();
  await stub.start();
});
afterAll(() => stub.stop());
beforeEach(() => stub.reset());

type Fam = Awaited<ReturnType<typeof ownerWithFamily>>;
const body = (f: Fam, over: Record<string, unknown> = {}) => ({ childId: f.childId, category: "extracurricular", description: "Riverside FC soccer camp", vendor: "Riverside FC", amountCents: 35000, mode: "planned", date: "2026-11-14", paidByRole: "owner", ...over });
const create = (f: Fam, over: Record<string, unknown> = {}) => call(createExpense, { method: "POST", path: "/api/expenses", jar: f.owner.jar, body: body(f, over) });

describe("preflight and create", () => {
  it("demo: $350 soccer camp needs approval citing p. 4 ($140 owed); $120 dentist is eligible", async () => {
    const f = await ownerWithFamily();
    const pf = await expectOk(call(preflight, { method: "POST", jar: f.owner.jar, body: body(f) }));
    expect(pf.json.preflight).toMatchObject({ verdict: "NEEDS_APPROVAL", shares: { owedShareCents: 14000 }, rule: { page: 4 }, owedByRole: "coparent" });
    expect(pf.json.preflight.citations[0].page).toBe(4);
    // Preflight writes nothing.
    expect((await db().collection("expenses").where("familyId", "==", f.familyId).get()).size).toBe(0);

    const camp = await expectOk(create(f));
    expect(camp.status).toBe(201);
    expect(camp.json.expense).toMatchObject({ verdict: { code: "NEEDS_APPROVAL", owedShareCents: 14000 }, approval: { state: "REQUIRED" }, settlement: { state: "NONE" }, version: 1, date: "2026-11-14" });

    const dentist = await expectOk(create(f, { category: "dental", description: "Bright Smile Dental cleaning", vendor: "Bright Smile Dental", amountCents: 12000 }));
    expect(dentist.json.expense).toMatchObject({ verdict: { code: "ELIGIBLE", owedShareCents: 6000 }, approval: { state: "NOT_REQUIRED" } });

    const detail = await expectOk(call(getExpense, { jar: f.owner.jar, params: { id: camp.json.expense.id } }));
    expect(detail.json.events).toHaveLength(1);
    expect(detail.json.events[0]).toMatchObject({ type: "expense.created", to: "NEEDS_APPROVAL", actor: "owner" });

    const list = await expectOk(call(listExpenses, { jar: f.owner.jar, path: "/api/expenses?limit=10" }));
    expect(list.json.items.map((e: { description: string }) => e.description)).toEqual(["Bright Smile Dental cleaning", "Riverside FC soccer camp"]);
  });

  it("PF-8: an eligible expense has approval NOT_REQUIRED and no approval token", async () => {
    const f = await ownerWithFamily();
    const e = await expectOk(create(f, { category: "school_supplies", description: "Notebooks", amountCents: 4500 }));
    expect(e.json.expense.approval.state).toBe("NOT_REQUIRED");
    const tokens = await db().collection("linkTokens").where("familyId", "==", f.familyId).where("purpose", "==", "approval").get();
    expect(tokens.size).toBe(0);
  });

  it("PF-4: a category without a rule is NOT_COVERED and blocks requests (409)", async () => {
    const f = await ownerWithFamily();
    const e = await expectOk(create(f, { category: "travel", description: "Flight to grandma", amountCents: 42000 }));
    expect(e.json.expense.verdict.code).toBe("NOT_COVERED");
    await expect(
      transition({ expenseId: e.json.expense.id, machine: "approval", event: "SEND_REQUEST", actor: { kind: "owner" }, payload: { requestId: "x", expiresAt: new Date(Date.now() + 1e9) } }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("PF-6: amount 0, negative, over $100,000 and non-USD are 400", async () => {
    const f = await ownerWithFamily();
    for (const over of [{ amountCents: 0 }, { amountCents: -500 }, { amountCents: 10_000_001 }, { amountCents: 12.5 }, { currency: "EUR" }]) {
      const r = await create(f, over);
      expect(r.status, JSON.stringify(over)).toBe(400);
    }
    expect((await create(f, { childId: "unknownchild1" })).status).toBe(400);
    expect((await create(f, { mode: "purchased", date: "2099-01-01" })).status).toBe(400);
  });

  it("PF-7: a duplicate within 24 h needs confirmation", async () => {
    const f = await ownerWithFamily();
    const first = await expectOk(create(f, { category: "dental", description: "Dentist", amountCents: 12000 }));
    const dup = await create(f, { category: "dental", description: "  dentist ", amountCents: 12000 });
    expect(dup.status).toBe(409);
    expect(dup.json.error).toMatchObject({ code: "DUPLICATE", details: { possibleDuplicateOf: first.json.expense.id, confirmRequired: true } });
    const ok = await expectOk(create(f, { category: "dental", description: "Dentist", amountCents: 12000, confirmDuplicate: true }));
    expect(ok.json.expense.possibleDuplicateOf).toBe(first.json.expense.id);
    // After 24 hours it is not a duplicate any more.
    setClock(new Date(Date.now() + 25 * 3600_000));
    expect((await create(f, { category: "dental", description: "Dentist", amountCents: 12000 })).status).toBe(201);
  });

  it("purchased first: approval was required before purchase", async () => {
    const f = await ownerWithFamily();
    const e = await expectOk(create(f, { mode: "purchased", date: "2026-11-01" }));
    expect(e.json.expense).toMatchObject({ purchasedBeforeApproval: true, approval: { state: "REQUIRED" } });
    expect(e.json.expense.verdict.explanation).toMatch(/^Approval was required before purchase/);
  });

  it("AZ-2: another family's expense is 403 and audited", async () => {
    const a = await ownerWithFamily();
    const b = await ownerWithFamily();
    const e = await expectOk(create(b));
    const r = await call(getExpense, { jar: a.owner.jar, params: { id: e.json.expense.id } });
    expect(r.status).toBe(403);
    expect((await call(patchExpense, { method: "PATCH", jar: a.owner.jar, params: { id: e.json.expense.id }, body: { amountCents: 100, version: 1 } })).status).toBe(403);
    const logs = await db().collection("auditLogs").where("familyId", "==", a.familyId).where("action", "==", "forbidden.expense").get();
    expect(logs.size).toBe(2);
  });

  it("SE-4: description and vendor are stored as plain text (rendered as text by React)", async () => {
    const f = await ownerWithFamily();
    const e = await expectOk(create(f, { category: "dental", description: "<img src=x onerror=alert(1)>", vendor: "<script>x</script>" }));
    expect(e.json.expense.description).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("edit and cancel", () => {
  it("raising an eligible amount over the threshold moves approval to REQUIRED with events", async () => {
    const f = await ownerWithFamily();
    const e = (await expectOk(create(f, { amountCents: 15000 }))).json.expense;
    expect(e.approval.state).toBe("NOT_REQUIRED");
    const r = await expectOk(call(patchExpense, { method: "PATCH", jar: f.owner.jar, params: { id: e.id }, body: { amountCents: 25000, version: e.version } }));
    expect(r.json.expense).toMatchObject({ verdict: { code: "NEEDS_APPROVAL" }, approval: { state: "REQUIRED" }, amountCents: 25000, version: 3 });
    expect(r.json.events.map((x: { type: string }) => x.type)).toEqual(["expense.created", "expense.edited", "approval.NOT_REQUIRED->REQUIRED"]);
  });

  it("PF-9: raising an approved amount sends approval back to REQUIRED with an event row", async () => {
    const f = await ownerWithFamily();
    const e = (await expectOk(create(f))).json.expense;
    await transition({ expenseId: e.id, machine: "approval", event: "SEND_REQUEST", actor: { kind: "owner" }, payload: { requestId: "req1", expiresAt: new Date(Date.now() + 14 * 86_400_000) } });
    await transition({ expenseId: e.id, machine: "approval", event: "APPROVE", actor: { kind: "coparent" } });
    const cur = (await call(getExpense, { jar: f.owner.jar, params: { id: e.id } })).json.expense;
    expect(cur.approval).toMatchObject({ state: "APPROVED", approvedCents: 35000 });

    const lower = await expectOk(call(patchExpense, { method: "PATCH", jar: f.owner.jar, params: { id: e.id }, body: { amountCents: 34000, version: cur.version } }));
    expect(lower.json.expense.approval.state).toBe("APPROVED");

    const raised = await expectOk(call(patchExpense, { method: "PATCH", jar: f.owner.jar, params: { id: e.id }, body: { amountCents: 36000, version: lower.json.expense.version } }));
    expect(raised.json.expense.approval.state).toBe("REQUIRED");
    expect(raised.json.events.some((x: { type: string; data: { newAmountCents?: number } }) => x.type === "approval.APPROVED->REQUIRED" && x.data.newAmountCents === 36000)).toBe(true);
  });

  it("a stale version is 409; an open request blocks editing", async () => {
    const f = await ownerWithFamily();
    const e = (await expectOk(create(f))).json.expense;
    expect((await call(patchExpense, { method: "PATCH", jar: f.owner.jar, params: { id: e.id }, body: { description: "x", version: 99 } })).status).toBe(409);
    await transition({ expenseId: e.id, machine: "approval", event: "SEND_REQUEST", actor: { kind: "owner" }, payload: { requestId: "r", expiresAt: new Date(Date.now() + 1e9) } });
    expect((await call(patchExpense, { method: "PATCH", jar: f.owner.jar, params: { id: e.id }, body: { description: "x", version: 2 } })).status).toBe(409);
  });

  it("cancel goes through the settlement machine; a second cancel is a no-op", async () => {
    const f = await ownerWithFamily();
    const e = (await expectOk(create(f, { category: "dental", amountCents: 5000, description: "Floss" }))).json.expense;
    const r = await expectOk(call(cancelExpense, { method: "POST", jar: f.owner.jar, params: { id: e.id } }));
    expect(r.json.expense.settlement.state).toBe("CANCELLED");
    expect((await call(cancelExpense, { method: "POST", jar: f.owner.jar, params: { id: e.id } })).status).toBe(200);
    expect((await call(patchExpense, { method: "PATCH", jar: f.owner.jar, params: { id: e.id }, body: { description: "x", version: r.json.expense.version } })).status).toBe(409);
  });
});

describe("quick add", () => {
  it("PF-10: fills the form; unspecified fields stay empty; an invented amount is dropped", async () => {
    const f = await ownerWithFamily();
    stub.on("POST", GEMINI_PATH, () => geminiJson({ childFirstName: "Mia", category: "extracurricular", amountDollars: "350", date: "2026-11-14", vendor: "Riverside FC", description: "Soccer camp", alreadyPurchased: false }));
    const r = await withGemini(stub, () => call(quickAdd, { method: "POST", jar: f.owner.jar, body: { text: "Mia soccer camp $350 next Saturday at Riverside FC" } }));
    expect(r.status).toBe(200);
    expect(r.json.fields).toEqual({ childId: f.childId, category: "extracurricular", amountCents: 35000, date: "2026-11-14", vendor: "Riverside FC", description: "Soccer camp", mode: "planned" });
    const prompt = JSON.parse(stub.calls[0].body);
    expect(JSON.stringify(prompt.contents)).toContain("Allowed children: Mia");

    stub.on("POST", GEMINI_PATH, () => geminiJson({ category: "dental", amountDollars: "120", description: "Dentist" }));
    const r2 = await withGemini(stub, () => call(quickAdd, { method: "POST", jar: f.owner.jar, body: { text: "dentist visit for the kid" } }));
    expect(r2.json.fields).toMatchObject({ childId: null, amountCents: null, date: null, vendor: null, mode: null, category: "dental" });
  });

  it("PF-11: past tense becomes mode purchased", async () => {
    const f = await ownerWithFamily();
    stub.on("POST", GEMINI_PATH, () => geminiJson({ childFirstName: "Mia", category: "clothing", amountDollars: "64.50", alreadyPurchased: true, description: "Winter coat" }));
    const r = await withGemini(stub, () => call(quickAdd, { method: "POST", jar: f.owner.jar, body: { text: "Bought Mia a winter coat yesterday for $64.50" } }));
    expect(r.json.fields).toMatchObject({ mode: "purchased", amountCents: 6450 });
  });

  it("SE-6 / NW-2: rate limited at 30 per hour; AI failure is a 502 with a request id", async () => {
    const f = await ownerWithFamily();
    stub.on("POST", GEMINI_PATH, () => ({ status: 500, json: { error: { code: 500, message: "boom" } } }));
    const fail = await withGemini(stub, () => call(quickAdd, { method: "POST", jar: f.owner.jar, body: { text: "Mia camp $350" } }));
    expect(fail.status).toBe(502);
    expect(fail.json.error.requestId).toBeTruthy();
    await db().collection("rateLimits").doc(`quick-add:${f.owner.uid}`).set({ count: 30, windowStart: Timestamp.now() });
    const limited = await withGemini(stub, () => call(quickAdd, { method: "POST", jar: f.owner.jar, body: { text: "Mia camp $350" } }));
    expect(limited.status).toBe(429);
    expect(limited.res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("co-parent rule acknowledgement", () => {
  it("AG-12: disagreeing with a rule puts affected expenses into NEEDS_REVIEW; agreeing restores them", async () => {
    const f = await ownerWithInvite();
    const camp = (await expectOk(create(f))).json.expense;
    const dentist = (await expectOk(create(f, { category: "dental", description: "Dentist", amountCents: 12000 }))).json.expense;
    const extra = f.ruleVersion.rules.find((r) => r.category === "extracurricular")!;

    const link = new CookieJar();
    await expectOk(call(sendOtp, { method: "POST", params: { token: f.token }, jar: link }));
    await expectOk(call(verifyOtp, { method: "POST", params: { token: f.token }, jar: link, body: { code: lastCodeFor(f.coParentEmail) } }));

    const noSession = await call(rulesAck, { method: "POST", params: { token: f.token }, body: { perRule: { [extra.id]: "disagree" } } });
    expect(noSession.status).toBe(401);

    const ack = await expectOk(call(rulesAck, { method: "POST", params: { token: f.token }, jar: link, body: { perRule: { [extra.id]: "disagree" } } }));
    expect(ack.json).toMatchObject({ saved: true, disagreed: 1, recomputed: 1 });
    const after = (await call(getExpense, { jar: f.owner.jar, params: { id: camp.id } })).json;
    expect(after.expense.verdict.code).toBe("NEEDS_REVIEW");
    expect(after.events.at(-1)).toMatchObject({ type: "verdict.recomputed", from: "NEEDS_APPROVAL", to: "NEEDS_REVIEW", actor: "system" });
    expect((await call(getExpense, { jar: f.owner.jar, params: { id: dentist.id } })).json.expense.verdict.code).toBe("ELIGIBLE");

    // Accepting with "agree" changes the answer and restores the verdict.
    await expectOk(call(accept, { method: "POST", params: { token: f.token }, jar: link, body: { perRule: { [extra.id]: "agree" } } }));
    expect((await call(getExpense, { jar: f.owner.jar, params: { id: camp.id } })).json.expense.verdict.code).toBe("NEEDS_APPROVAL");

    // LK-7: the used invite link cannot change answers any more.
    expect((await call(rulesAck, { method: "POST", params: { token: f.token }, jar: link, body: { perRule: { [extra.id]: "disagree" } } })).status).toBe(410);
  });
});
