import { describe, expect, it } from "vitest";
import { EngineValidationError, evaluate, meetsThreshold, type EngineInput, type EngineRuleVersion } from "@/lib/rules-engine";
import type { Rule } from "@/types/firestore";

const NOW = new Date("2026-11-09T12:00:00Z");
const mia = { id: "childMia01", firstName: "Mia" };
const leo = { id: "childLeo01", firstName: "Leo" };

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: "r_extra",
    category: "extracurricular",
    label: "Extracurricular activities",
    owedPct: 40,
    approval: { required: true, operator: "gt", thresholdCents: 20000 },
    receiptDeadlineDays: 30,
    quote: "any single extracurricular expense above $200 requires the Other Parent's written approval",
    page: 4,
    quoteMatch: "exact",
    reviewState: "CONFIRMED",
    ...over,
  };
}

function rv(rules: Rule[], ack?: Record<string, "agree" | "disagree">): EngineRuleVersion {
  return { id: "rv1", rules, coParentAck: ack ? { perRule: ack } : null };
}

function input(over: Partial<EngineInput> = {}): EngineInput {
  return { category: "extracurricular", child: mia, amountCents: 35000, currency: "USD", mode: "planned", ...over };
}

describe("evaluate", () => {
  it("demo: $350 soccer camp needs approval citing p. 4, share $140", () => {
    const r = evaluate(input(), rv([rule()]), NOW);
    expect(r.verdict).toBe("NEEDS_APPROVAL");
    expect(r.citations).toEqual([{ quote: rule().quote, page: 4 }]);
    expect(r.explanation).toContain("above $200.00");
    expect(r.explanation).toContain("p. 4");
    expect(r.shares.owedShareCents).toBe(14000);
    expect(r.shares.otherShareCents).toBe(21000);
  });

  it("demo: $120 dentist is eligible", () => {
    const dental = rule({ id: "r_dent", category: "dental", owedPct: 50, approval: undefined, page: 3 });
    const r = evaluate(input({ category: "dental", amountCents: 12000 }), rv([dental]), NOW);
    expect(r.verdict).toBe("ELIGIBLE");
    expect(r.shares.owedShareCents).toBe(6000);
    expect(r.approval.required).toBe(false);
  });

  it("PF-1: gt threshold: $199.99 / $200.00 / $200.01", () => {
    const v = (c: number) => evaluate(input({ amountCents: c }), rv([rule()]), NOW).verdict;
    expect([v(19999), v(20000), v(20001)]).toEqual(["ELIGIBLE", "ELIGIBLE", "NEEDS_APPROVAL"]);
  });

  it("PF-2: gte threshold: $199.99 / $200.00 / $200.01", () => {
    const r = rv([rule({ approval: { required: true, operator: "gte", thresholdCents: 20000 } })]);
    const v = (c: number) => evaluate(input({ amountCents: c }), r, NOW).verdict;
    expect([v(19999), v(20000), v(20001)]).toEqual(["ELIGIBLE", "NEEDS_APPROVAL", "NEEDS_APPROVAL"]);
  });

  it("PF-3: split $100.01 at 60/40 gives 6001 + 4000 cents", () => {
    const r = evaluate(input({ amountCents: 10001 }), rv([rule({ owedPct: 60, approval: undefined })]), NOW);
    expect(r.shares.owedShareCents).toBe(6001);
    expect(r.shares.otherShareCents).toBe(4000);
  });

  it("invariant 7: shares always sum to the total", () => {
    for (const pct of [0, 33.33, 40, 50, 62.5, 100]) {
      for (const c of [1, 99, 10001, 33333, 9_999_999]) {
        const r = evaluate(input({ amountCents: c }), rv([rule({ owedPct: pct, approval: undefined })]), NOW);
        expect(r.shares.owedShareCents + r.shares.otherShareCents).toBe(c);
      }
    }
  });

  it("PF-4: a category without a rule is NOT_COVERED", () => {
    const r = evaluate(input({ category: "travel" }), rv([rule()]), NOW);
    expect(r.verdict).toBe("NOT_COVERED");
    expect(r.citations).toEqual([]);
    expect(r.shares.owedShareCents).toBe(0);
  });

  it("no rule version at all is NOT_COVERED", () => {
    expect(evaluate(input(), null, NOW).verdict).toBe("NOT_COVERED");
  });

  it("rejected rules never apply", () => {
    expect(evaluate(input(), rv([rule({ reviewState: "REJECTED" })]), NOW).verdict).toBe("NOT_COVERED");
  });

  it("PF-5: a child-specific rule for another child is not applied", () => {
    const leoOnly = rule({ childNames: ["Leo"] });
    expect(evaluate(input(), rv([leoOnly]), NOW).verdict).toBe("NOT_COVERED");
    expect(evaluate(input({ child: leo }), rv([leoOnly]), NOW).verdict).toBe("NEEDS_APPROVAL");
    expect(evaluate(input({ child: leo }), rv([rule({ childIds: [mia.id] })]), NOW).verdict).toBe("NOT_COVERED");
  });

  it("a child-specific rule wins over the general rule for that child", () => {
    const general = rule({ id: "g" });
    const miaRule = rule({ id: "m", childNames: ["mia"], approval: undefined, owedPct: 50 });
    const r = evaluate(input(), rv([general, miaRule]), NOW);
    expect(r.verdict).toBe("ELIGIBLE");
    expect(r.ruleId).toBe("m");
  });

  it("PF-6: amount 0, negative, over $100,000, fractional cents and non-USD are validation errors", () => {
    for (const bad of [0, -100, 10_000_001, 12.5]) {
      expect(() => evaluate(input({ amountCents: bad }), rv([rule()]), NOW)).toThrow(EngineValidationError);
    }
    expect(() => evaluate(input({ currency: "EUR" }), rv([rule()]), NOW)).toThrow(/USD/);
    expect(evaluate(input({ amountCents: 10_000_000 }), rv([rule()]), NOW).verdict).toBe("NEEDS_APPROVAL");
  });

  it("an unconfirmed rule gives NEEDS_REVIEW", () => {
    expect(evaluate(input(), rv([rule({ reviewState: "NEEDS_REVIEW" })]), NOW).verdict).toBe("NEEDS_REVIEW");
  });

  it("AG-7: conflicting matched rules give NEEDS_REVIEW citing both", () => {
    const r = evaluate(input(), rv([rule({ id: "a" }), rule({ id: "b", owedPct: 50, page: 6 })]), NOW);
    expect(r.verdict).toBe("NEEDS_REVIEW");
    expect(r.citations.map((c) => c.page)).toEqual([4, 6]);
  });

  it("AG-12: the co-parent disagreed with the rule gives NEEDS_REVIEW", () => {
    const r = evaluate(input({ amountCents: 5000 }), rv([rule()], { r_extra: "disagree" }), NOW);
    expect(r.verdict).toBe("NEEDS_REVIEW");
    expect(r.ruleId).toBe("r_extra");
    expect(evaluate(input({ amountCents: 5000 }), rv([rule()], { r_extra: "agree" }), NOW).verdict).toBe("ELIGIBLE");
  });

  it("LATE when the receipt comes after the deadline, citing the deadline quote", () => {
    const r = evaluate(
      input({ amountCents: 5000, mode: "purchased", purchaseDate: new Date("2026-09-01T12:00:00Z"), receiptSubmittedAt: new Date("2026-10-15T12:00:00Z") }),
      rv([rule({ supportingQuotes: [{ field: "receiptDeadlineDays", quote: "receipt within thirty (30) days", page: 2, quoteMatch: "exact" }] })]),
      NOW,
    );
    expect(r.verdict).toBe("LATE");
    expect(r.approval.required).toBe(true);
    expect(r.citations.map((c) => c.page)).toEqual([4, 2]);
  });

  it("receipt on time is not LATE", () => {
    const r = evaluate(input({ amountCents: 5000, mode: "purchased", purchaseDate: new Date("2026-10-01T12:00:00Z"), receiptSubmittedAt: new Date("2026-10-15T12:00:00Z") }), rv([rule()]), NOW);
    expect(r.verdict).toBe("ELIGIBLE");
  });

  it("purchased first: approval was required before purchase", () => {
    const r = evaluate(input({ mode: "purchased" }), rv([rule()]), NOW);
    expect(r.verdict).toBe("NEEDS_APPROVAL");
    expect(r.explanation).toMatch(/^Approval was required before purchase/);
  });

  it("MISSING_EVIDENCE at claim time without a receipt", () => {
    expect(evaluate(input({ amountCents: 5000, stage: "claim", hasReceipt: false }), rv([rule()]), NOW).verdict).toBe("MISSING_EVIDENCE");
    expect(evaluate(input({ amountCents: 5000, stage: "claim", hasReceipt: true }), rv([rule()]), NOW).verdict).toBe("ELIGIBLE");
  });

  it("partial approval: shares on min(receipt total, approved)", () => {
    const r = evaluate(input({ amountCents: 35000, approvedCents: 30000, receiptTotalCents: 32000 }), rv([rule()]), NOW);
    expect(r.shares.basisCents).toBe(30000);
    expect(r.shares.owedShareCents).toBe(12000);
  });

  it("an approval clause without an amount means every expense needs approval", () => {
    const always = rule({ approval: { required: true, operator: "gte", thresholdCents: 0 } });
    expect(evaluate(input({ amountCents: 1 }), rv([always]), NOW).verdict).toBe("NEEDS_APPROVAL");
  });

  it("explanations never contain em-dashes (CLAUDE.md rule 13)", () => {
    const all = [
      evaluate(input(), rv([rule()]), NOW),
      evaluate(input({ amountCents: 100 }), rv([rule()]), NOW),
      evaluate(input({ category: "travel" }), rv([rule()]), NOW),
      evaluate(input(), rv([rule()], { r_extra: "disagree" }), NOW),
    ];
    for (const r of all) expect(r.explanation).not.toMatch(/—/);
  });
});

describe("meetsThreshold", () => {
  it("gt is strict, gte is inclusive", () => {
    expect(meetsThreshold(200, { required: true, operator: "gt", thresholdCents: 200 })).toBe(false);
    expect(meetsThreshold(200, { required: true, operator: "gte", thresholdCents: 200 })).toBe(true);
  });
});
