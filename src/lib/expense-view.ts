import { effectiveApprovalState } from "@/lib/state/effective";
import type { ExpenseDoc, ExpenseEventDoc, FamilyDoc, Rule, Ts } from "@/types/firestore";

// Client-safe views of expenses and their timeline (ISO strings, no internal fields).

/** Calendar dates are stored at 12:00 UTC of that day and shown as that day (docs/decisions.md 2.x). */
export function dateFromIso(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}
export function isoFromTs(t: Ts | undefined | null): string | null {
  return t ? t.toDate().toISOString().slice(0, 10) : null;
}

export function expenseView(id: string, e: ExpenseDoc, family: FamilyDoc, now: Date, rule?: Rule | null) {
  const child = family.children.find((c) => c.id === e.childId);
  return {
    id,
    childId: e.childId,
    childName: child?.firstName ?? "Removed child",
    category: e.category,
    description: e.description,
    vendor: e.vendor ?? null,
    amountCents: e.amountCents,
    currency: e.currency,
    mode: e.mode,
    date: isoFromTs(e.mode === "purchased" ? e.purchaseDate : e.plannedDate),
    paidByRole: e.paidByRole,
    owedByRole: e.owedByRole,
    ruleVersionId: e.ruleVersionId,
    verdict: {
      code: e.verdict.code,
      ruleId: e.verdict.ruleId ?? null,
      citations: e.verdict.citations,
      explanation: e.verdict.explanation,
      owedShareCents: e.verdict.owedShareCents,
    },
    rule: rule ? { id: rule.id, label: rule.label, owedPct: rule.owedPct, page: rule.page, quoteMatch: rule.quoteMatch, approval: rule.approval ?? null } : null,
    approval: { state: effectiveApprovalState(e.approval, now), approvedCents: e.approval.approvedCents ?? null },
    settlement: { state: e.settlement.state },
    purchasedBeforeApproval: e.purchasedBeforeApproval,
    possibleDuplicateOf: e.possibleDuplicateOf ?? null,
    version: e.version,
    createdAt: e.createdAt.toDate().toISOString(),
    updatedAt: e.updatedAt.toDate().toISOString(),
  };
}
export type ExpenseView = ReturnType<typeof expenseView>;

const SAFE_DATA_KEYS = new Set(["event", "approvedCents", "newAmountCents", "owedCents", "changed", "amountCents", "noop", "derived", "from", "to", "reason"]);

export function eventView(id: string, ev: ExpenseEventDoc) {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev.data ?? {})) if (SAFE_DATA_KEYS.has(k)) data[k] = v;
  return { id, type: ev.type, machine: ev.machine, from: ev.from ?? null, to: ev.to ?? null, actor: ev.actor.kind, data, at: ev.at.toDate().toISOString() };
}
export type ExpenseEventView = ReturnType<typeof eventView>;
