import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as cancelExpense } from "@/app/api/expenses/[id]/cancel/route";
import { POST as dispute } from "@/app/api/expenses/[id]/dispute/route";
import { POST as markReceived } from "@/app/api/expenses/[id]/mark-received/route";
import { POST as waive } from "@/app/api/expenses/[id]/waive/route";
import { POST as respond } from "@/app/api/disputes/[id]/respond/route";
import { POST as dailyJob } from "@/app/api/jobs/daily/route";
import { DAY_MS, resetClock, setClock } from "@/lib/clock";
import { db } from "@/lib/firebase/admin";
import { checkInvariants } from "@/lib/invariants";
import { call } from "../helpers/api";
import { approve, askApproval, claimSent, clearCloudinary, guestSession, linkFromEmail, newExpense, receiptReady, withCloudinary } from "../helpers/claims";
import { resetEmulators } from "../helpers/emulator";
import { expectOk, ownerWithFamily } from "../helpers/flows";
import { StubServer } from "../helpers/stub-server";

// Phase 3 completion criterion: invariants 1, 2, 6, 8, 10, 11 hold on data made by the real flows.

const stub = new StubServer();
beforeAll(async () => {
  await resetEmulators();
  await stub.start();
});
afterAll(() => stub.stop());
beforeEach(() => withCloudinary(stub));
afterEach(clearCloudinary);

describe("invariants on Phase 3 data", () => {
  it("every flow leaves zero violations", async () => {
    const f = await ownerWithFamily();
    // Approved in full, receipt, claim, marked received.
    const camp = await newExpense(f);
    await approve(f, camp.id);
    await receiptReady(f, camp.id);
    await claimSent(f, camp.id);
    await expectOk(call(markReceived, { method: "POST", jar: f.owner.jar, params: { id: camp.id } }));
    // Partially approved, claim capped (invariant 6), waived.
    const partial = await newExpense(f, { description: "Spring league" });
    await approve(f, partial.id, { decision: "PARTIALLY_APPROVED", approvedCents: 20000 });
    await receiptReady(f, partial.id, { totalCents: 30000, acknowledge: ["OVER_APPROVED"] });
    await claimSent(f, partial.id);
    await expectOk(call(waive, { method: "POST", jar: f.owner.jar, params: { id: partial.id }, body: { reason: "Gift" } }));
    // Eligible, claim, dispute to UNRESOLVED.
    const dentist = await newExpense(f, { category: "dental", description: "Cleaning", vendor: "Bright Smile Dental", amountCents: 12000 });
    await receiptReady(f, dentist.id, { merchant: "Bright Smile Dental", totalCents: 12000 });
    await claimSent(f, dentist.id);
    const jar = await guestSession(linkFromEmail(f.coParentEmail, "p"), f.coParentEmail);
    await expectOk(call(dispute, { method: "POST", params: { id: dentist.id }, jar, body: { reason: "No" } }));
    await expectOk(call(respond, { method: "POST", params: { id: dentist.id }, jar: f.owner.jar, body: { action: "counter", reason: "Yes" } }));
    await expectOk(call(respond, { method: "POST", params: { id: dentist.id }, jar, body: { action: "counter", reason: "Still no" } }));
    // Open claim (counts in the dashboard total, invariant 10).
    const open = await newExpense(f, { category: "school_supplies", description: "Notebooks", vendor: "Office Store", amountCents: 4000 });
    await receiptReady(f, open.id, { merchant: "Office Store", totalCents: 4000 });
    await claimSent(f, open.id);
    // Requested then cancelled expense; another request left to expire.
    const cancelled = await newExpense(f, { description: "Tournament" });
    await expectOk(askApproval(f, cancelled.id));
    await expectOk(call(cancelExpense, { method: "POST", jar: f.owner.jar, params: { id: cancelled.id } }));
    const expiring = await newExpense(f, { description: "Winter camp" });
    await expectOk(askApproval(f, expiring.id));
    setClock(new Date(Date.now() + 15 * DAY_MS));
    await expectOk(call(dailyJob, { method: "POST", headers: { authorization: `Bearer ${process.env.JOB_SECRET}` } }));
    resetClock();

    const result = await checkInvariants({ familyId: f.familyId });
    expect(result.checked.expenses).toBe(6);
    expect(result.violations).toEqual([]);
  });

  it("detects a state written around transition() (invariants 1 and 11)", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await db().collection("expenses").doc(e.id).update({ "settlement.state": "AWAITING_PAYMENT", "settlement.owedCents": 14000 });
    const { violations } = await checkInvariants({ familyId: f.familyId });
    expect(violations.some((v) => v.invariant === 1)).toBe(true);
    expect(violations.some((v) => v.invariant === 11)).toBe(true);
  });
});
