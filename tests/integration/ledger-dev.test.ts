import { beforeAll, describe, expect, it } from "vitest";
import { POST as devReset } from "@/app/api/dev/reset/route";
import { POST as devSeed } from "@/app/api/dev/seed/route";
import { GET as ledgerRoute } from "@/app/api/ledger/route";
import { db } from "@/lib/firebase/admin";
import { checkInvariants } from "@/lib/invariants";
import { call } from "../helpers/api";
import { newExpense } from "../helpers/claims";
import { resetEmulators } from "../helpers/emulator";
import { expectOk, ownerWithFamily, withDemoMode } from "../helpers/flows";

beforeAll(resetEmulators);

const SECRET = { "x-dev-secret": "test-dev-secret-0123456789abcdef0123456789" };

describe("dev tools", () => {
  it("SE-7: /api/dev/* is 404 without DEMO_MODE, even with the secret", async () => {
    for (const h of [devSeed, devReset]) {
      const r = await call(h, { method: "POST", headers: SECRET, body: { coParentEmail: "sara@example.com" } });
      expect(r.status).toBe(404);
    }
  });

  it("DEMO_MODE without the secret is 401", async () => {
    await withDemoMode(async () => {
      const r = await call(devSeed, { method: "POST", body: { coParentEmail: "sara@example.com" } });
      expect(r.status).toBe(401);
    });
  });

  it("seed builds an onboarded family through the real routes; reset removes it", async () => {
    await withDemoMode(async () => {
      const r = await expectOk(call(devSeed, { method: "POST", headers: SECRET, body: { coParentEmail: "sara.seed@example.com" } }));
      const { familyId, expenses, ownerEmail } = r.json.seeded;
      expect(ownerEmail).toMatch(/@demo\.twohomes\.test$/);
      expect(expenses).toHaveLength(2);
      const fam = (await db().collection("families").doc(familyId).get()).data()!;
      expect(fam).toMatchObject({ demo: true, coParent: { email: "sara.seed@example.com", inviteStatus: "sent" } });
      expect(fam.activeRuleVersionId).toBeTruthy();
      expect((await checkInvariants({ familyId })).violations).toEqual([]);

      const reset = await expectOk(call(devReset, { method: "POST", headers: SECRET }));
      expect(reset.json.reset.families).toBeGreaterThanOrEqual(1);
      expect((await db().collection("families").doc(familyId).get()).exists).toBe(false);
      expect((await db().collection("expenses").where("familyId", "==", familyId).get()).size).toBe(0);
    });
  });
});

describe("ledger", () => {
  it("rows carry derived fields and server totals; filters apply", async () => {
    const f = await ownerWithFamily();
    await newExpense(f, { category: "dental", description: "Bright Smile cleaning", amountCents: 12000 });
    await newExpense(f);
    const r = await expectOk(call(ledgerRoute, { path: "/api/ledger", jar: f.owner.jar }));
    const l = r.json.ledger;
    expect(l.rows).toHaveLength(2);
    const camp = l.rows.find((x: { description: string }) => x.description.includes("soccer"));
    expect(camp).toMatchObject({ verdict: "NEEDS_APPROVAL", approval: "REQUIRED", settlement: "NONE", isOverdue: false, owedToMe: true, childName: "Mia" });
    expect(camp.clause).toMatchObject({ page: expect.any(Number) });
    expect(l.totals.listedTotalCents).toBe(12000 + 35000);
    expect(l.totals.claims.owedToYou.cents).toBe(0);
    const closed = await expectOk(call(ledgerRoute, { path: "/api/ledger?filter=closed", jar: f.owner.jar }));
    expect(closed.json.ledger.rows).toHaveLength(0);
  });

  it("UI-5: an empty family has an empty ledger", async () => {
    const f = await ownerWithFamily();
    const r = await expectOk(call(ledgerRoute, { path: "/api/ledger", jar: f.owner.jar }));
    expect(r.json.ledger.rows).toEqual([]);
  });

  it("an invalid filter is 400", async () => {
    const f = await ownerWithFamily();
    expect((await call(ledgerRoute, { path: "/api/ledger?filter=everything", jar: f.owner.jar })).status).toBe(400);
  });
});
