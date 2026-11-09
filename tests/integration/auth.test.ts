import { beforeAll, describe, expect, it } from "vitest";
import { DELETE as deleteSession, POST as createSession } from "@/app/api/auth/session/route";
import { GET as getMe, PATCH as patchMe } from "@/app/api/me/route";
import { POST as sendInvite } from "@/app/api/family/invite/route";
import { db } from "@/lib/firebase/admin";
import { call, CookieJar, signedInUser } from "../helpers/api";
import { resetEmulators } from "../helpers/emulator";

beforeAll(resetEmulators);

describe("session", () => {
  it("AU-1/AU-2: a fresh ID token creates the session cookie and the profile at step 'profile'", async () => {
    const u = await signedInUser({ verified: false });
    expect(u.jar.get("thp_session")).toBeTruthy();
    const snap = await db().collection("users").doc(u.uid).get();
    expect(snap.data()).toMatchObject({ onboardingStep: "profile", familyId: null, role: "owner", timeZone: "Asia/Karachi", emailVerified: false });
    const me = await call(getMe, { path: "/api/me", jar: u.jar });
    expect(me.status).toBe(200);
    expect(me.json.me.onboardingStep).toBe("profile");
  });

  it("rejects an invalid ID token with 401", async () => {
    const r = await call(createSession, { method: "POST", path: "/api/auth/session", body: { idToken: "not-a-real-token-at-all" } });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("UNAUTHENTICATED");
    expect(r.json.error.requestId).toBeTruthy();
  });

  it("AU-4/AU-5: missing, tampered or garbage session cookie gives 401 UNAUTHENTICATED", async () => {
    const u = await signedInUser();
    const tampered = new CookieJar();
    tampered.set("thp_session", `${u.jar.get("thp_session")!.slice(0, -4)}AAAA`);
    for (const jar of [new CookieJar(), tampered]) {
      const r = await call(getMe, { path: "/api/me", jar });
      expect(r.status).toBe(401);
      expect(r.json.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("AU-6: sign out clears the cookie and revokes refresh tokens (old cookie stops working)", async () => {
    const u = await signedInUser();
    const stolen = u.jar.clone();
    // Revocation is checked with second precision; make sure the session is older than the revoke time.
    await new Promise((r) => setTimeout(r, 1100));
    const out = await call(deleteSession, { method: "DELETE", path: "/api/auth/session", jar: u.jar });
    expect(out.status).toBe(200);
    expect(u.jar.get("thp_session")).toBeUndefined();
    const r = await call(getMe, { path: "/api/me", jar: stolen });
    expect(r.status).toBe(401);
  });

  it("sign out with no or dead session still succeeds and clears the cookie", async () => {
    const jar = new CookieJar();
    jar.set("thp_session", "dead");
    const out = await call(deleteSession, { method: "DELETE", path: "/api/auth/session", jar });
    expect(out.status).toBe(200);
    expect(jar.get("thp_session")).toBeUndefined();
  });

  it("AU-7: an unverified email cannot send an invite (403 EMAIL_NOT_VERIFIED)", async () => {
    const u = await signedInUser({ verified: false });
    const r = await call(sendInvite, { method: "POST", path: "/api/family/invite", jar: u.jar });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("unverified email cannot finish the profile step", async () => {
    const u = await signedInUser({ verified: false });
    const r = await call(patchMe, { method: "PATCH", path: "/api/me", jar: u.jar, body: { displayName: "Alex", completeStep: "profile" } });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/verify your email/i);
  });

  it("rejects unknown fields and invalid bodies with 400", async () => {
    const u = await signedInUser();
    const r = await call(patchMe, { method: "PATCH", path: "/api/me", jar: u.jar, body: { role: "owner" } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("INVALID");
    const bad = await call(patchMe, { method: "PATCH", path: "/api/me", jar: u.jar, body: { displayName: "" } });
    expect(bad.status).toBe(400);
  });
});
