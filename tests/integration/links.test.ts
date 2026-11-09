import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { StubServer } from "../helpers/stub-server";
import { resetEnvCache } from "@/lib/env";
import { POST as sendInvite, DELETE as revokeInviteRoute } from "@/app/api/family/invite/route";
import { POST as resendInvite } from "@/app/api/family/invite/resend/route";
import { GET as getLink } from "@/app/api/links/[token]/route";
import { POST as sendOtp } from "@/app/api/links/[token]/otp/route";
import { POST as verifyOtp } from "@/app/api/links/[token]/otp/verify/route";
import { POST as accept } from "@/app/api/links/[token]/accept/route";
import { setClock } from "@/lib/clock";
import { readMemoryOutbox } from "@/lib/email/outbox";
import { db } from "@/lib/firebase/admin";
import { hashToken } from "@/lib/links/tokens";
import { call, CookieJar } from "../helpers/api";
import { resetEmulators } from "../helpers/emulator";
import { expectOk, lastCodeFor, ownerWithFamily, ownerWithInvite } from "../helpers/flows";

beforeAll(resetEmulators);
const stub = new StubServer();
beforeAll(() => stub.start());
afterEach(() => stub.reset());
afterAll(() => stub.stop());

const p =(token: string) => ({ params: { token } });

async function withSession(token: string, email: string) {
  const jar = new CookieJar();
  await expectOk(call(sendOtp, { method: "POST", ...p(token), jar }));
  await expectOk(call(verifyOtp, { method: "POST", ...p(token), jar, body: { code: lastCodeFor(email) } }));
  return jar;
}

/** Recursively collects every string value stored in Firestore (all collections) to search for plain tokens. */
async function allStoredStrings(): Promise<string[]> {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const col of await db().listCollections()) {
    const snaps = await col.get();
    for (const d of snaps.docs) {
      out.push(d.id);
      walk(d.data());
    }
  }
  return out;
}

describe("invite link", () => {
  it("SE-2: the plain token is never stored; the doc id is its SHA-256 hash", async () => {
    const { token } = await ownerWithInvite();
    const strings = await allStoredStrings();
    expect(strings.some((s) => s.includes(token))).toBe(false);
    const doc = await db().collection("linkTokens").doc(hashToken(token)).get();
    expect(doc.exists).toBe(true);
    expect(doc.data()).toMatchObject({ purpose: "invite", recipientRole: "coparent", usedAt: null, revokedAt: null });
  });

  it("LK-1: opening a valid link shows a read-only summary without personal PayPal data", async () => {
    const { token } = await ownerWithInvite();
    const r = await call(getLink, p(token));
    expect(r.status).toBe(200);
    expect(r.json.summary).toMatchObject({ purpose: "invite", ownerName: "Alex Rivera", coParentName: "Sara Rivera", childNames: ["Mia"] });
    expect(r.json.summary.session.active).toBe(false);
    expect(r.json.summary.paypal).toBeNull();
    expect(r.json.summary.sentTo).toMatch(/^s\*+@example\.com$/);
  });

  it("LK-2: accepting without an OTP session is 401", async () => {
    const { token } = await ownerWithInvite();
    const r = await call(accept, { method: "POST", ...p(token), body: {} });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("LINK_SESSION_REQUIRED");
  });

  it("LK-3: the correct code sets a 30-minute link session; accept then works and marks the token used", async () => {
    const { token, coParentEmail, familyId, owner } = await ownerWithInvite();
    const jar = new CookieJar();
    await expectOk(call(sendOtp, { method: "POST", ...p(token), jar }));
    const v = await call(verifyOtp, { method: "POST", ...p(token), jar, body: { code: lastCodeFor(coParentEmail) } });
    expect(v.status).toBe(200);
    const setCookie = v.res.headers.getSetCookie().find((c) => c.startsWith("thp_link="))!;
    expect(setCookie).toMatch(/Max-Age=1800/i);
    expect(setCookie).toMatch(/HttpOnly/i);

    const summary = await call(getLink, { ...p(token), jar });
    expect(summary.json.summary.session.active).toBe(true);
    expect(summary.json.summary.paypal).toMatchObject({ connected: false });

    const a = await call(accept, { method: "POST", ...p(token), jar, body: {} });
    expect(a.status).toBe(200);
    const fam = (await db().collection("families").doc(familyId).get()).data()!;
    expect(fam.coParent.inviteStatus).toBe("accepted");
    const link = (await db().collection("linkTokens").doc(hashToken(token)).get()).data()!;
    expect(link.usedAt).not.toBeNull();

    // Owner gets an in-app notification (no email).
    const notes = await db().collection("notifications").where("toUid", "==", owner.uid).get();
    expect(notes.docs.map((d) => d.data().type)).toContain("invite_accepted");

    // LK-7: the used link is now 410 everywhere.
    expect((await call(getLink, p(token))).status).toBe(410);
    expect((await call(accept, { method: "POST", ...p(token), jar, body: {} })).status).toBe(410);
    expect((await call(sendOtp, { method: "POST", ...p(token) })).status).toBe(410);
  });

  it("LK-4: 5 wrong codes lock the link for 15 minutes, even for the right code", async () => {
    const { token, coParentEmail } = await ownerWithInvite();
    const jar = new CookieJar();
    await expectOk(call(sendOtp, { method: "POST", ...p(token), jar }));
    const right = lastCodeFor(coParentEmail);
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 1; i <= 4; i++) {
      const r = await call(verifyOtp, { method: "POST", ...p(token), jar, body: { code: wrong } });
      expect(r.status).toBe(400);
      expect(r.json.error.details.remaining).toBe(5 - i);
    }
    const fifth = await call(verifyOtp, { method: "POST", ...p(token), jar, body: { code: wrong } });
    expect(fifth.status).toBe(423);
    expect(Number(fifth.res.headers.get("retry-after"))).toBeGreaterThan(14 * 60);
    expect((await call(verifyOtp, { method: "POST", ...p(token), jar, body: { code: right } })).status).toBe(423);
    expect((await call(sendOtp, { method: "POST", ...p(token), jar })).status).toBe(423);
    expect(jar.get("thp_link")).toBeUndefined();
  });

  it("LK-5 / SE-6: the 4th code request in an hour is 429 with retry-after", async () => {
    const { token } = await ownerWithInvite();
    for (let i = 0; i < 3; i++) await expectOk(call(sendOtp, { method: "POST", ...p(token) }));
    const r = await call(sendOtp, { method: "POST", ...p(token) });
    expect(r.status).toBe(429);
    expect(Number(r.res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("LK-6: a code used after 10 minutes is rejected and a new code is asked for", async () => {
    const { token, coParentEmail } = await ownerWithInvite();
    await expectOk(call(sendOtp, { method: "POST", ...p(token) }));
    const code = lastCodeFor(coParentEmail);
    setClock(new Date(Date.now() + 10 * 60_000 + 1000));
    const r = await call(verifyOtp, { method: "POST", ...p(token), body: { code } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("OTP_EXPIRED");
  });

  it("a code cannot be used twice", async () => {
    const { token, coParentEmail } = await ownerWithInvite();
    await expectOk(call(sendOtp, { method: "POST", ...p(token) }));
    const code = lastCodeFor(coParentEmail);
    await expectOk(call(verifyOtp, { method: "POST", ...p(token), body: { code } }));
    expect((await call(verifyOtp, { method: "POST", ...p(token), body: { code } })).status).toBe(400);
  });

  it("LK-7: an expired invite link is 410", async () => {
    const { token } = await ownerWithInvite();
    setClock(new Date(Date.now() + 7 * 86_400_000 + 1000));
    const r = await call(getLink, p(token));
    expect(r.status).toBe(410);
    expect(r.json.error.details.reason).toBe("expired");
  });

  it("LK-8: a forwarded link can be viewed, but the code goes only to the invited email", async () => {
    const { token, coParentEmail } = await ownerWithInvite();
    const before = readMemoryOutbox().length;
    expect((await call(getLink, p(token))).status).toBe(200);
    const r = await call(sendOtp, { method: "POST", ...p(token) });
    expect(r.status).toBe(200);
    const sent = readMemoryOutbox().slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(coParentEmail);
    // Without the code, nothing can be done.
    expect((await call(accept, { method: "POST", ...p(token), body: {} })).status).toBe(401);
  });

  it("LK-9: resend revokes the old token (410) and the new one works", async () => {
    const { token: oldToken, owner, coParentEmail } = await ownerWithInvite();
    const again = await call(sendInvite, { method: "POST", path: "/api/family/invite", jar: owner.jar });
    expect(again.status).toBe(409); // an active invite exists; resend is the explicit action
    const r = await expectOk(call(resendInvite, { method: "POST", path: "/api/family/invite/resend", jar: owner.jar }));
    const newToken = (r.json.link as string).split("/r/")[1];
    expect(newToken).not.toBe(oldToken);
    const old = await call(getLink, p(oldToken));
    expect(old.status).toBe(410);
    expect(old.json.error.details.reason).toBe("revoked");
    expect((await call(getLink, p(newToken))).status).toBe(200);
    const jar = await withSession(newToken, coParentEmail);
    expect((await call(accept, { method: "POST", ...p(newToken), jar, body: {} })).status).toBe(200);
  });

  it("a link session for one token does not work for another token", async () => {
    const a = await ownerWithInvite();
    const b = await ownerWithInvite();
    const jarA = await withSession(a.token, a.coParentEmail);
    const r = await call(accept, { method: "POST", ...p(b.token), jar: jarA, body: {} });
    expect(r.status).toBe(401);
  });

  it("revoking the invite makes the link 410", async () => {
    const { token, owner } = await ownerWithInvite();
    await expectOk(call(revokeInviteRoute, { method: "DELETE", path: "/api/family/invite", jar: owner.jar }));
    expect((await call(getLink, p(token))).status).toBe(410);
  });

  it("unknown and malformed tokens are 404", async () => {
    expect((await call(getLink, p("A".repeat(43)))).status).toBe(404);
    expect((await call(getLink, p("not-a-token-but-long-enough"))).status).toBe(404);
  });

  it("ON-7: when the invite email fails the step still completes and the copy link is returned", async () => {
    const { owner } = await ownerWithFamily();
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "re_test_invalid";
    process.env.RESEND_BASE_URL = stub.url;
    resetEnvCache();
    stub.on("POST", "/emails", () => ({ status: 422, json: { name: "validation_error", message: "bad", statusCode: 422 } }));
    try {
      const r = await call(sendInvite, { method: "POST", path: "/api/family/invite", jar: owner.jar });
      expect(r.status).toBe(200);
      expect(r.json.email.status).toBe("failed");
      expect(r.json.link).toMatch(/\/r\/[A-Za-z0-9_-]{43}$/);
      const fam = (await db().collection("families").where("ownerUid", "==", owner.uid).get()).docs[0].data();
      expect(fam.coParent.inviteStatus).toBe("sent");
      const notes = await db().collection("notifications").where("type", "==", "invite").where("familyId", "==", (await db().collection("users").doc(owner.uid).get()).data()!.familyId).get();
      expect(notes.docs[0].data().email.status).toBe("failed");
    } finally {
      process.env.EMAIL_TRANSPORT = "outbox";
      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_BASE_URL;
      resetEnvCache();
    }
  });
});
