// "Needs your action" (Phase 3 Home dashboard). Pure and client-safe: one place decides what a
// parent should do next with an expense, for the dashboard, the expense list and the detail page.

import type { ExpenseView } from "@/lib/expense-view";
import type { Role } from "@/types/firestore";

export type NextActionKind =
  | "review_rule"
  | "request_approval"
  | "resend_approval"
  | "decide_approval"
  | "add_receipt"
  | "confirm_receipt"
  | "fix_receipt"
  | "send_payment_request"
  | "confirm_external"
  | "remind_overdue"
  | "pay"
  | "dispute";

export type NextAction = { kind: NextActionKind; label: string; urgent: boolean };

const PRE_CLAIM = new Set(["NONE", "RECEIPT_SUBMITTED", "RECEIPT_ISSUE", "READY"]);
const APPROVAL_OK = new Set(["NOT_REQUIRED", "APPROVED", "PARTIALLY_APPROVED"]);

/** The one thing `me` should do next, or null. `today` is YYYY-MM-DD. */
export function nextAction(e: ExpenseView, me: Role, today: string): NextAction | null {
  const s = e.settlement.state;
  if (s === "CANCELLED") return null;
  const buyer = e.paidByRole === me;
  const blocked = e.verdict.code === "NOT_COVERED";
  if (e.verdict.code === "NEEDS_REVIEW" && PRE_CLAIM.has(s)) return { kind: "review_rule", label: "Talk about the rule first", urgent: false };

  if (PRE_CLAIM.has(s) && !blocked) {
    const a = e.approval.state;
    if (buyer && a === "REQUIRED") return { kind: "request_approval", label: "Ask for approval", urgent: false };
    if (buyer && a === "EXPIRED") return { kind: "resend_approval", label: "Request expired: send again", urgent: false };
    if (!buyer && a === "REQUESTED") return { kind: "decide_approval", label: "Waiting for your approval", urgent: true };
  }
  if (buyer && !blocked) {
    if (s === "NONE" && APPROVAL_OK.has(e.approval.state) && (e.mode === "purchased" || e.approval.state !== "NOT_REQUIRED" || (e.date !== null && e.date <= today))) {
      return { kind: "add_receipt", label: "Add the receipt", urgent: false };
    }
    if (s === "RECEIPT_SUBMITTED") return { kind: "confirm_receipt", label: "Check the receipt", urgent: false };
    if (s === "RECEIPT_ISSUE") return { kind: "fix_receipt", label: "Receipt needs a look", urgent: true };
    if (s === "READY" && APPROVAL_OK.has(e.approval.state)) return { kind: "send_payment_request", label: "Send the payment request", urgent: false };
    if (s === "EXTERNAL_PAYMENT_REPORTED") return { kind: "confirm_external", label: "Confirm the payment", urgent: true };
    if ((s === "AWAITING_PAYMENT" || s === "PAYMENT_FAILED") && e.settlement.overdue) return { kind: "remind_overdue", label: "Overdue", urgent: true };
  }
  if (!buyer && (s === "AWAITING_PAYMENT" || s === "PAYMENT_FAILED")) return { kind: "pay", label: e.settlement.overdue ? "Your share is overdue" : "Your share is due", urgent: e.settlement.overdue };
  if (s === "DISPUTED") return { kind: "dispute", label: "Disputed", urgent: true };
  return null;
}
