// Deterministic rules engine (Section A.6.1). Never AI. Pure: no Firestore, no clock (now is passed).
// evaluate(expenseInput, ruleVersion, now) -> { verdict, ruleId, citations, explanation, shares }

import { formatCents, splitShares } from "@/lib/money";
import type { Rule, RuleCategory, VerdictCode } from "@/types/firestore";

export { MAX_AMOUNT_CENTS } from "@/schemas/expense";
import { MAX_AMOUNT_CENTS } from "@/schemas/expense";
const DAY = 86_400_000;

export type EngineInput = {
  category: RuleCategory;
  child: { id: string; firstName: string };
  amountCents: number;
  currency: string;
  mode: "planned" | "purchased";
  purchaseDate?: Date | null;
  /** When the receipt was (or will be) submitted. Absent at preflight. */
  receiptSubmittedAt?: Date | null;
  /** "claim" = a payment request is being prepared (receipt is then required evidence). */
  stage?: "preflight" | "claim";
  hasReceipt?: boolean;
  /** When partially approved, shares are computed on min(receiptTotal, approvedCents). */
  approvedCents?: number | null;
  receiptTotalCents?: number | null;
};

export type EngineRuleVersion = {
  id: string;
  rules: Rule[];
  coParentAck?: { perRule: Record<string, "agree" | "disagree"> } | null;
};

export type Citation = { quote: string; page: number };

export type EngineResult = {
  verdict: VerdictCode;
  ruleId?: string;
  citations: Citation[];
  explanation: string;
  shares: { owedShareCents: number; otherShareCents: number; basisCents: number; owedPct: number | null };
  approval: { required: boolean; operator?: "gt" | "gte"; thresholdCents?: number };
};

export class EngineValidationError extends Error {
  constructor(
    readonly field: "currency" | "amountCents",
    message: string,
  ) {
    super(message);
    this.name = "EngineValidationError";
  }
}

const ACCEPTED: ReadonlySet<Rule["reviewState"]> = new Set(["CONFIRMED", "EDITED", "PENDING", "NEEDS_REVIEW"]);

function norm(name: string): string {
  return name.trim().toLowerCase();
}

/** Rule applies to this child: no child scope, or the child is listed by id or first name. */
export function ruleAppliesToChild(rule: Rule, child: { id: string; firstName: string }): boolean {
  if (rule.childIds && rule.childIds.length > 0) return rule.childIds.includes(child.id);
  if (rule.childNames && rule.childNames.length > 0) return rule.childNames.map(norm).includes(norm(child.firstName));
  return true;
}

function isChildSpecific(rule: Rule): boolean {
  return Boolean(rule.childIds?.length || rule.childNames?.length);
}

/** Two matched rules conflict when the values an expense depends on differ. */
export function rulesConflict(a: Rule, b: Rule): boolean {
  const ap = a.approval?.required ? `${a.approval.operator}:${a.approval.thresholdCents}` : "none";
  const bp = b.approval?.required ? `${b.approval.operator}:${b.approval.thresholdCents}` : "none";
  return a.owedPct !== b.owedPct || Boolean(a.sharesNonNumeric) !== Boolean(b.sharesNonNumeric) || ap !== bp || (a.receiptDeadlineDays ?? null) !== (b.receiptDeadlineDays ?? null);
}

export function meetsThreshold(amountCents: number, approval: NonNullable<Rule["approval"]>): boolean {
  return approval.operator === "gte" ? amountCents >= approval.thresholdCents : amountCents > approval.thresholdCents;
}

function cite(rule: Rule, field?: "receiptDeadlineDays" | "reimburseWithinDays"): Citation[] {
  const out: Citation[] = [{ quote: rule.quote, page: rule.page }];
  const extra = field ? rule.supportingQuotes?.find((s) => s.field === field) : undefined;
  if (extra) out.push({ quote: extra.quote, page: extra.page });
  return out;
}

function sharesFor(rule: Rule | null, input: EngineInput): EngineResult["shares"] {
  let basis = input.amountCents;
  if (typeof input.approvedCents === "number" && input.approvedCents < basis) basis = input.approvedCents;
  if (typeof input.receiptTotalCents === "number" && input.receiptTotalCents < basis) basis = input.receiptTotalCents;
  if (!rule || rule.sharesNonNumeric) return { owedShareCents: 0, otherShareCents: basis, basisCents: basis, owedPct: null };
  const { owedShareCents, otherShareCents } = splitShares(basis, rule.owedPct);
  return { owedShareCents, otherShareCents, basisCents: basis, owedPct: rule.owedPct };
}

const PLAIN: Record<string, string> = { gt: "above", gte: "from" };

export function validateEngineInput(input: Pick<EngineInput, "currency" | "amountCents">) {
  if (input.currency !== "USD") throw new EngineValidationError("currency", "Only US dollars (USD) are supported.");
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new EngineValidationError("amountCents", "Enter an amount greater than $0.");
  }
  if (input.amountCents > MAX_AMOUNT_CENTS) throw new EngineValidationError("amountCents", "The amount cannot be more than $100,000.");
}

export function evaluate(input: EngineInput, ruleVersion: EngineRuleVersion | null, now: Date): EngineResult {
  // 1. Currency and amount: a validation error, not a verdict.
  validateEngineInput(input);
  const noApproval = { required: false };

  // 2. Rules for the category, filtered by child.
  const candidates = (ruleVersion?.rules ?? []).filter((r) => ACCEPTED.has(r.reviewState) && r.category === input.category && ruleAppliesToChild(r, input.child));
  if (!ruleVersion || candidates.length === 0) {
    return {
      verdict: "NOT_COVERED",
      citations: [],
      explanation: ruleVersion
        ? "The agreement has no confirmed rule for this kind of expense. You can still record it, but it cannot be sent for approval or payment."
        : "There are no confirmed agreement rules yet, so nothing can be checked.",
      shares: sharesFor(null, input),
      approval: noApproval,
    };
  }
  // A child-specific rule wins over a general rule for the same category.
  const specific = candidates.filter(isChildSpecific);
  const matched = specific.length > 0 ? specific : candidates;
  const rule = matched[0];

  // 3. Needs review: unresolved rule, conflicting matched rules, or the co-parent disagreed.
  const ack = ruleVersion.coParentAck?.perRule ?? {};
  const unresolved = matched.find((r) => r.reviewState === "NEEDS_REVIEW" || r.reviewState === "PENDING");
  const conflict = matched.length > 1 && matched.some((r) => rulesConflict(r, rule));
  const disagreed = matched.find((r) => ack[r.id] === "disagree");
  if (unresolved || conflict || disagreed) {
    const reason = disagreed
      ? "The other parent disagreed with this rule, so this expense needs to be discussed before it is checked automatically."
      : conflict
        ? "Two clauses of the agreement cover this expense with different terms. Review them before relying on either."
        : "This rule has not been confirmed yet.";
    return {
      verdict: "NEEDS_REVIEW",
      ruleId: (disagreed ?? unresolved ?? rule).id,
      citations: matched.flatMap((r) => cite(r)),
      explanation: reason,
      shares: sharesFor(conflict ? null : rule, input),
      approval: noApproval,
    };
  }

  const shares = sharesFor(rule, input);
  const approvalRequired = Boolean(rule.approval?.required && meetsThreshold(input.amountCents, rule.approval));
  const approval = rule.approval?.required ? { required: approvalRequired, operator: rule.approval.operator, thresholdCents: rule.approval.thresholdCents } : noApproval;

  // 4. Receipt deadline.
  if (rule.receiptDeadlineDays && input.receiptSubmittedAt && input.purchaseDate) {
    const deadline = input.purchaseDate.getTime() + rule.receiptDeadlineDays * DAY;
    if (input.receiptSubmittedAt.getTime() > deadline) {
      return {
        verdict: "LATE",
        ruleId: rule.id,
        citations: cite(rule, "receiptDeadlineDays"),
        explanation: `The agreement asks for receipts within ${rule.receiptDeadlineDays} days of purchase. This one is late, so the other parent's approval is needed as an exception.`,
        shares,
        approval: { ...approval, required: true },
      };
    }
  }

  // 5. Approval threshold.
  if (approvalRequired && rule.approval) {
    const what = `${rule.label}: ${PLAIN[rule.approval.operator]} ${formatCents(rule.approval.thresholdCents)} needs the other parent's written approval (p. ${rule.page}).`;
    return {
      verdict: "NEEDS_APPROVAL",
      ruleId: rule.id,
      citations: cite(rule),
      explanation: input.mode === "purchased" ? `Approval was required before purchase. ${what}` : what,
      shares,
      approval,
    };
  }

  // 6. Required evidence at claim time.
  if (input.stage === "claim" && !input.hasReceipt) {
    return {
      verdict: "MISSING_EVIDENCE",
      ruleId: rule.id,
      citations: cite(rule),
      explanation: "Upload the receipt before asking for a share of this expense.",
      shares,
      approval,
    };
  }

  // 7. Eligible.
  const share = rule.sharesNonNumeric ? "" : ` The other parent's share is ${rule.owedPct}%.`;
  const limit = rule.approval?.required ? ` No approval needed up to ${formatCents(rule.approval.thresholdCents)}${rule.approval.operator === "gte" ? " (not including it)" : ""}.` : " No approval needed.";
  void now;
  return {
    verdict: "ELIGIBLE",
    ruleId: rule.id,
    citations: cite(rule),
    explanation: `Covered by ${rule.label.toLowerCase()} (p. ${rule.page}).${share}${limit}`,
    shares,
    approval,
  };
}
