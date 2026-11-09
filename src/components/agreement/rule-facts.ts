import { formatCents } from "@/lib/money";
import type { Rule } from "@/types/firestore";

/** Plain-language facts of a rule, for chips under the quote. */
export function ruleFacts(rule: Pick<Rule, "owedPct" | "sharesNonNumeric" | "approval" | "receiptDeadlineDays" | "reimburseWithinDays" | "childNames">): string[] {
  const out: string[] = [];
  out.push(rule.sharesNonNumeric ? "Shares not fixed" : `Other parent pays ${rule.owedPct}%`);
  if (rule.approval?.required) {
    out.push(rule.approval.thresholdCents === 0 ? "Always needs approval" : `Approval ${rule.approval.operator === "gte" ? "from" : "above"} ${formatCents(rule.approval.thresholdCents).replace(/\.00$/, "")}`);
  } else out.push("No approval needed");
  if (rule.receiptDeadlineDays) out.push(`Receipt within ${rule.receiptDeadlineDays} days`);
  if (rule.reimburseWithinDays) out.push(`Pay back within ${rule.reimburseWithinDays} days`);
  if (rule.childNames?.length) out.push(`Only for ${rule.childNames.join(", ")}`);
  return out;
}
