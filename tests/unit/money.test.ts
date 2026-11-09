import { describe, expect, it } from "vitest";
import { centsToDecimalString, decimalStringToCents, formatCents, parseDollarsToCents, splitShares, sumCents } from "@/lib/money";

describe("formatCents", () => {
  it("formats exact cents in USD", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(35_000)).toBe("$350.00");
    expect(formatCents(123_456_789)).toBe("$1,234,567.89");
    expect(formatCents(-1999)).toBe("-$19.99");
  });
  it("refuses floats", () => {
    expect(() => formatCents(1.5)).toThrow(RangeError);
  });
});

describe("parseDollarsToCents", () => {
  it("parses without floating point", () => {
    expect(parseDollarsToCents("350")).toBe(35_000);
    expect(parseDollarsToCents("350.5")).toBe(35_050);
    expect(parseDollarsToCents("$1,200.07")).toBe(120_007);
    expect(parseDollarsToCents("0.29")).toBe(29); // 0.29 * 100 = 28.999... in floats
    expect(parseDollarsToCents("19.99")).toBe(1999);
  });
  it("rejects bad input", () => {
    for (const bad of ["", "abc", "1.234", "-5", "1e3", "12.3.4"]) expect(parseDollarsToCents(bad)).toBeNull();
  });
});

describe("PayPal decimal strings", () => {
  it("round-trips", () => {
    for (const c of [0, 1, 99, 100, 14_460, 1_234_567]) expect(decimalStringToCents(centsToDecimalString(c))).toBe(c);
    expect(centsToDecimalString(14_460)).toBe("144.60");
    expect(decimalStringToCents("144.6")).toBe(14_460);
  });
});

describe("splitShares (invariant 7: shares sum exactly to the total)", () => {
  it("splits common percentages", () => {
    expect(splitShares(35_000, 50)).toEqual({ owedShareCents: 17_500, otherShareCents: 17_500 });
    expect(splitShares(10_001, 50)).toEqual({ owedShareCents: 5_001, otherShareCents: 5_000 });
    expect(splitShares(100, 33.33)).toEqual({ owedShareCents: 33, otherShareCents: 67 });
    expect(splitShares(28_000, 62.5)).toEqual({ owedShareCents: 17_500, otherShareCents: 10_500 });
    expect(splitShares(999, 0)).toEqual({ owedShareCents: 0, otherShareCents: 999 });
    expect(splitShares(999, 100)).toEqual({ owedShareCents: 999, otherShareCents: 0 });
  });
  it("always sums to the total", () => {
    for (let amount = 1; amount < 5000; amount += 7) {
      for (const pct of [1, 10, 33.33, 40, 50, 60, 66.67, 70, 99]) {
        const s = splitShares(amount, pct);
        expect(s.owedShareCents + s.otherShareCents).toBe(amount);
        expect(Number.isInteger(s.owedShareCents)).toBe(true);
      }
    }
  });
  it("rejects invalid input", () => {
    expect(() => splitShares(100.5, 50)).toThrow();
    expect(() => splitShares(100, 101)).toThrow();
    expect(() => splitShares(100, -1)).toThrow();
  });
  it("sumCents", () => {
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(() => sumCents([1, 0.5])).toThrow();
  });
});
