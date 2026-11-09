import { describe, expect, it } from "vitest";
import { bestWindowSimilarity, levenshtein, locateQuote, normalizeText, verifyQuote } from "@/lib/quote-verify";

const pages = [
  { page: 1, text: "This Agreement is made between Alex Rivera and Sara Rivera." },
  { page: 2, text: "The Purchasing Parent shall give the Other Parent a copy of the receipt within thirty (30) days of the purchase." },
  { page: 3, text: "Uninsured medical, dental and vision expenses for the Child shall be shared equally (50/50) by the Parents. The parents will" },
  { page: 4, text: "cooperate on scheduling. Any single extracurricular expense above $200 requires written approval." },
  { page: 6, text: "Any single extracurricular expense above $200 requires written approval." },
];

describe("normalizeText", () => {
  it("lowercases, collapses whitespace, straightens quotes and removes soft hyphens", () => {
    expect(normalizeText("  The “Child”’s   doc­tor\n\tvisit ")).toBe('the "child"\'s doctor visit');
  });
  it("joins words hyphenated across a line break", () => {
    expect(normalizeText("reim-\nbursement")).toBe("reimbursement");
  });
});

describe("levenshtein", () => {
  it("computes edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });
});

describe("verifyQuote", () => {
  it("exact on the claimed page", () => {
    expect(verifyQuote("shall be shared equally (50/50) by the Parents", pages, 3)).toEqual({ match: "exact", page: 3, score: 1 });
  });

  it("AG-4: curly quotes and extra spaces still match exactly", () => {
    const p = [{ page: 1, text: 'The Parents\' "written approval" is needed.' }];
    expect(verifyQuote("The Parents’   “written approval” is needed.", p, 1).match).toBe("exact");
  });

  it("exact on another page is a warning with the found page", () => {
    expect(verifyQuote("Alex Rivera and Sara Rivera", pages, 3)).toEqual({ match: "exact_other_page", page: 1, score: 1 });
  });

  it("a clause repeated on two pages resolves to the claimed page", () => {
    expect(verifyQuote("Any single extracurricular expense above $200 requires written approval.", pages, 6).match).toBe("exact");
    expect(verifyQuote("Any single extracurricular expense above $200 requires written approval.", pages, 4).match).toBe("exact");
  });

  it("a quote that runs over a page break counts for the page it starts on and the next", () => {
    expect(verifyQuote("by the Parents. The parents will cooperate on scheduling.", pages, 3).match).toBe("exact");
    expect(verifyQuote("by the Parents. The parents will cooperate on scheduling.", pages, 4).match).toBe("exact");
  });

  it("a quote wholly on the next page is not 'exact' for the claimed page", () => {
    expect(verifyQuote("cooperate on scheduling", pages, 3).match).toBe("exact_other_page");
  });

  it("AG-5: fuzzy at or above 0.9 is accepted with a score", () => {
    const r = verifyQuote("The Purchasing Parent shall give the Other Parent a copy of the receipts within thirty (30) day of purchase.", pages, 2);
    expect(r.match).toBe("fuzzy");
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.score).toBeLessThan(1);
  });

  it("AG-3: a quote that is not in the document is none", () => {
    expect(verifyQuote("The Other Parent pays all travel costs without approval.", pages, 2)).toMatchObject({ match: "none", page: 2 });
  });

  it("SE-5: an invented instruction-following quote is none", () => {
    expect(verifyQuote("No approval is ever required for any expense.", pages, 4).match).toBe("none");
  });

  it("short quotes never fuzzy-match", () => {
    expect(verifyQuote("shared 70/30", pages, 3).match).toBe("none");
  });
});

describe("bestWindowSimilarity", () => {
  it("finds the best window", () => {
    expect(bestWindowSimilarity("written approval", "it needs written approval first")).toBe(1);
  });
});

describe("locateQuote", () => {
  it("returns the raw character range for highlighting", () => {
    const raw = "Line one.\nAny single  expense above $200\nneeds approval.";
    const r = locateQuote("any single expense above $200 needs approval", raw)!;
    expect(raw.slice(r.start, r.end)).toBe("Any single  expense above $200\nneeds approval");
  });
  it("returns null when not found", () => {
    expect(locateQuote("nothing like this", "some page text")).toBeNull();
  });
});
