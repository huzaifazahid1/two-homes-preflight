// Review analysis for DRAFT rule versions (Section A.6.2, AG-3 to AG-7, SE-5). Pure.
// Every AI value must trace to its verified quote; otherwise the rule is NEEDS_REVIEW and
// cannot be confirmed. A parent's edit is the parent's statement, so traceability is not
// re-checked for edited values (the original AI values are kept in `editedFrom`).

import { rulesConflict } from "@/lib/rules-engine";
import type { Rule, RuleIssue } from "@/types/firestore";

export const BLOCKING_ISSUES: ReadonlySet<RuleIssue> = new Set(["quote_not_found", "shares_invalid", "shares_non_numeric", "value_not_in_quote", "conflict"]);

export const ISSUE_TEXT: Record<RuleIssue, string> = {
  quote_not_found: "The quote could not be found in the agreement text, so this rule cannot be confirmed.",
  shares_invalid: "The shares in this clause do not add up to 100%. Enter the percentages yourself.",
  shares_non_numeric: "This clause does not give fixed percentages (for example, proportional to income). Enter the percentages you both use.",
  value_not_in_quote: "A value in this rule does not appear in its quote. Check it against the source and edit it.",
  conflict: "Another clause covers the same expense with different terms. Reject one, or edit them to match.",
  quote_other_page: "The quote was found on a different page than the one given.",
  quote_fuzzy: "The quote is a close but not exact match to the agreement text.",
  vague_terms: "This clause uses vague words. Decide together what they mean.",
};

export function isBlocking(rule: Pick<Rule, "issues">): boolean {
  return (rule.issues ?? []).some((i) => BLOCKING_ISSUES.has(i));
}

const NUMBER_WORDS: Record<number, string[]> = {
  1: ["one"], 2: ["two"], 3: ["three"], 5: ["five"], 7: ["seven"], 10: ["ten"], 14: ["fourteen"], 15: ["fifteen"],
  20: ["twenty"], 21: ["twenty-one", "twenty one"], 25: ["twenty-five", "twenty five"], 30: ["thirty"], 40: ["forty"],
  45: ["forty-five", "forty five"], 50: ["fifty"], 60: ["sixty"], 70: ["seventy"], 75: ["seventy-five", "seventy five"],
  80: ["eighty"], 90: ["ninety"], 100: ["one hundred"],
};

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function numberForms(n: number): string[] {
  const forms = [String(n)];
  if (n >= 1000) forms.push(n.toLocaleString("en-US"));
  return [...forms, ...(NUMBER_WORDS[n] ?? [])];
}

function lower(q: string) {
  return q.toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ");
}

export function percentInQuote(pct: number, quote: string): boolean {
  const q = lower(quote);
  const hit = (n: number) => numberForms(n).some((f) => new RegExp(`(^|[^\\d.])${escape(f)}\\s*(%|percent|per cent)`).test(q));
  if (hit(pct) || hit(100 - pct)) return true;
  if (new RegExp(`\\b${pct}\\s*/\\s*${100 - pct}\\b|\\b${100 - pct}\\s*/\\s*${pct}\\b`).test(q)) return true;
  if (pct === 50 && /\b(equally|equal shares|one-half|one half|half|50-50)\b/.test(q)) return true;
  if (pct === 100 && /\b(entire|full|all of the)\b/.test(q)) return true;
  if (pct === 0 && /\b(solely|sole responsibility|entirely|not be required to contribute)\b/.test(q)) return true;
  return false;
}

export function dollarsInQuote(cents: number, quote: string): boolean {
  if (cents % 100 !== 0) {
    const dec = (cents / 100).toFixed(2);
    return lower(quote).includes(dec);
  }
  const q = lower(quote);
  const d = cents / 100;
  return numberForms(d).some((f) => {
    const e = escape(f);
    return new RegExp(`\\$\\s?${e}(\\.00)?(?![\\d,])`).test(q) || new RegExp(`(^|[^\\d.])${e}(\\.00)?\\s*(dollars|usd|us dollars)`).test(q);
  });
}

export function daysInQuote(days: number, quote: string): boolean {
  const q = lower(quote);
  if (!/\bdays?\b/.test(q)) return false;
  return numberForms(days).some((f) => new RegExp(`(^|[^\\d])${escape(f)}([^\\d]|$)`).test(q));
}

/** Values of an AI rule that cannot be traced to their quote (SE-5: no value without a verified quote). */
export function untracedValues(rule: Rule): string[] {
  const out: string[] = [];
  if (!rule.sharesNonNumeric && !percentInQuote(rule.owedPct, rule.quote)) out.push("owedPct");
  if (rule.approval?.required && !dollarsInQuote(rule.approval.thresholdCents, rule.quote)) out.push("approval");
  const support = (field: "receiptDeadlineDays" | "reimburseWithinDays") => rule.supportingQuotes?.find((s) => s.field === field)?.quote ?? "";
  if (rule.receiptDeadlineDays && !daysInQuote(rule.receiptDeadlineDays, `${rule.quote} ${support("receiptDeadlineDays")}`)) out.push("receiptDeadlineDays");
  if (rule.reimburseWithinDays && !daysInQuote(rule.reimburseWithinDays, `${rule.quote} ${support("reimburseWithinDays")}`)) out.push("reimburseWithinDays");
  return out;
}

/** Issues that belong to one rule on its own (everything except conflicts). */
export function ownIssues(rule: Rule, opts: { sharesSumInvalid?: boolean; humanEdited?: boolean } = {}): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const quotes = [rule.quoteMatch, ...(rule.supportingQuotes ?? []).map((s) => s.quoteMatch)];
  if (quotes.includes("none")) issues.push("quote_not_found");
  if (opts.sharesSumInvalid && !opts.humanEdited) issues.push("shares_invalid");
  if (rule.sharesNonNumeric) issues.push("shares_non_numeric");
  if (!opts.humanEdited && rule.quoteMatch !== "none" && untracedValues(rule).length > 0) issues.push("value_not_in_quote");
  if (quotes.includes("exact_other_page")) issues.push("quote_other_page");
  if (quotes.includes("fuzzy")) issues.push("quote_fuzzy");
  if (rule.vagueTerms && rule.vagueTerms.length > 0) issues.push("vague_terms");
  return issues;
}

function sameScope(a: Rule, b: Rule): boolean {
  const key = (r: Rule) => (r.childIds?.length ? `id:${[...r.childIds].sort().join(",")}` : r.childNames?.length ? `name:${r.childNames.map((n) => n.toLowerCase()).sort().join(",")}` : "all");
  return key(a) === key(b);
}

function sameValues(a: Rule, b: Rule): boolean {
  return sameScope(a, b) && a.category === b.category && !rulesConflict(a, b) && (a.reimburseWithinDays ?? null) === (b.reimburseWithinDays ?? null);
}

/**
 * The same clause repeated on two pages is extracted twice: identical rules are merged into one
 * (the first, which usually has the exact quote). Different values are kept and become a conflict.
 */
export function mergeDuplicates(rules: Rule[]): Rule[] {
  const out: Rule[] = [];
  for (const r of rules) {
    const i = out.findIndex((o) => sameValues(o, r));
    if (i < 0) {
      out.push(r);
      continue;
    }
    // Prefer the copy whose quote verified best.
    const rank = { exact: 0, exact_other_page: 1, fuzzy: 2, none: 3 } as const;
    if (rank[r.quoteMatch] < rank[out[i].quoteMatch]) out[i] = { ...r, id: out[i].id };
  }
  return out;
}

/**
 * Recomputes conflicts and the review state of every non-rejected rule. Blocking issues mean
 * NEEDS_REVIEW; an undecided rule without them is PENDING; CONFIRMED/EDITED rules stay decided
 * unless a new blocking issue appears.
 */
export function applyReview(rules: Rule[]): Rule[] {
  const live = rules.filter((r) => r.reviewState !== "REJECTED");
  return rules.map((r) => {
    if (r.reviewState === "REJECTED") return r;
    const conflicting = live.some((o) => o.id !== r.id && o.category === r.category && sameScope(o, r) && rulesConflict(o, r));
    const base = (r.issues ?? []).filter((i) => i !== "conflict");
    const issues: RuleIssue[] = conflicting ? [...base, "conflict"] : base;
    const blocking = issues.some((i) => BLOCKING_ISSUES.has(i));
    let reviewState = r.reviewState;
    if (blocking) reviewState = "NEEDS_REVIEW";
    else if (reviewState === "NEEDS_REVIEW") reviewState = "PENDING";
    return { ...r, issues, reviewState };
  });
}

export function draftProblems(rules: Rule[]): string | null {
  const live = rules.filter((r) => r.reviewState !== "REJECTED");
  if (live.length === 0) return "Keep at least one rule. Without rules no expense can be checked.";
  const open = live.filter((r) => r.reviewState !== "CONFIRMED" && r.reviewState !== "EDITED");
  if (open.length > 0) return `Confirm, edit or reject every rule first (${open.length} left).`;
  return null;
}
