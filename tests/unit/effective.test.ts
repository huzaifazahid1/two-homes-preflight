import { describe, expect, it } from "vitest";
import { effectiveApprovalState, isDueSoon, isEntitled, isLinkUsable, isOverdue, linkStatus, otpStatus } from "@/lib/state/effective";

const NOW = new Date("2026-11-10T12:00:00Z");
const ms = (offset: number) => new Date(NOW.getTime() + offset);
const DAY = 86_400_000;

describe("approval expiry", () => {
  it("REQUESTED past expiresAt is EXPIRED", () => {
    expect(effectiveApprovalState({ state: "REQUESTED", expiresAt: ms(-1) }, NOW)).toBe("EXPIRED");
    expect(effectiveApprovalState({ state: "REQUESTED", expiresAt: ms(1) }, NOW)).toBe("REQUESTED");
    expect(effectiveApprovalState({ state: "REQUESTED", expiresAt: NOW }, NOW)).toBe("REQUESTED");
  });
  it("other states are untouched", () => {
    expect(effectiveApprovalState({ state: "APPROVED", expiresAt: ms(-DAY) }, NOW)).toBe("APPROVED");
  });
});

describe("link usable", () => {
  it("usable only when not expired, used or revoked", () => {
    expect(isLinkUsable({ expiresAt: ms(1) }, NOW)).toBe(true);
    expect(linkStatus({ expiresAt: ms(-1) }, NOW)).toBe("expired");
    expect(linkStatus({ expiresAt: ms(DAY), usedAt: ms(-1) }, NOW)).toBe("used");
    expect(linkStatus({ expiresAt: ms(DAY), revokedAt: ms(-1), usedAt: ms(-1) }, NOW)).toBe("revoked");
    expect(isLinkUsable({ expiresAt: null }, NOW)).toBe(false);
  });
});

describe("overdue and due soon", () => {
  it("overdue is derived: open claim and now > dueAt", () => {
    expect(isOverdue({ state: "AWAITING_PAYMENT", dueAt: ms(-1) }, NOW)).toBe(true);
    expect(isOverdue({ state: "PAYMENT_FAILED", dueAt: ms(-1) }, NOW)).toBe(true);
    expect(isOverdue({ state: "AWAITING_PAYMENT", dueAt: NOW }, NOW)).toBe(false);
    expect(isOverdue({ state: "SETTLED", dueAt: ms(-DAY) }, NOW)).toBe(false);
    expect(isOverdue({ state: "AWAITING_PAYMENT" }, NOW)).toBe(false);
  });
  it("due soon is dueAt - 3 days <= now <= dueAt", () => {
    expect(isDueSoon({ state: "AWAITING_PAYMENT", dueAt: ms(3 * DAY) }, NOW)).toBe(true);
    expect(isDueSoon({ state: "AWAITING_PAYMENT", dueAt: ms(3 * DAY + 1) }, NOW)).toBe(false);
    expect(isDueSoon({ state: "AWAITING_PAYMENT", dueAt: NOW }, NOW)).toBe(true);
    expect(isDueSoon({ state: "AWAITING_PAYMENT", dueAt: ms(-1) }, NOW)).toBe(false);
  });
});

describe("OTP validity", () => {
  const base = { codeHash: "h", expiresAt: ms(60_000), attempts: 0 };
  it("valid when not expired, attempts < 5, not locked", () => {
    expect(otpStatus(base, NOW)).toBe("valid");
    expect(otpStatus({ ...base, attempts: 4 }, NOW)).toBe("valid");
    expect(otpStatus({ ...base, attempts: 5 }, NOW)).toBe("exhausted");
    expect(otpStatus({ ...base, expiresAt: ms(-1) }, NOW)).toBe("expired");
    expect(otpStatus({ ...base, lockedUntil: ms(1) }, NOW)).toBe("locked");
    expect(otpStatus({ ...base, lockedUntil: ms(-1) }, NOW)).toBe("valid");
    expect(otpStatus({ ...base, codeHash: null }, NOW)).toBe("none");
    expect(otpStatus(null, NOW)).toBe("none");
  });
});

describe("entitlement", () => {
  it("ACTIVE, or CANCELLED with paidThrough in the future", () => {
    expect(isEntitled({ status: "ACTIVE" }, NOW)).toBe(true);
    expect(isEntitled({ status: "CANCELLED", paidThrough: ms(DAY) }, NOW)).toBe(true);
    expect(isEntitled({ status: "CANCELLED", paidThrough: ms(-1) }, NOW)).toBe(false);
    for (const s of ["SUSPENDED", "EXPIRED", "APPROVAL_PENDING"] as const) expect(isEntitled({ status: s, paidThrough: ms(DAY) }, NOW)).toBe(false);
    expect(isEntitled(null, NOW)).toBe(false);
  });
});
