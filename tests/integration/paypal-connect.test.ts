import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as start } from "@/app/api/paypal/connect/start/route";
import { POST as callback } from "@/app/api/paypal/connect/callback/route";
import { DELETE as disconnectRoute } from "@/app/api/paypal/connect/route";
import { POST as sendOtp } from "@/app/api/links/[token]/otp/route";
import { POST as verifyOtp } from "@/app/api/links/[token]/otp/verify/route";
import { db } from "@/lib/firebase/admin";
import { call, CookieJar } from "../helpers/api";
import { resetEmulators } from "../helpers/emulator";
import { expectOk, lastCodeFor, ownerWithFamily, ownerWithInvite } from "../helpers/flows";
import { resetEnvCache } from "@/lib/env";
import { StubServer } from "../helpers/stub-server";

beforeAll(resetEmulators);
const stub = new StubServer();
beforeAll(async () => {
  await stub.start();
  process.env.PAYPAL_API_BASE = stub.url;
  resetEnvCache();
});
afterEach(() => stub.reset());
afterAll(async () => {
  process.env.PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";
  resetEnvCache();
  await stub.stop();
});

function mockPayPal(opts: { codeOk?: boolean; userinfo?: Record<string, unknown> } = {}) {
  const used = new Set<string>();
  stub.on("POST", "/v1/oauth2/token", (req) => {
    const code = new URLSearchParams(req.body).get("code") ?? "";
    if (opts.codeOk === false || used.has(code)) {
      return { status: 400, json: { error: "invalid_grant", error_description: "Invalid authorization code" }, headers: { "paypal-debug-id": "dbg1" } };
    }
    used.add(code);
    return { json: { access_token: "A21.user-token", token_type: "Bearer", expires_in: 28800 } };
  });
  stub.on("GET", "/v1/identity/oauth2/userinfo", (req) => {
    if (req.headers.authorization !== "Bearer A21.user-token") return { status: 401, json: {} };
    return {
      json: opts.userinfo ?? {
        user_id: "https://www.paypal.com/webapps/auth/identity/user/abc",
        payer_id: "SANDBOXPAYER1",
        verified_account: "true",
        emails: [{ value: "Alex.Buyer@Example.com", primary: true, confirmed: true }],
      },
    };
  });
}

async function startFlow(jar: CookieJar, query: string) {
  const r = await expectOk(call(start, { path: `/api/paypal/connect/start?${query}`, jar }));
  const url = new URL(r.json.url);
  return { url, state: url.searchParams.get("state")! };
}

describe("Log in with PayPal", () => {
  it("builds the sandbox authorize URL with the configured return URL and scopes", async () => {
    const { owner } = await ownerWithFamily();
    const { url, state } = await startFlow(owner.jar, "for=owner&returnTo=/onboarding/paypal");
    expect(url.origin).toBe("https://www.sandbox.paypal.com");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3100/connect/paypal/callback");
    expect(url.searchParams.get("scope")).toContain("https://uri.paypal.com/services/paypalattributes");
    expect(state.length).toBeGreaterThan(20);
    expect(owner.jar.get("thp_pp_state")).toBeTruthy();
  });

  it("PC-1: saves payer id, email and verified flag; the PayPal token is not stored", async () => {
    mockPayPal();
    const { owner, familyId } = await ownerWithFamily();
    const { state } = await startFlow(owner.jar, "for=owner&returnTo=/onboarding/paypal");
    const r = await call(callback, { method: "POST", path: "/api/paypal/connect/callback", jar: owner.jar, body: { code: "code-1", state } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: "connected", returnTo: "/onboarding/paypal", email: "alex.buyer@example.com", verifiedAccount: true });
    const fam = (await db().collection("families").doc(familyId).get()).data()!;
    expect(fam.payout.owner).toMatchObject({ method: "login_with_paypal", payerId: "SANDBOXPAYER1", email: "alex.buyer@example.com", verifiedAccount: true });
    expect(JSON.stringify(fam)).not.toContain("A21.user-token");
    expect(owner.jar.get("thp_pp_state")).toBeUndefined();
  });

  it("unverified PayPal accounts are saved with verifiedAccount=false", async () => {
    mockPayPal({ userinfo: { payer_id: "P2", verified_account: false, email: "u@example.com" } });
    const { owner, familyId } = await ownerWithFamily();
    const { state } = await startFlow(owner.jar, "for=owner&returnTo=/app/settings");
    const r = await call(callback, { method: "POST", path: "/api/paypal/connect/callback", jar: owner.jar, body: { code: "c", state } });
    expect(r.json.verifiedAccount).toBe(false);
    const fam = (await db().collection("families").doc(familyId).get()).data()!;
    expect(fam.payout.owner.verifiedAccount).toBe(false);
  });

  it("PC-2: cancelling on PayPal saves nothing", async () => {
    const { owner, familyId } = await ownerWithFamily();
    const { state } = await startFlow(owner.jar, "for=owner&returnTo=/onboarding/paypal");
    const r = await call(callback, { method: "POST", path: "/api/paypal/connect/callback", jar: owner.jar, body: { state, error: "access_denied" } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "cancelled", returnTo: "/onboarding/paypal" });
    const fam = (await db().collection("families").doc(familyId).get()).data()!;
    expect(fam.payout.owner).toBeUndefined();
  });

  it("PC-3: state mismatch is 400 and saves nothing", async () => {
    mockPayPal();
    const { owner, familyId } = await ownerWithFamily();
    await startFlow(owner.jar, "for=owner&returnTo=/onboarding/paypal");
    const r = await call(callback, { method: "POST", path: "/api/paypal/connect/callback", jar: owner.jar, body: { code: "c", state: "forged-state-value-xxxxxxxx" } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("PAYPAL_STATE_MISMATCH");
    expect((await db().collection("families").doc(familyId).get()).data()!.payout.owner).toBeUndefined();
  });

  it("PC-3: a reused callback (state cookie already consumed) is 400", async () => {
    mockPayPal();
    const { owner } = await ownerWithFamily();
    const { state } = await startFlow(owner.jar, "for=owner&returnTo=/onboarding/paypal");
    const replayJar = owner.jar.clone();
    await expectOk(call(callback, { method: "POST", path: "/api/paypal/connect/callback", jar: owner.jar, body: { code: "code-x", state } }));
    // Same cookie and state replayed: PayPal rejects the used code.
    const r = await call(callback, { method: "POST", path: "/api/paypal/connect/callback", jar: replayJar, body: { code: "code-x", state } });
    expect(r.status).toBe(400);
    // And without the cookie the state cannot match at all.
    const r2 = await call(callback, { method: "POST", path: "/api/paypal/connect/callback", jar: owner.jar, body: { code: "code-y", state } });
    expect(r2.status).toBe(400);
  });

  it("a state cookie started by one user cannot be completed by another", async () => {
    mockPayPal();
    const a = await ownerWithFamily();
    const b = await ownerWithFamily();
    const { state } = await startFlow(a.owner.jar, "for=owner&returnTo=/onboarding/paypal");
    const jar = b.owner.jar.clone();
    jar.set("thp_pp_state", a.owner.jar.get("thp_pp_state")!);
    const r = await call(callback, { method: "POST", path: "/api/paypal/connect/callback", jar, body: { code: "c", state } });
    expect(r.status).toBe(400);
  });

  it("rejects return paths outside the allow-list", async () => {
    const { owner } = await ownerWithFamily();
    const r = await call(start, { path: "/api/paypal/connect/start?for=owner&returnTo=https://evil.example", jar: owner.jar });
    expect(r.status).toBe(400);
  });

  it("guest co-parent connects through the link session, not an account", async () => {
    mockPayPal({ userinfo: { payer_id: "COPAYER", verified_account: true, email: "sara.pp@example.com" } });
    const { token, coParentEmail, familyId } = await ownerWithInvite();
    const jar = new CookieJar();
    // Without the code: refused.
    expect((await call(start, { path: `/api/paypal/connect/start?for=coparent&returnTo=/r/${token}&token=${token}`, jar })).status).toBe(401);
    await expectOk(call(sendOtp, { method: "POST", params: { token }, jar }));
    await expectOk(call(verifyOtp, { method: "POST", params: { token }, jar, body: { code: lastCodeFor(coParentEmail) } }));
    // Cannot connect the owner's role.
    expect((await call(start, { path: `/api/paypal/connect/start?for=owner&returnTo=/r/${token}&token=${token}`, jar })).status).toBe(403);
    const { state } = await startFlow(jar, `for=coparent&returnTo=/r/${token}&token=${token}`);
    const r = await call(callback, { method: "POST", path: "/api/paypal/connect/callback", jar, body: { code: "co-code", state } });
    expect(r.status).toBe(200);
    expect(r.json.returnTo).toBe(`/r/${token}`);
    const fam = (await db().collection("families").doc(familyId).get()).data()!;
    expect(fam.payout.coparent).toMatchObject({ payerId: "COPAYER", email: "sara.pp@example.com" });
  });

  it("disconnect removes the owner connection; blocked while a payout is processing", async () => {
    mockPayPal();
    const { owner, familyId } = await ownerWithFamily();
    const { state } = await startFlow(owner.jar, "for=owner&returnTo=/app/settings");
    await expectOk(call(callback, { method: "POST", path: "/api/paypal/connect/callback", jar: owner.jar, body: { code: "d1", state } }));

    await db().collection("expenses").doc(`exp_${familyId}`).set({ familyId, memberUids: [owner.uid], settlement: { state: "PAYOUT_PROCESSING" } });
    const blocked = await call(disconnectRoute, { method: "DELETE", path: "/api/paypal/connect", jar: owner.jar });
    expect(blocked.status).toBe(409);

    await db().collection("expenses").doc(`exp_${familyId}`).delete();
    await expectOk(call(disconnectRoute, { method: "DELETE", path: "/api/paypal/connect", jar: owner.jar }));
    expect((await db().collection("families").doc(familyId).get()).data()!.payout.owner).toBeUndefined();
  });
});
