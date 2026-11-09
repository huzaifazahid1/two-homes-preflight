import { beforeAll, describe, expect, it } from "vitest";
import { GET as getMe, PATCH as patchMe } from "@/app/api/me/route";
import { POST as upsertFamily } from "@/app/api/family/route";
import { POST as addChild } from "@/app/api/family/children/route";
import { DELETE as removeChild, PATCH as editChild } from "@/app/api/family/children/[id]/route";
import { POST as sendInvite } from "@/app/api/family/invite/route";
import { POST as connectEmail } from "@/app/api/paypal/connect/email/route";
import { db } from "@/lib/firebase/admin";
import { readMemoryOutbox } from "@/lib/email/outbox";
import { call, signedInUser, type CookieJar } from "../helpers/api";
import { resetEmulators } from "../helpers/emulator";
import { expectOk, ownerWithFamily } from "../helpers/flows";

beforeAll(resetEmulators);

const patch = (jar: CookieJar, body: unknown) => call(patchMe, { method: "PATCH", path: "/api/me", jar, body });

describe("onboarding", () => {
  it("ON-1 (Phase 1 part): completes profile -> agreement (placeholder) -> family -> invite -> paypal -> plan -> done", async () => {
    const { owner, coParentEmail } = await ownerWithFamily();
    expect((await call(getMe, { path: "/api/me", jar: owner.jar })).json.me.onboardingStep).toBe("family");

    await expectOk(patch(owner.jar, { completeStep: "family" }));
    const inv = await expectOk(call(sendInvite, { method: "POST", path: "/api/family/invite", jar: owner.jar }));
    expect(inv.json.email.status).toBe("sent");
    expect(readMemoryOutbox().some((m) => m.to === coParentEmail && m.replyTo === owner.email)).toBe(true);

    await expectOk(patch(owner.jar, { completeStep: "invite" }));
    const pp = await call(connectEmail, { method: "POST", path: "/api/paypal/connect/email", jar: owner.jar, body: { for: "owner", email: "alex.pp@example.com", confirmEmail: "alex.pp@example.com" } });
    expect(pp.status).toBe(200);
    await expectOk(patch(owner.jar, { completeStep: "paypal" }));
    const done = await expectOk(patch(owner.jar, { completeStep: "plan", plan: "free" }));
    expect(done.json.me.onboardingStep).toBe("done");
    expect(done.json.me.family.payout.owner).toMatchObject({ method: "email", email: "alex.pp@example.com" });
  });

  it("ON-2: completing a later step than the saved one is refused with the current step", async () => {
    const u = await signedInUser();
    const r = await patch(u.jar, { completeStep: "invite" });
    expect(r.status).toBe(409);
    expect(r.json.error.details.onboardingStep).toBe("profile");
  });

  it("ON-3: leaving at the family step and returning resumes there with saved data", async () => {
    const { owner } = await ownerWithFamily();
    const me = (await call(getMe, { path: "/api/me", jar: owner.jar })).json.me;
    expect(me.onboardingStep).toBe("family");
    expect(me.family.children.map((c: { firstName: string }) => c.firstName)).toEqual(["Mia"]);
    expect(me.family.coParent.name).toBe("Sara Rivera");
  });

  it("family step needs a child and the co-parent", async () => {
    const u = await signedInUser();
    await expectOk(patch(u.jar, { displayName: "Alex", completeStep: "profile" }));
    await expectOk(patch(u.jar, { completeStep: "agreement" }));
    const r = await patch(u.jar, { completeStep: "family" });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/child/);
  });

  it("ON-4: co-parent email equal to the owner's is a 400 validation error", async () => {
    const u = await signedInUser();
    await expectOk(patch(u.jar, { displayName: "Alex", completeStep: "profile" }));
    const r = await call(upsertFamily, { method: "POST", path: "/api/family", jar: u.jar, body: { coParent: { name: "Me", email: u.email.toUpperCase() } } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("INVALID");
  });

  it("invite step cannot complete before an invite is sent", async () => {
    const { owner } = await ownerWithFamily();
    await expectOk(patch(owner.jar, { completeStep: "family" }));
    const r = await patch(owner.jar, { completeStep: "invite" });
    expect(r.status).toBe(409);
  });

  it("children can be edited and removed by the owner", async () => {
    const { owner, familyId } = await ownerWithFamily();
    const c = await expectOk(call(addChild, { method: "POST", path: "/api/family/children", jar: owner.jar, body: { firstName: "Leo" } }));
    const id = c.json.child.id;
    await expectOk(call(editChild, { method: "PATCH", path: `/api/family/children/${id}`, jar: owner.jar, params: { id }, body: { birthYear: 2019 } }));
    await expectOk(call(removeChild, { method: "DELETE", path: `/api/family/children/${id}`, jar: owner.jar, params: { id } }));
    const fam = (await db().collection("families").doc(familyId).get()).data()!;
    expect(fam.children.map((x: { firstName: string }) => x.firstName)).toEqual(["Mia"]);
  });

  it("AZ-2: a user of family A cannot edit family B's children (403 or 404)", async () => {
    const a = await ownerWithFamily();
    const b = await ownerWithFamily();
    const bFam = (await db().collection("families").doc(b.familyId).get()).data()!;
    const bChild = bFam.children[0].id;
    const r = await call(editChild, { method: "PATCH", path: `/api/family/children/${bChild}`, jar: a.owner.jar, params: { id: bChild }, body: { firstName: "Hacked" } });
    expect([403, 404]).toContain(r.status);
    const after = (await db().collection("families").doc(b.familyId).get()).data()!;
    expect(after.children[0].firstName).toBe("Mia");
  });

  it("PC-4: fallback emails that do not match are a validation error", async () => {
    const { owner } = await ownerWithFamily();
    const r = await call(connectEmail, { method: "POST", path: "/api/paypal/connect/email", jar: owner.jar, body: { for: "owner", email: "a@example.com", confirmEmail: "b@example.com" } });
    expect(r.status).toBe(400);
  });

  it("an owner cannot connect PayPal for the co-parent role", async () => {
    const { owner } = await ownerWithFamily();
    const r = await call(connectEmail, { method: "POST", path: "/api/paypal/connect/email", jar: owner.jar, body: { for: "coparent", email: "a@example.com", confirmEmail: "a@example.com" } });
    expect(r.status).toBe(403);
  });
});
