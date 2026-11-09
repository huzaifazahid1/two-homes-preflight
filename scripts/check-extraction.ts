// Phase 2 completion check: real Gemini extracts all seeded clauses with verified quotes in
// three consecutive runs. Uses GEMINI_API_KEY / GEMINI_MODEL from .env.local (synthetic data only).
// Run: npm run ai:check-extraction   (add --record to save the last answer as the demo-mode fixture)

import { readFileSync, writeFileSync } from "node:fs";
import { buildDraft, runExtraction } from "@/lib/ai/extract";
import { pagesFromPastedText } from "@/lib/pdf";

const EXPECTED: Record<string, { page: number; owedPct: number; thresholdCents?: number }> = {
  medical: { page: 3, owedPct: 50 },
  dental: { page: 3, owedPct: 50 },
  extracurricular: { page: 4, owedPct: 40, thresholdCents: 20000 },
  school_supplies: { page: 5, owedPct: 50 },
  clothing: { page: 5, owedPct: 50 },
};

async function main() {
  const pages = pagesFromPastedText(readFileSync("fixtures/agreement/demo-agreement.md", "utf8"));
  const runs = Number(process.env.RUNS ?? 3);
  let allOk = true;
  let last: unknown = null;
  for (let i = 1; i <= runs; i++) {
    const started = Date.now();
    const res = await runExtraction(pages, `check-${i}`);
    last = res.data;
    const { rules, parties } = buildDraft(res.data, pages, "ai");
    const problems: string[] = [];
    for (const [cat, exp] of Object.entries(EXPECTED)) {
      const r = rules.find((x) => x.category === cat);
      if (!r) {
        problems.push(`${cat}: missing`);
        continue;
      }
      if (r.quoteMatch === "none") problems.push(`${cat}: quote not verified`);
      if (r.page !== exp.page) problems.push(`${cat}: page ${r.page}, expected ${exp.page}`);
      if (r.owedPct !== exp.owedPct) problems.push(`${cat}: owedPct ${r.owedPct}, expected ${exp.owedPct}`);
      if (exp.thresholdCents !== undefined && r.approval?.thresholdCents !== exp.thresholdCents) problems.push(`${cat}: threshold ${r.approval?.thresholdCents}`);
      const blocking = (r.issues ?? []).filter((x) => ["quote_not_found", "shares_invalid", "value_not_in_quote", "conflict"].includes(x));
      if (blocking.length) problems.push(`${cat}: blocking issues ${blocking.join(",")}`);
    }
    if (!parties.children.some((c) => c.value.firstName === "Mia")) problems.push("child Mia not found");
    const ok = problems.length === 0;
    allOk &&= ok;
    console.log(`run ${i}: ${ok ? "OK" : "FAIL"} in ${Math.round((Date.now() - started) / 1000)}s, model ${res.model}, ${rules.length} rules`);
    for (const r of rules) console.log(`  ${r.category.padEnd(16)} p.${r.page} ${r.quoteMatch.padEnd(16)} ${r.owedPct}% ${r.approval ? `${r.approval.operator} ${r.approval.thresholdCents}` : ""} [${(r.issues ?? []).join(",")}]`);
    for (const p of problems) console.log(`  problem: ${p}`);
  }
  if (process.argv.includes("--record") && last) {
    writeFileSync("fixtures/ai/recorded-extraction.json", `${JSON.stringify(last, null, 2)}\n`);
    console.log("saved fixtures/ai/recorded-extraction.json");
  }
  process.exitCode = allOk ? 0 : 1;
}

main().catch((err) => {
  console.error("check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
