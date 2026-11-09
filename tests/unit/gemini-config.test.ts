import { describe, expect, it } from "vitest";
import { thinkingConfig } from "@/lib/ai/gemini";

describe("thinkingConfig", () => {
  it("uses a thinking level on Gemini 3+ and a token budget on 2.x (which reject levels)", () => {
    expect(thinkingConfig("gemini-3.8-flash", "LOW")).toEqual({ thinkingLevel: "LOW" });
    expect(thinkingConfig("gemini-2.5-flash", "LOW")).toEqual({ thinkingBudget: 1024 });
    expect(thinkingConfig("gemini-2.5-flash", "MINIMAL")).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfig("gemini-flash-latest", "MINIMAL")).toEqual({ thinkingLevel: "MINIMAL" });
  });
});
