import { describe, expect, it } from "vitest";
import { paymentReminderKind } from "@/lib/jobs/daily";
import { nextAction } from "@/lib/next-action";
import type { ExpenseView } from "@/lib/expense-view";
import type { ReminderKind, SettlementState } from "@/types/firestore";

const DAY = 86_400_000;
const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const DUE = Date.parse("2026-12-10T12:00:00Z");
const st = (state: SettlementState, kinds: ReminderKind[] = []) => ({ state, dueAt: ts(DUE), reminders: kinds.map((kind) => ({ kind, at: ts(DUE - 10 * DAY) })) });

describe("paymentReminderKind (A.6.4, CL-10)", () => {
  it("due soon in the last 3 days before dueAt, then overdue on day 1, 8 and 15", () => {
    expect(paymentReminderKind(st("AWAITING_PAYMENT"), new Date(DUE - 4 * DAY))).toBeNull();
    expect(paymentReminderKind(st("AWAITING_PAYMENT"), new Date(DUE - 2 * DAY))).toBe("due_soon");
    expect(paymentReminderKind(st("AWAITING_PAYMENT", ["due_soon"]), new Date(DUE + 60_000))).toBe("overdue_1");
    expect(paymentReminderKind(st("AWAITING_PAYMENT", ["due_soon", "overdue_1"]), new Date(DUE + 3 * DAY))).toBeNull();
    expect(paymentReminderKind(st("AWAITING_PAYMENT", ["due_soon", "overdue_1"]), new Date(DUE + 7 * DAY + 60_000))).toBe("overdue_8");
    expect(paymentReminderKind(st("PAYMENT_FAILED", ["due_soon", "overdue_1", "overdue_8"]), new Date(DUE + 14 * DAY + 60_000))).toBe("overdue_15");
  });
  it("never more than 4 automatic reminders; manual ones do not count", () => {
    expect(paymentReminderKind(st("AWAITING_PAYMENT", ["due_soon", "overdue_1", "overdue_8", "overdue_15"]), new Date(DUE + 30 * DAY))).toBeNull();
    expect(paymentReminderKind(st("AWAITING_PAYMENT", ["manual", "manual", "manual", "manual"]), new Date(DUE - DAY))).toBe("due_soon");
  });
  it("only open claims get reminders", () => {
    for (const s of ["EXTERNAL_PAYMENT_REPORTED", "SETTLED_EXTERNALLY", "WAIVED", "DISPUTED", "READY"] as const) {
      expect(paymentReminderKind(st(s), new Date(DUE + DAY))).toBeNull();
    }
  });
});

function view(over: { settlement?: Partial<ExpenseView["settlement"]>; approval?: Partial<ExpenseView["approval"]> } & Partial<Omit<ExpenseView, "settlement" | "approval">> = {}): ExpenseView {
  const { settlement, approval, ...rest } = over;
  return {
    id: "e1", childId: "c", childName: "Mia", category: "dental", description: "Cleaning", vendor: null, amountCents: 12000, currency: "USD", mode: "planned", date: "2026-11-20",
    paidByRole: "owner", owedByRole: "coparent", ruleVersionId: "rv", verdict: { code: "ELIGIBLE", ruleId: "r", citations: [], explanation: "", owedShareCents: 6000 }, rule: null,
    approval: { state: "NOT_REQUIRED", approvedCents: null, expiresAt: null, decidedAt: null, blockedUntil: null, reason: null, ...approval },
    settlement: { state: "NONE", owedCents: null, dueAt: null, requestSentAt: null, overdue: false, dueSoon: false, contestUntil: null, settledAt: null, externalReport: null, waiverReason: null, lastManualReminderAt: null, ...settlement },
    receiptId: null, purchasedBeforeApproval: false, possibleDuplicateOf: null, version: 1, createdAt: "", updatedAt: "", ...rest,
  } as ExpenseView;
}

describe("nextAction", () => {
  const today = "2026-11-10";
  it("buyer: ask for approval, add receipt after the planned day, confirm, send the request", () => {
    expect(nextAction(view({ verdict: { code: "NEEDS_APPROVAL", citations: [], explanation: "", owedShareCents: 0, ruleId: null }, approval: { state: "REQUIRED" } }), "owner", today)?.kind).toBe("request_approval");
    expect(nextAction(view(), "owner", today)).toBeNull(); // planned for later, no approval needed
    expect(nextAction(view({ date: "2026-11-01" }), "owner", today)?.kind).toBe("add_receipt");
    expect(nextAction(view({ settlement: { state: "RECEIPT_SUBMITTED" } }), "owner", today)?.kind).toBe("confirm_receipt");
    expect(nextAction(view({ settlement: { state: "READY" } }), "owner", today)?.kind).toBe("send_payment_request");
    expect(nextAction(view({ settlement: { state: "EXTERNAL_PAYMENT_REPORTED" } }), "owner", today)).toMatchObject({ kind: "confirm_external", urgent: true });
  });
  it("payer sees what they owe; overdue is urgent", () => {
    expect(nextAction(view({ settlement: { state: "AWAITING_PAYMENT", overdue: true } }), "coparent", today)).toMatchObject({ kind: "pay", urgent: true });
    expect(nextAction(view({ settlement: { state: "AWAITING_PAYMENT", overdue: true } }), "owner", today)?.kind).toBe("remind_overdue");
  });
  it("nothing for cancelled, not covered or settled", () => {
    expect(nextAction(view({ settlement: { state: "CANCELLED" } }), "owner", today)).toBeNull();
    expect(nextAction(view({ verdict: { code: "NOT_COVERED", citations: [], explanation: "", owedShareCents: 0, ruleId: null }, date: "2026-11-01" }), "owner", today)).toBeNull();
    expect(nextAction(view({ settlement: { state: "SETTLED_EXTERNALLY" } }), "owner", today)).toBeNull();
  });
});
