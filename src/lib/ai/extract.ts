import "server-only";
import { newId } from "@/lib/ids";
import { parseDollarsToCents } from "@/lib/money";
import { verifyQuote, type PageText } from "@/lib/quote-verify";
import { applyReview, mergeDuplicates, ownIssues } from "@/lib/rules-review";
import type { ExtractedParties, Quoted, Rule, SupportingQuote } from "@/types/firestore";
import { generateJson } from "./gemini";
import { EXTRACTION_SYSTEM, extractionUserPrompt } from "./prompts";
import { aiExtractionJsonSchema, aiExtractionSchema, type AiExtraction, type AiRule } from "./schemas";

// AI output -> DRAFT rules. Every quote is verified against the stored page text; nothing the AI
// cannot quote can be confirmed (A.6.2). Values that do not appear in their quote are flagged (SE-5).

const VAGUE = /\b(reasonable|reasonably|necessary|appropriate|customary|significant|substantial|extraordinary|ordinary)\b/gi;

export async function runExtraction(pages: PageText[], requestId?: string) {
  return generateJson({
    label: "extraction",
    system: EXTRACTION_SYSTEM,
    prompt: extractionUserPrompt(pages),
    jsonSchema: aiExtractionJsonSchema,
    schema: aiExtractionSchema,
    requestId,
    maxOutputTokens: 16_384,
    thinking: "LOW",
  });
}

function pct(n: number | undefined): number | undefined {
  return n === undefined || !Number.isFinite(n) ? undefined : Math.round(n * 100) / 100;
}

/** In demo mode the cached page numbers are our own guess, so the verified location wins. */
function relocate(v: ReturnType<typeof verifyQuote>, relocatePages: boolean): ReturnType<typeof verifyQuote> {
  return relocatePages && v.match === "exact_other_page" ? { ...v, match: "exact" } : v;
}

export function aiRuleToRule(ai: AiRule, pages: PageText[], source: "ai" | "demo"): Rule {
  const relocatePages = source === "demo";
  const v = relocate(verifyQuote(ai.quote, pages, ai.page), relocatePages);

  // Shares: the share the other (non-buying) parent owes.
  const other = pct(ai.otherParentPct);
  const paying = pct(ai.payingParentPct);
  let owedPct = 0;
  let sharesSumInvalid = false;
  const nonNumeric = Boolean(ai.sharesNonNumeric);
  if (!nonNumeric) {
    if (other !== undefined) owedPct = other;
    else if (paying !== undefined) owedPct = Math.round((100 - paying) * 100) / 100;
    else sharesSumInvalid = true;
    if (other !== undefined && paying !== undefined && Math.abs(other + paying - 100) > 0.01) sharesSumInvalid = true;
    if (owedPct < 0 || owedPct > 100) {
      sharesSumInvalid = true;
      owedPct = Math.min(100, Math.max(0, owedPct));
    }
  }

  let approval: Rule["approval"];
  let thresholdUnreadable = false;
  if (ai.approvalRequired) {
    const cents = ai.approvalThresholdDollars ? parseDollarsToCents(ai.approvalThresholdDollars) : null;
    if (ai.approvalThresholdDollars && cents === null) thresholdUnreadable = true;
    // No amount in the clause means every expense in the category needs approval.
    approval = cents === null ? { required: true, operator: "gte", thresholdCents: 0 } : { required: true, operator: ai.approvalOperator ?? "gt", thresholdCents: cents };
  }

  const supportingQuotes: SupportingQuote[] = [];
  const support = (field: SupportingQuote["field"], quote?: string, page?: number) => {
    if (!quote) return;
    const sv = relocate(verifyQuote(quote, pages, page ?? v.page), relocatePages);
    supportingQuotes.push({ field, quote, page: sv.page, quoteMatch: sv.match });
  };
  if (ai.receiptDeadlineDays) support("receiptDeadlineDays", ai.receiptDeadlineQuote, ai.receiptDeadlinePage);
  if (ai.reimburseWithinDays) support("reimburseWithinDays", ai.reimburseQuote, ai.reimbursePage);

  const vague = new Set((ai.vagueTerms ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean));
  for (const m of ai.quote.matchAll(VAGUE)) vague.add(m[1].toLowerCase());
  const childNames = (ai.childFirstNames ?? []).map((n) => n.trim()).filter(Boolean);

  const rule: Rule = {
    id: newId(12),
    category: ai.category,
    label: ai.label.trim(),
    owedPct,
    ...(nonNumeric ? { sharesNonNumeric: true } : {}),
    ...(approval ? { approval } : {}),
    ...(ai.receiptDeadlineDays ? { receiptDeadlineDays: ai.receiptDeadlineDays } : {}),
    ...(ai.reimburseWithinDays ? { reimburseWithinDays: ai.reimburseWithinDays } : {}),
    ...(childNames.length ? { childNames } : {}),
    quote: ai.quote.trim(),
    page: v.page,
    quoteMatch: v.match,
    ...(supportingQuotes.length ? { supportingQuotes } : {}),
    ...(vague.size ? { vagueTerms: [...vague] } : {}),
    source,
    reviewState: "PENDING",
  };
  const issues = ownIssues(rule, { sharesSumInvalid });
  if (thresholdUnreadable && !issues.includes("value_not_in_quote")) issues.push("value_not_in_quote");
  return { ...rule, issues };
}

function quoted<T>(value: T, quote: string, page: number, pages: PageText[], relocatePages: boolean): Quoted<T> | null {
  const v = relocate(verifyQuote(quote, pages, page), relocatePages);
  // A name the AI cannot quote is never used for prefill.
  return v.match === "none" ? null : { value, quote, page: v.page, quoteMatch: v.match };
}

export function buildDraft(ai: AiExtraction, pages: PageText[], source: "ai" | "demo"): { rules: Rule[]; parties: ExtractedParties } {
  const rules = applyReview(mergeDuplicates(ai.rules.map((r) => aiRuleToRule(r, pages, source))));
  const relocatePages = source === "demo";
  const parents = (ai.parents ?? []).map((p) => quoted(p.name.trim(), p.quote, p.page, pages, relocatePages)).filter((x): x is Quoted<string> => x !== null);
  const children = (ai.children ?? [])
    .map((c) => quoted({ firstName: c.firstName.trim(), ...(c.birthYear ? { birthYear: c.birthYear } : {}) }, c.quote, c.page, pages, relocatePages))
    .filter((x): x is Quoted<{ firstName: string; birthYear?: number }> => x !== null);
  return { rules, parties: { parents, children } };
}
