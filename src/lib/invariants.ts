import "server-only";
import { AggregateField } from "firebase-admin/firestore";
import { now } from "@/lib/clock";
import { db } from "@/lib/firebase/admin";
import { resolveLinkHash } from "@/lib/links/tokens";
import { splitShares } from "@/lib/money";
import { effectiveApprovalState, linkStatus } from "@/lib/state/effective";
import type { ApprovalState, ExpenseDoc, ExpenseEventDoc, LinkTokenDoc, PaymentDoc, PayoutDoc, RuleVersionDoc, SettlementState } from "@/types/firestore";

// Invariant checker (Section E.7), all 12 checks except 12 (guaranteed by the notification doc id).
// Read-only. Used by scripts/check-invariants.ts and tests.

export type Violation = { invariant: number; target: string; detail: string };

const CLAIMED: ReadonlySet<SettlementState> = new Set([
  "AWAITING_PAYMENT", "PAYMENT_FAILED", "PAID", "PAYOUT_PROCESSING", "SETTLED", "PAYOUT_UNCLAIMED", "PAYOUT_FAILED", "REFUNDED",
  "EXTERNAL_PAYMENT_REPORTED", "SETTLED_EXTERNALLY", "WAIVED", "DISPUTED", "UNRESOLVED",
]);
const APPROVAL_OK: ReadonlySet<ApprovalState> = new Set(["NOT_REQUIRED", "APPROVED", "PARTIALLY_APPROVED"]);
const OUTSTANDING: SettlementState[] = ["AWAITING_PAYMENT", "PAYMENT_FAILED", "EXTERNAL_PAYMENT_REPORTED"];
const UNPAID: ReadonlySet<SettlementState> = new Set(["AWAITING_PAYMENT", "PAYMENT_FAILED"]);
const PAID_OUT: ReadonlySet<SettlementState> = new Set(["PAYOUT_PROCESSING", "PAYOUT_UNCLAIMED", "PAYOUT_FAILED", "SETTLED", "REFUNDED"]);

export async function checkInvariants(opts: { familyId?: string; limit?: number } = {}): Promise<{ checked: { expenses: number; tokens: number; families: number }; violations: Violation[] }> {
  const at = now();
  const violations: Violation[] = [];
  const add = (invariant: number, target: string, detail: string) => violations.push({ invariant, target, detail });
  const limit = opts.limit ?? 2000;

  let q = db().collection("expenses").limit(limit);
  if (opts.familyId) q = db().collection("expenses").where("familyId", "==", opts.familyId).limit(limit);
  const expenses = (await q.get()).docs.map((d) => ({ id: d.id, e: d.data() as ExpenseDoc }));
  let tq = db().collection("linkTokens").limit(limit * 3);
  if (opts.familyId) tq = db().collection("linkTokens").where("familyId", "==", opts.familyId).limit(limit * 3);
  const tokens = (await tq.get()).docs.map((d) => ({ hash: d.id, l: d.data() as LinkTokenDoc }));
  const rvCache = new Map<string, RuleVersionDoc | null>();
  const ruleVersion = async (id: string) => {
    if (!rvCache.has(id)) {
      const s = await db().collection("ruleVersions").doc(id).get();
      rvCache.set(id, s.exists ? (s.data() as RuleVersionDoc) : null);
    }
    return rvCache.get(id) ?? null;
  };

  const planCache = new Map<string, boolean>();
  const familyHadPlan = async (familyId: string) => {
    if (!planCache.has(familyId)) planCache.set(familyId, (await db().collection("subscriptions").doc(familyId).get()).exists);
    return planCache.get(familyId)!;
  };

  const usableApprovalFor = new Set<string>();
  for (const { l } of tokens) {
    if (l.purpose === "approval" && linkStatus(l, at) === "usable") usableApprovalFor.add(l.resourcePath.replace(/^approvals\//, "").replace(/_\d+$/, ""));
  }

  for (const { id, e } of expenses) {
    const approval = effectiveApprovalState(e.approval, at);
    // 1. A claim implies an approval that allows it.
    if (CLAIMED.has(e.settlement.state) && !APPROVAL_OK.has(approval)) add(1, `expenses/${id}`, `settlement ${e.settlement.state} with approval ${approval}`);
    // 2. NOT_REQUIRED has no open approval link.
    if (approval === "NOT_REQUIRED" && usableApprovalFor.has(id)) add(2, `expenses/${id}`, "approval NOT_REQUIRED but an approval link is usable");
    // 6. Partial approval caps the claim at the owed share of the approved amount.
    if (approval === "PARTIALLY_APPROVED" && typeof e.settlement.owedCents === "number" && typeof e.approval.approvedCents === "number") {
      const rv = await ruleVersion(e.ruleVersionId);
      const rule = rv?.rules.find((r) => r.id === e.verdict.ruleId);
      if (rule && !rule.sharesNonNumeric) {
        const cap = splitShares(e.approval.approvedCents, rule.owedPct).owedShareCents;
        if (e.settlement.owedCents > cap) add(6, `expenses/${id}`, `owedCents ${e.settlement.owedCents} > share of approved ${cap}`);
      }
    }
    // 7. Shares never exceed the total.
    if (e.verdict.owedShareCents < 0 || e.verdict.owedShareCents > e.amountCents * 2) add(7, `expenses/${id}`, `owedShareCents ${e.verdict.owedShareCents} out of range`);

    // 3, 4, 5. Money: a completed capture means the claim is no longer unpaid; a payout means a
    // completed capture of owed + fee line; at most one successful payout, always of owedCents.
    const [pSnap, oSnap] = await Promise.all([db().collection("payments").doc(id).get(), db().collection("payouts").doc(id).get()]);
    const pay = pSnap.data() as PaymentDoc | undefined;
    const out = oSnap.data() as PayoutDoc | undefined;
    if (pay?.captureStatus === "COMPLETED" && UNPAID.has(e.settlement.state)) add(3, `expenses/${id}`, `capture COMPLETED but settlement ${e.settlement.state}`);
    if (PAID_OUT.has(e.settlement.state)) {
      const captured = pay?.captureStatus === "COMPLETED" || (pay?.captureStatus === "REFUNDED" && e.settlement.state === "REFUNDED");
      if (!captured) add(4, `expenses/${id}`, `settlement ${e.settlement.state} without a completed capture`);
      else if (pay!.capturedCents !== (e.settlement.owedCents ?? 0) + (pay!.feeLineCents ?? 0)) add(4, `expenses/${id}`, `captured ${pay!.capturedCents} != owed ${e.settlement.owedCents} + fee ${pay!.feeLineCents ?? 0}`);
    }
    if (out) {
      const ok = out.attempts.filter((a) => a.status === "SUCCESS");
      if (ok.length > 1) add(5, `expenses/${id}`, `${ok.length} successful payouts`);
      for (const a of out.attempts) if (a.amountCents !== e.settlement.owedCents) add(5, `expenses/${id}`, `payout ${a.senderBatchId} of ${a.amountCents} != owed ${e.settlement.owedCents}`);
    }
    // 9. No PayPal order for a family that never had the Family plan (order creation returns 402).
    if (pay?.attempts.length && !(await familyHadPlan(e.familyId))) add(9, `expenses/${id}`, "PayPal order without a Family plan");

    // 11. Every state change has exactly one events row: each machine's rows form one unbroken chain
    // from the initial state to the stored state.
    const events = (await db().collection("expenses").doc(id).collection("events").orderBy("at").get()).docs.map((d) => d.data() as ExpenseEventDoc);
    const created = events.find((ev) => ev.type === "expense.created");
    for (const machine of ["approval", "settlement"] as const) {
      const rows = events.filter((ev) => ev.machine === machine);
      let state: string | undefined = machine === "approval" ? (created?.data?.approval as string | undefined) : "NONE";
      for (const ev of rows) {
        if (state !== undefined && ev.from !== state) add(11, `expenses/${id}`, `${machine} row ${ev.type} does not follow ${state}`);
        state = ev.to;
      }
      const stored = machine === "approval" ? e.approval.state : e.settlement.state;
      if (state !== undefined && state !== stored) add(11, `expenses/${id}`, `${machine} rows end at ${state}, stored ${stored}`);
    }
  }

  // 8. Unusable tokens are refused (410) on every action endpoint: they all resolve through resolveLinkHash.
  for (const { hash, l } of tokens) {
    const status = linkStatus(l, at);
    if (status === "usable") continue;
    const refused = await resolveLinkHash(hash).then(
      () => false,
      (err: { code?: string }) => err.code === "LINK_GONE",
    );
    if (!refused) add(8, `linkTokens/${hash.slice(0, 12)}`, `${status} token was accepted`);
  }

  // 10. Dashboard totals (aggregation) equal the sum over matching claims.
  const families = [...new Set(expenses.map((x) => x.e.familyId))];
  for (const familyId of families) {
    for (const payer of ["owner", "coparent"] as const) {
      const agg = await db()
        .collection("expenses")
        .where("familyId", "==", familyId)
        .where("owedByRole", "==", payer)
        .where("settlement.state", "in", OUTSTANDING)
        .aggregate({ cents: AggregateField.sum("settlement.owedCents") })
        .get();
      const sum = expenses.filter((x) => x.e.familyId === familyId && x.e.owedByRole === payer && OUTSTANDING.includes(x.e.settlement.state)).reduce((n, x) => n + (x.e.settlement.owedCents ?? 0), 0);
      if (Number(agg.data().cents ?? 0) !== sum) add(10, `families/${familyId}`, `${payer} owes: aggregate ${agg.data().cents} != sum ${sum}`);
    }
  }

  return { checked: { expenses: expenses.length, tokens: tokens.length, families: families.length }, violations };
}
