import "server-only";
import { AggregateField } from "firebase-admin/firestore";
import { actorOf, type FamilyContext } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { expensesCol } from "@/lib/expenses";
import { expenseView, type ExpenseView } from "@/lib/expense-view";
import { Timestamp } from "@/lib/firebase/admin";
import { nextAction, type NextAction } from "@/lib/next-action";
import { otherRole } from "@/lib/parties";
import type { ExpenseDoc, Role, SettlementState } from "@/types/firestore";

// Home dashboard and Money tab (Section A.6.4). Totals come from server aggregation queries on
// every load, never from stored counters or listener data (invariant 10).

/** Still owed: a payer's report stays outstanding until the owed parent confirms it (CL-6). */
export const OUTSTANDING: SettlementState[] = ["AWAITING_PAYMENT", "PAYMENT_FAILED", "EXTERNAL_PAYMENT_REPORTED"];
export const OVERDUE_STATES: SettlementState[] = ["AWAITING_PAYMENT", "PAYMENT_FAILED"];
export const CLOSED_CLAIMS: SettlementState[] = ["PAID", "PAYOUT_PROCESSING", "PAYOUT_UNCLAIMED", "PAYOUT_FAILED", "SETTLED", "SETTLED_EXTERNALLY", "WAIVED", "UNRESOLVED", "REFUNDED"];
export const CLAIM_STATES: SettlementState[] = [...OUTSTANDING, "DISPUTED", ...CLOSED_CLAIMS];

export type Total = { cents: number; count: number };

async function total(familyId: string, payerRole: Role, opts: { overdue: boolean }): Promise<Total> {
  let q = expensesCol().where("familyId", "==", familyId).where("owedByRole", "==", payerRole).where("settlement.state", "in", opts.overdue ? OVERDUE_STATES : OUTSTANDING);
  if (opts.overdue) q = q.where("settlement.dueAt", "<", Timestamp.fromDate(now()));
  const snap = await q.aggregate({ cents: AggregateField.sum("settlement.owedCents"), count: AggregateField.count() }).get();
  const d = snap.data();
  return { cents: Number(d.cents ?? 0), count: Number(d.count ?? 0) };
}

export async function claimTotals(ctx: FamilyContext) {
  const me = actorOf(ctx).kind;
  const them = otherRole(me);
  const [owedToYou, youOwe, overdueToYou, overdueYouOwe] = await Promise.all([
    total(ctx.familyId, them, { overdue: false }),
    total(ctx.familyId, me, { overdue: false }),
    total(ctx.familyId, them, { overdue: true }),
    total(ctx.familyId, me, { overdue: true }),
  ]);
  return { owedToYou, youOwe, overdueToYou, overdueYouOwe };
}
export type ClaimTotals = Awaited<ReturnType<typeof claimTotals>>;

function todayIso() {
  return now().toISOString().slice(0, 10);
}

/** Every claim of the family (sent payment requests), newest due date first for open ones. */
export async function listClaims(ctx: FamilyContext): Promise<ExpenseView[]> {
  const snaps = await expensesCol().where("familyId", "==", ctx.familyId).where("settlement.state", "in", CLAIM_STATES).limit(200).get();
  const at = now();
  return snaps.docs
    .map((d) => expenseView(d.id, d.data() as ExpenseDoc, ctx.family, at))
    .sort((a, b) => (a.settlement.dueAt ?? a.updatedAt).localeCompare(b.settlement.dueAt ?? b.updatedAt));
}

export type ActionItem = { expense: ExpenseView; action: NextAction };

/** GET /api/dashboard: totals + "needs your action" (open claims plus the 50 most recent expenses). */
export async function dashboard(ctx: FamilyContext) {
  const me = actorOf(ctx).kind;
  const [totals, recentSnap, claims] = await Promise.all([
    claimTotals(ctx),
    expensesCol().where("familyId", "==", ctx.familyId).orderBy("updatedAt", "desc").limit(50).get(),
    listClaims(ctx),
  ]);
  const at = now();
  const byId = new Map<string, ExpenseView>();
  for (const d of recentSnap.docs) byId.set(d.id, expenseView(d.id, d.data() as ExpenseDoc, ctx.family, at));
  for (const c of claims) byId.set(c.id, c);
  const today = todayIso();
  const actions: ActionItem[] = [];
  for (const e of byId.values()) {
    const action = nextAction(e, me, today);
    if (action) actions.push({ expense: e, action });
  }
  actions.sort((a, b) => Number(b.action.urgent) - Number(a.action.urgent) || b.expense.updatedAt.localeCompare(a.expense.updatedAt));
  return { me, totals, actions: actions.slice(0, 20), generatedAt: at.toISOString() };
}
export type Dashboard = Awaited<ReturnType<typeof dashboard>>;
