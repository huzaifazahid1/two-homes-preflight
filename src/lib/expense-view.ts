import { effectiveApprovalState, isBefore, isDueSoon, isOverdue } from "@/lib/state/effective";

const REMIND_GAP_MS = 72 * 3_600_000;
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
    approval: {
      state: effectiveApprovalState(e.approval, now),
      approvedCents: e.approval.approvedCents ?? null,
      expiresAt: iso(e.approval.expiresAt),
      decidedAt: iso(e.approval.decidedAt),
      blockedUntil: iso(e.approval.blockedUntil),
      /** Inside the 7-day decline block (derived on the server, E.6.3). */
      blocked: isBefore(now, e.approval.blockedUntil),
      reason: e.approval.reason ?? null,
    },
    settlement: {
      state: e.settlement.state,
      owedCents: e.settlement.owedCents ?? null,
      dueAt: iso(e.settlement.dueAt),
      requestSentAt: iso(e.settlement.requestSentAt),
      overdue: isOverdue(e.settlement, now),
      dueSoon: isDueSoon(e.settlement, now),
      contestUntil: iso(e.settlement.contestUntil),
      settledAt: iso(e.settlement.settledAt),
      externalReport: e.settlement.externalReport
        ? { by: e.settlement.externalReport.by, method: e.settlement.externalReport.method, date: isoFromTs(e.settlement.externalReport.date), note: e.settlement.externalReport.note ?? null }
        : null,
      waiverReason: e.settlement.waiver?.reason ?? null,
      lastManualReminderAt: iso(lastManual(e.settlement.reminders)),
      /** When the next manual reminder is allowed (72-hour gap), or null if now. */
      nextReminderAt: nextReminder(e.settlement.reminders, now),
      contestOpen: e.settlement.state === "SETTLED_EXTERNALLY" && isBefore(now, e.settlement.contestUntil),
    },
    receiptId: e.receiptId ?? null,
    purchasedBeforeApproval: e.purchasedBeforeApproval,
    possibleDuplicateOf: e.possibleDuplicateOf ?? null,
    version: e.version,
    createdAt: e.createdAt.toDate().toISOString(),
    updatedAt: e.updatedAt.toDate().toISOString(),
  };
}
export type ExpenseView = ReturnType<typeof expenseView>;

function iso(t: Ts | undefined | null): string | null {
  return t ? t.toDate().toISOString() : null;
}

function nextReminder(reminders: ExpenseDoc["settlement"]["reminders"] | undefined, now: Date): string | null {
  const last = lastManual(reminders);
  if (!last) return null;
  const at = last.toMillis() + REMIND_GAP_MS;
  return isBefore(now, at) ? new Date(at).toISOString() : null;
}

function lastManual(reminders: ExpenseDoc["settlement"]["reminders"] | undefined): Ts | null {
  const manual = (reminders ?? []).filter((r) => r.kind === "manual");
  return manual.length ? manual.reduce((a, b) => (a.at.toMillis() >= b.at.toMillis() ? a : b)).at : null;
}

const SAFE_DATA_KEYS = new Set([
  "event", "approvedCents", "newAmountCents", "owedCents", "revisedOwedCents", "changed", "amountCents", "noop", "derived", "from", "to", "reason",
  "issues", "totalCents", "kind", "method", "dueDay",
]);

export function eventView(id: string, ev: ExpenseEventDoc) {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev.data ?? {})) if (SAFE_DATA_KEYS.has(k)) data[k] = v;
  return { id, type: ev.type, machine: ev.machine, from: ev.from ?? null, to: ev.to ?? null, actor: ev.actor.kind, data, at: ev.at.toDate().toISOString() };
}
export type ExpenseEventView = ReturnType<typeof eventView>;
