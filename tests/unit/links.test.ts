import { afterEach, describe, expect, it } from "vitest";
import { resetClock, setClock } from "@/lib/clock";
import { newLinkToken, newOtpCode, sha256Hex } from "@/lib/ids";
import { hashOtp } from "@/lib/links/otp";
import { createLinkSession, LINK_SESSION_TTL_MS, readLinkSession, signPayload, verifyPayload } from "@/lib/links/session";
import { hashToken, isWellFormedToken, maskEmail } from "@/lib/links/tokens";
import { parseUserInfo } from "@/lib/paypal/connect";
import { redact, redactEmail } from "@/lib/log";
import { paypalEmailSchema, RETURN_TO_RE } from "@/schemas";

afterEach(() => resetClock());

describe("link tokens", () => {
  it("are 32 random bytes in base64url (43 chars) and unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = newLinkToken();
      expect(isWellFormedToken(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });
  it("are stored only as SHA-256 hashes", () => {
    const t = newLinkToken();
    expect(hashToken(t)).toBe(sha256Hex(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
  it("rejects malformed tokens", () => {
    expect(isWellFormedToken("short")).toBe(false);
    expect(isWellFormedToken(`${newLinkToken()}x`)).toBe(false);
    expect(isWellFormedToken("../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
  it("masks recipient emails", () => {
    expect(maskEmail("sara@example.com")).toBe("s***@example.com");
    expect(maskEmail("a@b.co")).toBe("a**@b.co");
  });
});

describe("OTP codes", () => {
  it("are 6 digits with leading zeros", () => {
    for (let i = 0; i < 500; i++) expect(newOtpCode()).toMatch(/^\d{6}$/);
  });
  it("are hashed with the pepper and bound to the token", () => {
    const a = hashOtp("tokA", "123456", "pepper-1");
    expect(a).not.toContain("123456");
    expect(a).not.toBe(hashOtp("tokB", "123456", "pepper-1"));
    expect(a).not.toBe(hashOtp("tokA", "123456", "pepper-2"));
    expect(a).toBe(hashOtp("tokA", "123456", "pepper-1"));
  });
});

describe("link session cookie", () => {
  it("round-trips and expires after 30 minutes", () => {
    const t0 = new Date("2026-11-10T12:00:00Z");
    setClock(t0);
    const s = createLinkSession("hash123");
    expect(readLinkSession(s.value)?.tokenHash).toBe("hash123");
    setClock(new Date(t0.getTime() + LINK_SESSION_TTL_MS - 1));
    expect(readLinkSession(s.value)).not.toBeNull();
    setClock(new Date(t0.getTime() + LINK_SESSION_TTL_MS + 1));
    expect(readLinkSession(s.value)).toBeNull();
  });
  it("rejects tampering", () => {
    const signed = signPayload("secret", { th: "a", exp: Date.now() + 1000 });
    const [body, sig] = signed.split(".");
    const forged = Buffer.from(JSON.stringify({ th: "b", exp: Date.now() + 1000 })).toString("base64url");
    expect(verifyPayload("secret", `${forged}.${sig}`)).toBeNull();
    expect(verifyPayload("other", signed)).toBeNull();
    expect(verifyPayload("secret", `${body}.`)).toBeNull();
    expect(verifyPayload("secret", "garbage")).toBeNull();
    expect(verifyPayload("secret", undefined)).toBeNull();
  });
});

describe("PayPal userinfo parsing", () => {
  it("reads payer id, primary email and verified flag (string or boolean)", () => {
    expect(
      parseUserInfo({ payer_id: "PAYER1", emails: [{ value: "Other@x.com" }, { value: "Sara@Example.com", primary: true }], verified_account: true }),
    ).toEqual({ payerId: "PAYER1", email: "sara@example.com", verifiedAccount: true });
    expect(parseUserInfo({ email: "a@b.com", verified_account: false })).toEqual({ payerId: undefined, email: "a@b.com", verifiedAccount: false });
  });
  it("fails without an email", () => {
    expect(() => parseUserInfo({ payer_id: "X" })).toThrow();
  });
});

describe("schemas", () => {
  it("PC-4: fallback emails must match", () => {
    expect(paypalEmailSchema.safeParse({ for: "owner", email: "a@b.com", confirmEmail: "a@b.co" }).success).toBe(false);
    expect(paypalEmailSchema.safeParse({ for: "owner", email: "A@b.com", confirmEmail: "a@b.com " }).success).toBe(true);
  });
  it("only allows known return paths (no open redirect)", () => {
    expect(RETURN_TO_RE.test("/onboarding/paypal")).toBe(true);
    expect(RETURN_TO_RE.test(`/r/${newLinkToken()}`)).toBe(true);
    for (const bad of ["https://evil.com", "//evil.com", "/app/settings/../x", "/r/abc"]) expect(RETURN_TO_RE.test(bad)).toBe(false);
  });
});

describe("log redaction", () => {
  it("keeps the email domain only and drops secrets", () => {
    expect(redactEmail("mail sara@example.com now")).toBe("mail ***@example.com now");
    expect(redact({ token: "abc", code: "123456", requestId: "r1", nested: { privateKey: "k", email: "x@y.com" } })).toEqual({
      token: "[redacted]", code: "[redacted]", requestId: "r1", nested: { privateKey: "[redacted]", email: "***@y.com" },
    });
  });
});
