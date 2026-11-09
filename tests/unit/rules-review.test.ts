import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aiRuleToRule, buildDraft } from "@/lib/ai/extract";
import { aiExtractionSchema } from "@/lib/ai/schemas";
import { pagesFromPastedText } from "@/lib/pdf";
import { applyReview, dollarsInQuote, draftProblems, daysInQuote, mergeDuplicates, percentInQuote } from "@/lib/rules-review";
import type { Rule } from "@/types/firestore";

const demoText = readFileSync("fixtures/agreement/demo-agreement.md", "utf8");
const demoPages = pagesFromPastedText(demoText);
const demoAi = aiExtractionSchema.parse(JSON.parse(readFileSync("fixtures/ai/demo-agreement-extraction.json", "utf8")));

describe("value tracing", () => {
  it("finds percentages in common forms", () => {
    expect(percentInQuote(40, "the Other Parent reimbursing forty percent (40%)")).toBe(true);
    expect(percentInQuote(50, "shall be shared equally by the Parents")).toBe(true);
    expect(percentInQuote(40, "shared 60/40 between them")).toBe(true);
    expect(percentInQuote(30, "shared equally by the Parents")).toBe(false);
  });
  it("finds dollar amounts", () => {
    expect(dollarsInQuote(20000, "any expense above $200 requires approval")).toBe(true);
    expect(dollarsInQuote(150000, "costs over $1,500.00 need consent")).toBe(true);
    expect(dollarsInQuote(20000, "any expense above $2000 requires approval")).toBe(false);
    expect(dollarsInQuote(0, "set the threshold to $0")).toBe(true);
  });
  it("finds day counts", () => {
    expect(daysInQuote(30, "within thirty (30) days of the purchase")).toBe(true);
    expect(daysInQuote(14, "within thirty (30) days")).toBe(false);
  });
});

describe("demo fixture extraction", () => {
  const { rules, parties } = buildDraft(demoAi, demoPages, "demo");

  it("pastes into 6 pages from the --- Page N --- markers", () => {
    expect(demoPages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("all quotes verify and the repeated clause is merged, not a conflict", () => {
    expect(rules.map((r) => r.category).sort()).toEqual(["clothing", "dental", "extracurricular", "medical", "school_supplies"]);
    for (const r of rules) {
      expect(r.quoteMatch, r.label).toBe("exact");
      expect(r.issues, r.label).not.toContain("conflict");
      expect(r.issues, r.label).not.toContain("value_not_in_quote");
    }
    const extra = rules.find((r) => r.category === "extracurricular")!;
    expect(extra.page).toBe(4);
    expect(extra.owedPct).toBe(40);
    expect(extra.approval).toEqual({ required: true, operator: "gt", thresholdCents: 20000 });
    expect(extra.supportingQuotes?.map((s) => s.page)).toEqual([2, 2]);
  });

  it("clothing gets the vague-term warning but stays confirmable", () => {
    const clothing = rules.find((r) => r.category === "clothing")!;
    expect(clothing.vagueTerms).toContain("reasonable");
    expect(clothing.reviewState).toBe("PENDING");
  });

  it("ON-5: parties are prefilled from verified quotes", () => {
    expect(parties.parents.map((p) => p.value)).toEqual(["Alex Rivera", "Sara Rivera"]);
    expect(parties.children).toEqual([expect.objectContaining({ value: { firstName: "Mia", birthYear: 2016 }, page: 1 })]);
  });
});

describe("AI rule checks", () => {
  const base = demoAi.rules.find((r) => r.category === "extracurricular")!;

  it("AG-3: a hallucinated quote is NEEDS_REVIEW", () => {
    const r = applyReview([aiRuleToRule({ ...base, quote: "Extracurricular costs are paid by Sara alone with no approval needed." }, demoPages, "ai")])[0];
    expect(r.quoteMatch).toBe("none");
    expect(r.issues).toContain("quote_not_found");
    expect(r.reviewState).toBe("NEEDS_REVIEW");
  });

  it("AG-6: shares 70/40 are invalid and need manual entry", () => {
    const r = applyReview([aiRuleToRule({ ...base, payingParentPct: 70, otherParentPct: 40 }, demoPages, "ai")])[0];
    expect(r.issues).toContain("shares_invalid");
    expect(r.reviewState).toBe("NEEDS_REVIEW");
  });

  it("proportional to income is NEEDS_REVIEW until percentages are entered", () => {
    const r = applyReview([aiRuleToRule({ ...base, payingParentPct: undefined, otherParentPct: undefined, sharesNonNumeric: true }, demoPages, "ai")])[0];
    expect(r.sharesNonNumeric).toBe(true);
    expect(r.issues).toContain("shares_non_numeric");
  });

  it("SE-5: a threshold the quote does not state is flagged (prompt injection cannot set it)", () => {
    const r = applyReview([aiRuleToRule({ ...base, approvalThresholdDollars: "0" }, demoPages, "ai")])[0];
    expect(r.issues).toContain("value_not_in_quote");
    expect(r.reviewState).toBe("NEEDS_REVIEW");
  });

  it("AI quotes on the wrong page are a warning in AI mode", () => {
    const r = aiRuleToRule({ ...base, page: 2 }, demoPages, "ai");
    expect(r.quoteMatch).toBe("exact_other_page");
    expect(r.page).toBe(4);
    expect(r.issues).toContain("quote_other_page");
  });

  it("AG-7: two clauses with different terms for the same category conflict", () => {
    const a = aiRuleToRule(base, demoPages, "ai");
    const b = aiRuleToRule({ ...demoAi.rules.find((r) => r.category === "school_supplies")!, category: "extracurricular" }, demoPages, "ai");
    const out = applyReview(mergeDuplicates([a, b]));
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.issues?.includes("conflict") && r.reviewState === "NEEDS_REVIEW")).toBe(true);
    // Rejecting one resolves the other.
    const resolved = applyReview(out.map((r, i) => (i === 1 ? { ...r, reviewState: "REJECTED" as const } : r)));
    expect(resolved[0].reviewState).toBe("PENDING");
    expect(resolved[0].issues).not.toContain("conflict");
  });
});

describe("draftProblems", () => {
  const r = (state: Rule["reviewState"]): Rule => ({ id: state, category: "medical", label: "x", owedPct: 50, quote: "q", page: 1, quoteMatch: "exact", reviewState: state });
  it("needs every rule decided and at least one kept", () => {
    expect(draftProblems([r("CONFIRMED"), r("PENDING")])).toMatch(/1 left/);
    expect(draftProblems([r("REJECTED")])).toMatch(/at least one/);
    expect(draftProblems([r("CONFIRMED"), r("EDITED"), r("REJECTED")])).toBeNull();
  });
});
