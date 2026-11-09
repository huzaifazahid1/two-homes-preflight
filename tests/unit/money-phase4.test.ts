import { describe, expect, it } from "vitest";
import { feeBreakdown, usageMonth } from "@/lib/fees";
import { expenseIdFromBatch, itemStatus, payoutEventFor, senderBatchId } from "@/lib/paypal/payouts";
import { fromWebhookResource, mapStatus } from "@/lib/paypal/subscriptions";
import { isEntitled } from "@/lib/state/effective";

const cfg = { coveredVolumeCents: 20000, feePercentBps: 349, feeFixedCents: 49 };

describe("fee line (G.2)", () => {
  it("inside the covered volume there is no fee", () => {
    expect(feeBreakdown(6000, 0, cfg)).toEqual({ owedCents: 6000, coveredCents: 6000, uncoveredCents: 0, feeLineCents: 0, totalCents: 6000, coveredRemainingCents: 20000 });
  });
  it("PY-15: only the uncovered part pays the fee (rounded up)", () => {
    const b = feeBreakdown(6000, 15000, cfg);
    expect(b).toMatchObject({ coveredCents: 5000, uncoveredCents: 1000, feeLineCents: 35 + 49, totalCents: 6084 });
  });
  it("fully above the volume", () => {
    expect(feeBreakdown(10000, 25000, cfg)).toMatchObject({ coveredCents: 0, uncoveredCents: 10000, feeLineCents: 349 + 49, coveredRemainingCents: 0 });
  });
  it("rejects non-integer or non-positive amounts", () => {
    expect(() => feeBreakdown(0, 0, cfg)).toThrow();
    expect(() => feeBreakdown(10.5, 0, cfg)).toThrow();
  });
  it("usage month is UTC yyyymm", () => {
    expect(usageMonth(new Date("2026-11-30T23:59:59Z"))).toBe("202611");
    expect(usageMonth(new Date("2026-12-01T00:00:00Z"))).toBe("202612");
  });
});

describe("payout status mapping (G.7)", () => {
  it("maps item statuses to settlement events", () => {
    expect(payoutEventFor("SUCCESS")).toBe("PAYOUT_SUCCESS");
    expect(payoutEventFor("UNCLAIMED")).toBe("PAYOUT_UNCLAIMED");
    for (const s of ["FAILED", "RETURNED", "BLOCKED", "CANCELED", "REFUNDED", "DENIED"] as const) expect(payoutEventFor(s)).toBe("PAYOUT_FAILED");
    for (const s of ["PENDING", "PROCESSING", "HELD"] as const) expect(payoutEventFor(s)).toBeNull();
  });
  it("normalises PayPal's raw statuses", () => {
    expect(itemStatus("ONHOLD")).toBe("HELD");
    expect(itemStatus("success")).toBe("SUCCESS");
    expect(itemStatus(undefined)).toBe("PENDING");
    expect(itemStatus("SOMETHING_NEW")).toBe("PENDING");
  });
  it("sender_batch_id round-trips to the expense id", () => {
    expect(senderBatchId("abcDEF123", 2)).toBe("abcDEF123-2");
    expect(expenseIdFromBatch("abcDEF123-2")).toBe("abcDEF123");
    expect(expenseIdFromBatch("nodash")).toBeNull();
  });
});

describe("subscriptions (G.6, E.6.3)", () => {
  it("APPROVED and unknown statuses are not entitled", () => {
    expect(mapStatus("APPROVED")).toBe("APPROVAL_PENDING");
    expect(mapStatus("ACTIVE")).toBe("ACTIVE");
    expect(isEntitled({ status: mapStatus("APPROVED") }, new Date())).toBe(false);
  });
  it("reads a webhook resource, including the trial cycle", () => {
    const info = fromWebhookResource({
      id: "I-1", status: "ACTIVE", plan_id: "P-1", custom_id: "fam1",
      billing_info: { next_billing_time: "2026-11-24T10:00:00Z", cycle_executions: [{ tenure_type: "TRIAL", cycles_completed: 0, cycles_remaining: 1 }] },
    });
    expect(info).toMatchObject({ id: "I-1", status: "ACTIVE", customId: "fam1", inTrial: true, nextBillingTime: "2026-11-24T10:00:00Z" });
    expect(fromWebhookResource({ nope: true })).toBeNull();
  });
  it("SB-3: cancelled is entitled until paidThrough only", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(isEntitled({ status: "CANCELLED", paidThrough: new Date("2026-11-20T00:00:00Z") }, now)).toBe(true);
    expect(isEntitled({ status: "CANCELLED", paidThrough: new Date("2026-11-01T00:00:00Z") }, now)).toBe(false);
    expect(isEntitled({ status: "SUSPENDED", paidThrough: new Date("2026-11-20T00:00:00Z") }, now)).toBe(false);
  });
});
