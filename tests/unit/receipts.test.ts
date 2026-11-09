import { describe, expect, it } from "vitest";
import { detectReceiptType } from "@/lib/receipts/file-type";
import { matchReceipt, merchantKey, merchantsMatch, type MatchInput } from "@/lib/receipts/match";

const bytes = (...head: (number | string)[]) => {
  const b = new Uint8Array(64);
  let i = 0;
  for (const h of head) {
    if (typeof h === "number") b[i++] = h;
    else for (const c of h) b[i++] = c.charCodeAt(0);
  }
  return b;
};

describe("detectReceiptType (RC-2, RC-3)", () => {
  it("accepts JPEG, PNG, WEBP, HEIC and PDF by magic bytes", () => {
    expect(detectReceiptType(bytes(0xff, 0xd8, 0xff, 0xe1))?.mime).toBe("image/jpeg");
    expect(detectReceiptType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe("image/png");
    expect(detectReceiptType(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))?.mime).toBe("image/webp");
    expect(detectReceiptType(bytes(0, 0, 0, 0x18, "ftypheic"))?.mime).toBe("image/heic");
    expect(detectReceiptType(bytes(0, 0, 0, 0x18, "ftypmif1"))?.mime).toBe("image/heic");
    expect(detectReceiptType(bytes("%PDF-1.7"))?.mime).toBe("application/pdf");
  });
  it("refuses GIF, text, MP4 and tiny files", () => {
    expect(detectReceiptType(bytes("GIF89a"))).toBeNull();
    expect(detectReceiptType(bytes("hello world, not an image"))).toBeNull();
    expect(detectReceiptType(bytes(0, 0, 0, 0x18, "ftypisom"))).toBeNull();
    expect(detectReceiptType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("merchant comparison", () => {
  it("matches loosely and ignores filler words", () => {
    expect(merchantsMatch("Riverside FC", "RIVERSIDE F.C. SOCCER CAMP")).toBe(true);
    expect(merchantsMatch("Bright Smile Dental", "Bright Smile Dental Inc.")).toBe(true);
    expect(merchantsMatch("Target", "Riverside FC")).toBe(false);
    expect(merchantKey("Bright Smile Dental, Inc.")).toBe(merchantKey("bright smile dental"));
  });
});

const base = (over: Partial<MatchInput> = {}): MatchInput => ({
  receipt: { merchant: "Riverside FC", date: "2026-11-10", totalCents: 35000, submittedAt: new Date("2026-11-10T15:00:00Z") },
  expense: { vendor: "Riverside FC", approvalState: "APPROVED", approvedCents: 35000, approvalDecidedAt: new Date("2026-11-09T10:00:00Z") },
  verdictWithReceipt: "NEEDS_APPROVAL",
  approvalKnewPurchased: false,
  ...over,
});

describe("matchReceipt", () => {
  it("OK when approved before the purchase and within the amount", () => {
    expect(matchReceipt(base())).toEqual({ result: "OK", issues: [], open: [] });
  });
  it("RC-8: over the approved amount; can be acknowledged", () => {
    const m = matchReceipt(base({ expense: { ...base().expense, approvalState: "PARTIALLY_APPROVED", approvedCents: 20000 } }));
    expect(m.open).toEqual(["OVER_APPROVED"]);
    expect(matchReceipt(base({ expense: { ...base().expense, approvedCents: 20000 }, acknowledged: ["OVER_APPROVED"] })).result).toBe("OK");
  });
  it("RC-9: bought the day before the approval; cannot be acknowledged away", () => {
    const m = matchReceipt(base({ receipt: { ...base().receipt, date: "2026-11-08" }, acknowledged: ["BEFORE_APPROVAL"] }));
    expect(m.open).toEqual(["BEFORE_APPROVAL"]);
  });
  it("same day as the approval is fine; an approval given knowing it was bought is fine", () => {
    expect(matchReceipt(base({ receipt: { ...base().receipt, date: "2026-11-09" } })).result).toBe("OK");
    expect(matchReceipt(base({ receipt: { ...base().receipt, date: "2026-11-01" }, approvalKnewPurchased: true })).result).toBe("OK");
  });
  it("approval needed and never given is BEFORE_APPROVAL", () => {
    for (const s of ["REQUIRED", "REQUESTED", "DECLINED", "EXPIRED", "CANCELLED"] as const) {
      expect(matchReceipt(base({ expense: { ...base().expense, approvalState: s } })).open).toContain("BEFORE_APPROVAL");
    }
  });
  it("a receipt total that crosses the threshold of a no-approval expense is BEFORE_APPROVAL", () => {
    expect(matchReceipt(base({ expense: { ...base().expense, approvalState: "NOT_REQUIRED" }, verdictWithReceipt: "NEEDS_APPROVAL" })).open).toEqual(["BEFORE_APPROVAL"]);
    expect(matchReceipt(base({ expense: { ...base().expense, approvalState: "NOT_REQUIRED" }, verdictWithReceipt: "ELIGIBLE" })).result).toBe("OK");
  });
  it("RC-10: LATE unless an approval was decided after the receipt was submitted", () => {
    const late = base({ verdictWithReceipt: "LATE" });
    expect(matchReceipt(late).open).toEqual(["LATE"]);
    expect(matchReceipt({ ...late, expense: { ...late.expense, approvalDecidedAt: new Date("2026-11-11T09:00:00Z") }, approvalKnewPurchased: true }).result).toBe("OK");
  });
  it("RC-11 and merchant mismatch can be acknowledged", () => {
    const m = matchReceipt(base({ duplicateOf: "abc", receipt: { ...base().receipt, merchant: "Target" } }));
    expect(m.open.sort()).toEqual(["MERCHANT_MISMATCH", "POSSIBLE_DUPLICATE"]);
    expect(matchReceipt(base({ duplicateOf: "abc", receipt: { ...base().receipt, merchant: "Target" }, acknowledged: ["POSSIBLE_DUPLICATE", "MERCHANT_MISMATCH"] })).result).toBe("OK");
  });
  it("no vendor on the expense: no merchant check", () => {
    expect(matchReceipt(base({ expense: { ...base().expense, vendor: null }, receipt: { ...base().receipt, merchant: "Anything" } })).result).toBe("OK");
  });
});
