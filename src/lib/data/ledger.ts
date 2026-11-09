import "server-only";
import { actorOf, type FamilyContext } from "@/lib/auth/session";
import { DAY_MS, now } from "@/lib/clock";
import { claimTotals, CLOSED_CLAIMS, OUTSTANDING, type ClaimTotals } from "@/lib/data/dashboard";
import { isoFromTs } from "@/lib/expense-view";
import { expensesCol, loadRuleVersion } from "@/lib/expenses";
import { sumCents } from "@/lib/money";
import { party } from "@/lib/parties";
import { effectiveApprovalState, isDueSoon, isOverdue, toMs } from "@/lib/state/effective";
import type { ApprovalState, ExpenseDoc, Role, SettlementState, VerdictCode } from "@/types/firestore";

// GET /api/ledger (Section K.3, K.6). Rows carry display-ready derived fields (overdue, days
// overdue, clause snippet, owed) so the grid never computes money or status. Totals: outstanding
// and overdue come from Firestore aggregation (the same numbers as the dashboard, invariant 10);
// the page total is the sum of the listed rows' amounts.

export type LedgerFilter = "all" | "outstanding" | "overdue" | "closed" | "owed_to_me" | "i_owe";

export type LedgerRow = {
  id: string;
  date: string | null;
  month: string | null;
  childId: string;
  childName: string;
  description: string;
  vendor: string | null;
  category: string;
  clause: { label: string; quote: string; page: number; agreementId: string | null } | null;
  verdict: VerdictCode;
  approval: ApprovalState;
  settlement: SettlementState;
  isOverdue: boolean;
  daysOverdue: number;
  dueSoon: boolean;
  totalCents: number;
  owedCents: number;
  owedByRole: Role;
  owedByName: string;
  owedToMe: boolean;
  dueAt: string | null;
  canRemind: boolean;
};

export type LedgerView = {
  rows: LedgerRow[];
  totals: { listedTotalCents: number; listedOwedCents: number; claims: ClaimTotals };
  children: { id: string; name: string }[];
  me: Role;
  timeZone: string | null;
};

const SNIPPET = 90;
const REMINDABLE: ReadonlySet<SettlementState> = new Set(["AWAITING_PAYMENT", "PAYMENT_FAILED"]);

export async function getLedger(ctx: FamilyContext, filter: LedgerFilter = "all"): Promise<LedgerView> {
  const at = now();
  const me = actorOf(ctx).kind;
  const [snap, claims] = await Promise.all([expensesCol().where("familyId", "==", ctx.familyId).limit(1000).get(), claimTotals(ctx)]);
  const rvIds = [...new Set(snap.docs.map((d) => (d.data() as ExpenseDoc).ruleVersionId).filter(Boolean))];
  const versions = new Map((await Promise.all(rvIds.map(async (id) => [id, await loadRuleVersion(id)] as const))).filter(([, v]) => v));

  const rows: LedgerRow[] = [];
  for (const d of snap.docs) {
    const e = d.data() as ExpenseDoc;
    if (e.settlement.state === "CANCELLED") continue;
    const rule = versions.get(e.ruleVersionId)?.rules.find((r) => r.id === e.verdict.ruleId) ?? null;
    const date = isoFromTs(e.mode === "purchased" ? e.purchaseDate : e.plannedDate) ?? e.createdAt.toDate().toISOString();
    const overdue = isOverdue(e.settlement, at);
    const due = toMs(e.settlement.dueAt);
    const quote = rule?.quote ?? e.verdict.citations[0]?.quote ?? null;
    rows.push({
      id: d.id,
      date,
      month: date ? date.slice(0, 7) : null,
      childId: e.childId,
      childName: ctx.family.children.find((c) => c.id === e.childId)?.firstName ?? "Removed child",
      description: e.description,
      vendor: e.vendor ?? null,
      category: e.category,
      clause: quote ? { label: rule?.label ?? "Clause", quote: quote.length > SNIPPET ? `${quote.slice(0, SNIPPET - 1).trimEnd()}…` : quote, page: rule?.page ?? e.verdict.citations[0]?.page ?? 0, agreementId: versions.get(e.ruleVersionId)?.agreementId ?? null } : null,
      verdict: e.verdict.code,
      approval: effectiveApprovalState(e.approval, at),
      settlement: e.settlement.state,
      isOverdue: overdue,
      daysOverdue: overdue && due != null ? Math.floor((at.getTime() - due) / DAY_MS) + 1 : 0,
      dueSoon: isDueSoon(e.settlement, at),
      totalCents: e.amountCents,
      owedCents: e.settlement.owedCents ?? e.verdict.owedShareCents,
      owedByRole: e.owedByRole,
      owedByName: party(ctx.family, e.owedByRole).firstName,
      owedToMe: e.paidByRole === me,
      dueAt: e.settlement.dueAt ? e.settlement.dueAt.toDate().toISOString() : null,
      canRemind: e.paidByRole === me && REMINDABLE.has(e.settlement.state),
    });
  }

  const filtered = rows.filter((r) => {
    switch (filter) {
      case "outstanding":
        return OUTSTANDING.includes(r.settlement);
      case "overdue":
        return r.isOverdue;
      case "closed":
        return CLOSED_CLAIMS.includes(r.settlement);
      case "owed_to_me":
        return r.owedToMe;
      case "i_owe":
        return !r.owedToMe;
      default:
        return true;
    }
  });
  filtered.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return {
    rows: filtered,
    totals: { listedTotalCents: sumCents(filtered.map((r) => r.totalCents)), listedOwedCents: sumCents(filtered.map((r) => r.owedCents)), claims },
    children: ctx.family.children.map((c) => ({ id: c.id, name: c.firstName })),
    me,
    timeZone: ctx.userDoc.timeZone || null,
  };
}
