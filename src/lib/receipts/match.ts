// Receipt match (Phase 3, RC-8 to RC-11). Pure: no Firestore, no clock (times are passed in).
// Compares the confirmed receipt with the approval and the agreement. The verdict itself still
// comes only from the rules engine; this only lists what a parent must look at before claiming.

import type { ApprovalState, MatchIssue, VerdictCode } from "@/types/firestore";

export type MatchInput = {
  receipt: { merchant: string; date: string; totalCents: number; submittedAt: Date };
  expense: { vendor?: string | null; approvalState: ApprovalState; approvedCents?: number | null; approvalDecidedAt?: Date | null };
  /** Engine verdict with the receipt's facts (total, purchase date, submission time). */
  verdictWithReceipt: VerdictCode;
  /** The approver decided knowing it was already bought (receipt first, A.5.4). */
  approvalKnewPurchased: boolean;
  /** Another receipt of the family with the same merchant, date and total (RC-11). */
  duplicateOf?: string | null;
  /** Issues a parent already looked at and accepted. */
  acknowledged?: readonly MatchIssue[];
};

export type MatchResult = {
  result: "OK" | "ISSUES";
  /** Every issue found, including acknowledged ones (shown as history). */
  issues: MatchIssue[];
  /** Issues still blocking the claim. */
  open: MatchIssue[];
};

/** A parent may accept these after reading them. The others need the other parent's approval. */
export const ACKNOWLEDGEABLE: ReadonlySet<MatchIssue> = new Set(["OVER_APPROVED", "MERCHANT_MISMATCH", "POSSIBLE_DUPLICATE"]);

const APPROVED: ReadonlySet<ApprovalState> = new Set(["APPROVED", "PARTIALLY_APPROVED"]);
const NOT_GIVEN: ReadonlySet<ApprovalState> = new Set(["REQUIRED", "REQUESTED", "DECLINED", "EXPIRED", "CANCELLED"]);

const STOP = new Set(["the", "and", "inc", "llc", "ltd", "co", "corp", "company", "store", "shop", "shops", "of", "at", "llp"]);

export function merchantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Loose comparison: one name contains the other, or they share a meaningful word. */
export function merchantsMatch(a: string, b: string): boolean {
  const na = merchantTokens(a);
  const nb = merchantTokens(b);
  if (na.length === 0 || nb.length === 0) return true; // nothing to compare: do not raise a false alarm
  const ja = na.join("");
  const jb = nb.join("");
  if (ja.includes(jb) || jb.includes(ja)) return true;
  const set = new Set(na);
  return nb.some((t) => set.has(t));
}

/** Normalised merchant for duplicate lookups (same merchant + date + total). */
export function merchantKey(name: string): string {
  return merchantTokens(name).join(" ");
}

function isoDayUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function matchReceipt(input: MatchInput): MatchResult {
  const issues: MatchIssue[] = [];
  const { receipt, expense } = input;
  const approved = APPROVED.has(expense.approvalState);

  // RC-8: more than the other parent approved. Only the approved amount can be claimed.
  if (approved && typeof expense.approvedCents === "number" && receipt.totalCents > expense.approvedCents) issues.push("OVER_APPROVED");

  // RC-9: bought before the approval. Approval that was needed and never given counts too,
  // and so does a receipt total that crosses the approval threshold of a "no approval" expense.
  const decidedDay = expense.approvalDecidedAt ? isoDayUtc(expense.approvalDecidedAt) : null;
  const before =
    NOT_GIVEN.has(expense.approvalState) ||
    (expense.approvalState === "NOT_REQUIRED" && input.verdictWithReceipt === "NEEDS_APPROVAL") ||
    (approved && !input.approvalKnewPurchased && decidedDay !== null && receipt.date < decidedDay);
  if (before) issues.push("BEFORE_APPROVAL");

  // RC-10: submitted after the agreement's receipt deadline. An approval decided after the receipt
  // was submitted is the exception the agreement asks for (the approver saw it was late).
  const lateExcused = approved && expense.approvalDecidedAt != null && expense.approvalDecidedAt.getTime() >= receipt.submittedAt.getTime();
  if (input.verdictWithReceipt === "LATE" && !lateExcused) issues.push("LATE");

  if (expense.vendor && expense.vendor.trim() && !merchantsMatch(expense.vendor, receipt.merchant)) issues.push("MERCHANT_MISMATCH");

  if (input.duplicateOf) issues.push("POSSIBLE_DUPLICATE");

  const ack = new Set(input.acknowledged ?? []);
  const open = issues.filter((i) => !(ACKNOWLEDGEABLE.has(i) && ack.has(i)));
  return { result: open.length === 0 ? "OK" : "ISSUES", issues, open };
}
