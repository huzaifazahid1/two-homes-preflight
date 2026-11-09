import "server-only";
import { audit, auditInTx } from "@/lib/audit";
import { actorOf, type FamilyContext } from "@/lib/auth/session";
import { DAY_MS, now } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { sha256Hex } from "@/lib/ids";
import { log } from "@/lib/log";
import { EngineValidationError, evaluate, type EngineResult } from "@/lib/rules-engine";
import { initialApprovalState } from "@/lib/state/machines";
import { transition } from "@/lib/state/transition";
import { findUsableTokensFor, revokeTokensInTx } from "@/lib/links/tokens";
import type { ExpenseCreate, ExpensePatch, PreflightInput } from "@/schemas";
import type { DisputeDoc, ExpenseDoc, FamilyDoc, ReceiptDoc, Role, RuleVersionDoc } from "@/types/firestore";
import { dateFromIso, eventView, expenseView, isoFromTs } from "./expense-view";

// Expenses and preflight (Section A.5.3, A.6.1). The verdict comes only from the rules engine.
// approval.state / settlement.state change only through transition() (rule 7); the initial
// states are set when the expense is created (E.6.1 "(new)" rows).

const DUPLICATE_WINDOW_MS = DAY_MS;
const PRE_RECEIPT = new Set(["NONE"]);
const RECOMPUTABLE = new Set(["NONE", "RECEIPT_SUBMITTED", "READY", "RECEIPT_ISSUE"]);

export function expensesCol() {
  return db().collection("expenses");
}

function other(role: Role): Role {
  return role === "owner" ? "coparent" : "owner";
}

export async function loadRuleVersion(id: string | undefined): Promise<(RuleVersionDoc & { id: string }) | null> {
  if (!id) return null;
  const snap = await db().collection("ruleVersions").doc(id).get();
  return snap.exists ? { ...(snap.data() as RuleVersionDoc), id: snap.id } : null;
}

type VerdictFields = Pick<ExpenseDoc, "childId" | "category" | "amountCents" | "currency" | "mode"> & { date: string | null };

/** Runs the engine. Engine validation errors become 400 (PF-6); unknown child is 400. */
export function computeVerdict(family: FamilyDoc, rv: (RuleVersionDoc & { id: string }) | null, f: VerdictFields, at: Date): EngineResult & { inputHash: string } {
  const child = family.children.find((c) => c.id === f.childId);
  if (!child) throw new AppError("INVALID", "Choose one of your children.", { details: { fields: [{ path: "body.childId", message: "Choose a child" }] } });
  try {
    const result = evaluate(
      { category: f.category, child, amountCents: f.amountCents, currency: f.currency, mode: f.mode, purchaseDate: f.mode === "purchased" && f.date ? dateFromIso(f.date) : null, stage: "preflight" },
      rv ? { id: rv.id, rules: rv.rules, coParentAck: rv.coParentAck ?? null } : null,
      at,
    );
    const inputHash = sha256Hex(JSON.stringify([rv?.id ?? null, f.childId, f.category, f.amountCents, f.currency, f.mode, f.date, rv?.coParentAck?.perRule ?? null])).slice(0, 32);
    return { ...result, inputHash };
  } catch (err) {
    if (err instanceof EngineValidationError) {
      throw new AppError("INVALID", err.message, { details: { fields: [{ path: `body.${err.field}`, message: err.message }] } });
    }
    throw err;
  }
}

function verdictDoc(r: EngineResult & { inputHash: string }, at: Date): ExpenseDoc["verdict"] {
  return {
    code: r.verdict,
    ...(r.ruleId ? { ruleId: r.ruleId } : {}),
    citations: r.citations,
    explanation: r.explanation,
    owedShareCents: r.shares.owedShareCents,
    inputHash: r.inputHash,
    computedAt: Timestamp.fromDate(at),
  };
}

function checkPurchaseDate(mode: "planned" | "purchased", date: string | null | undefined, at: Date) {
  if (mode === "purchased" && date && dateFromIso(date).getTime() > at.getTime() + DAY_MS) {
    throw new AppError("INVALID", "A purchase date cannot be in the future.", { details: { fields: [{ path: "body.date", message: "Cannot be in the future" }] } });
  }
}

function requireActiveRules(ctx: FamilyContext) {
  if (!ctx.family.activeRuleVersionId) throw new AppError("STATE_CONFLICT", "Confirm the agreement rules first, then add expenses.");
}

/** POST /api/expenses/preflight: dry run, writes nothing. */
export async function preflight(ctx: FamilyContext, input: PreflightInput) {
  requireActiveRules(ctx);
  const at = now();
  checkPurchaseDate(input.mode, input.date, at);
  const rv = await loadRuleVersion(ctx.family.activeRuleVersionId);
  const r = computeVerdict(ctx.family, rv, { ...input, date: input.date ?? null }, at);
  const rule = rv?.rules.find((x) => x.id === r.ruleId) ?? null;
  return {
    verdict: r.verdict,
    explanation: r.explanation,
    citations: r.citations,
    shares: r.shares,
    approval: r.approval,
    rule: rule ? { id: rule.id, label: rule.label, owedPct: rule.owedPct, page: rule.page, quoteMatch: rule.quoteMatch } : null,
    ruleVersionId: rv?.id ?? null,
    agreementId: rv?.agreementId ?? null,
    owedByRole: other(input.paidByRole),
  };
}
export type PreflightResult = Awaited<ReturnType<typeof preflight>>;

function normalizeDescription(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** PF-7: same child, description and amount within 24 hours. */
async function findDuplicate(familyId: string, input: Pick<ExpenseCreate, "childId" | "amountCents" | "description">, at: Date): Promise<string | null> {
  const snaps = await expensesCol().where("familyId", "==", familyId).where("childId", "==", input.childId).where("amountCents", "==", input.amountCents).limit(25).get();
  const want = normalizeDescription(input.description);
  const hit = snaps.docs.find((d) => {
    const e = d.data() as ExpenseDoc;
    return e.settlement.state !== "CANCELLED" && at.getTime() - e.createdAt.toMillis() <= DUPLICATE_WINDOW_MS && normalizeDescription(e.description) === want;
  });
  return hit?.id ?? null;
}

type Meta = { requestId?: string; ip?: string | null; userAgent?: string | null };

/** POST /api/expenses */
export async function createExpense(ctx: FamilyContext, input: ExpenseCreate, meta: Meta = {}) {
  requireActiveRules(ctx);
  const at = now();
  checkPurchaseDate(input.mode, input.date, at);
  const rv = await loadRuleVersion(ctx.family.activeRuleVersionId);
  if (!rv) throw new AppError("STATE_CONFLICT", "Confirm the agreement rules first, then add expenses.");
  const r = computeVerdict(ctx.family, rv, { ...input, date: input.date ?? null }, at);

  const duplicate = await findDuplicate(ctx.familyId, input, at);
  if (duplicate && !input.confirmDuplicate) {
    throw new AppError("DUPLICATE", "You added an expense with the same child, description and amount in the last 24 hours. Is this a different expense?", {
      details: { possibleDuplicateOf: duplicate, confirmRequired: true },
    });
  }

  const actor = actorOf(ctx);
  const approvalState = initialApprovalState(r.verdict);
  const ref = expensesCol().doc();
  const t = Timestamp.fromDate(at);
  const date = input.date ? Timestamp.fromDate(dateFromIso(input.date)) : undefined;
  const doc = {
    familyId: ctx.familyId,
    memberUids: ctx.family.memberUids,
    createdBy: ctx.user.uid,
    childId: input.childId,
    category: input.category,
    description: input.description,
    ...(input.vendor ? { vendor: input.vendor } : {}),
    amountCents: input.amountCents,
    currency: "USD" as const,
    mode: input.mode,
    ...(date ? (input.mode === "purchased" ? { purchaseDate: date } : { plannedDate: date }) : {}),
    paidByRole: input.paidByRole,
    owedByRole: other(input.paidByRole),
    ruleVersionId: rv.id,
    verdict: verdictDoc(r, at),
    approval: { state: approvalState },
    purchasedBeforeApproval: input.mode === "purchased" && approvalState === "REQUIRED",
    settlement: { state: "NONE" as const, reminders: [] },
    ...(duplicate ? { possibleDuplicateOf: duplicate } : {}),
    version: 1,
    createdAt: t,
    updatedAt: t,
  };
  await db().runTransaction(async (tx) => {
    tx.create(ref, doc);
    tx.create(ref.collection("events").doc(), {
      type: "expense.created",
      machine: "verdict",
      to: r.verdict,
      actor,
      data: { event: "CREATE", amountCents: input.amountCents, approval: approvalState, settlement: "NONE" },
      at: t,
    });
    auditInTx(tx, { familyId: ctx.familyId, actor, action: "expense.create", target: `expenses/${ref.id}`, ip: meta.ip, userAgent: meta.userAgent });
  });
  return expenseView(ref.id, doc as unknown as ExpenseDoc, ctx.family, at, rv.rules.find((x) => x.id === r.ruleId));
}

/** Loads an expense of the caller's family. 404 unknown; 403 + audit for another family (AZ-2). */
export async function loadFamilyExpense(ctx: FamilyContext, id: string, requestId?: string): Promise<ExpenseDoc> {
  const snap = await expensesCol().doc(id).get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "Expense not found.");
  const e = snap.data() as ExpenseDoc;
  if (e.familyId !== ctx.familyId) {
    await audit({ familyId: ctx.familyId, actor: actorOf(ctx), action: "forbidden.expense", target: `expenses/${id}` }, requestId);
    throw new AppError("FORBIDDEN", "You do not have access to this expense.");
  }
  return e;
}

type Change = { fields: Record<string, unknown>; verdict: ExpenseDoc["verdict"]; eventType: string; changed: string[]; from: string; to: string };

/**
 * Writes an edit or a recomputed verdict. When the new facts need an approval transition
 * (AMOUNT_RAISED, VERDICT_REQUIRES_APPROVAL), the edit is written inside that transition so
 * verdict and approval never disagree. `expectedVersion` guards against concurrent edits.
 */
async function writeChange(expenseId: string, before: ExpenseDoc, change: Change, actor: { kind: "owner" | "coparent" | "system"; uid?: string }, meta: Meta) {
  const ref = expensesCol().doc(expenseId);
  const approval = before.approval.state;
  const newAmount = (change.fields.amountCents as number | undefined) ?? before.amountCents;
  const needsApproval = change.verdict.code === "NEEDS_APPROVAL" || change.verdict.code === "LATE";
  const approvedCents = before.approval.approvedCents ?? before.amountCents;
  const event =
    (approval === "APPROVED" || approval === "PARTIALLY_APPROVED") && newAmount > approvedCents
      ? ("AMOUNT_RAISED" as const)
      : approval === "NOT_REQUIRED" && needsApproval
        ? ("VERDICT_REQUIRES_APPROVAL" as const)
        : null;

  const at = now();
  const t = Timestamp.fromDate(at);
  // The edit causes the approval change: its row sorts first (transition() stamps its row at >= `at`).
  const editAt = event ? Timestamp.fromMillis(at.getTime() - 1) : t;
  const editEvent = {
    type: change.eventType,
    machine: "verdict" as const,
    from: change.from,
    to: change.to,
    actor,
    data: { event: change.eventType === "expense.edited" ? "EDIT" : "RECOMPUTE", changed: change.changed, amountCents: newAmount },
    at: editAt,
  };
  const purchasedBeforeApproval = ((change.fields.mode as string | undefined) ?? before.mode) === "purchased" && (needsApproval || approval === "REQUIRED");

  if (!event) {
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.data() as ExpenseDoc;
      if (current.version !== before.version) throw new AppError("STATE_CONFLICT", "This expense changed while you were editing. Refresh and try again.");
      tx.update(ref, { ...change.fields, verdict: change.verdict, purchasedBeforeApproval, version: current.version + 1, updatedAt: t });
      tx.create(ref.collection("events").doc(), editEvent);
    });
    return;
  }
  await transition({
    expenseId,
    machine: "approval",
    event,
    actor,
    payload: { newAmountCents: newAmount },
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    loadFacts: async (_tx, current) => {
      if (current.version !== before.version) throw new AppError("STATE_CONFLICT", "This expense changed while you were editing. Refresh and try again.");
      return {};
    },
    extraWrites: (tx, { expenseRef, version }) => {
      tx.update(expenseRef, { ...change.fields, verdict: change.verdict, purchasedBeforeApproval, version: version + 1 });
      tx.create(expenseRef.collection("events").doc(), editEvent);
    },
  });
}

/** PATCH /api/expenses/:id. Allowed before a receipt and while no approval request is open. */
export async function patchExpense(ctx: FamilyContext, id: string, patch: ExpensePatch, meta: Meta = {}) {
  const before = await loadFamilyExpense(ctx, id, meta.requestId);
  if (before.version !== patch.version) throw new AppError("STATE_CONFLICT", "This expense changed while you were editing. Refresh and try again.");
  if (!PRE_RECEIPT.has(before.settlement.state)) throw new AppError("STATE_CONFLICT", "This expense already has a receipt or was closed, so it cannot be edited here.");
  if (before.approval.state === "REQUESTED") throw new AppError("STATE_CONFLICT", "An approval request is open. Cancel the request before changing the expense.");

  const at = now();
  const mode = patch.mode ?? before.mode;
  const prevDate = isoFromTs(before.mode === "purchased" ? before.purchaseDate : before.plannedDate);
  const date = patch.date === undefined ? prevDate : patch.date;
  checkPurchaseDate(mode, date, at);
  const merged = {
    childId: patch.childId ?? before.childId,
    category: patch.category ?? before.category,
    amountCents: patch.amountCents ?? before.amountCents,
    currency: "USD" as const,
    mode,
    date,
  };
  const rv = await loadRuleVersion(before.ruleVersionId); // amendments never re-pin old expenses
  const r = computeVerdict(ctx.family, rv, merged, at);

  const fields: Record<string, unknown> = {};
  const changed: string[] = [];
  const set = (k: string, v: unknown, old: unknown) => {
    if (v !== undefined && v !== old) {
      fields[k] = v;
      changed.push(k);
    }
  };
  set("childId", patch.childId, before.childId);
  set("category", patch.category, before.category);
  set("description", patch.description, before.description);
  set("amountCents", patch.amountCents, before.amountCents);
  set("mode", patch.mode, before.mode);
  if (patch.vendor !== undefined && (patch.vendor ?? undefined) !== before.vendor) {
    fields.vendor = patch.vendor ? patch.vendor : null;
    changed.push("vendor");
  }
  if (patch.paidByRole && patch.paidByRole !== before.paidByRole) {
    fields.paidByRole = patch.paidByRole;
    fields.owedByRole = other(patch.paidByRole);
    changed.push("paidByRole");
  }
  if (date !== prevDate || mode !== before.mode) {
    const ts = date ? Timestamp.fromDate(dateFromIso(date)) : null;
    fields.plannedDate = mode === "planned" ? ts : null;
    fields.purchaseDate = mode === "purchased" ? ts : null;
    if (date !== prevDate) changed.push("date");
  }
  if (changed.length === 0) return getExpense(ctx, id, meta.requestId);
  // null removes the field.
  for (const [k, v] of Object.entries(fields)) if (v === null) fields[k] = FieldValue.delete();

  await writeChange(id, before, { fields, verdict: verdictDoc(r, at), eventType: "expense.edited", changed, from: before.verdict.code, to: r.verdict }, actorOf(ctx), meta);
  return getExpense(ctx, id, meta.requestId);
}

/** POST /api/expenses/:id/cancel (settlement CANCEL_EXPENSE). */
export async function cancelExpense(ctx: FamilyContext, id: string, meta: Meta = {}) {
  await loadFamilyExpense(ctx, id, meta.requestId);
  // Open approval and payment links stop working in the same transaction (E.6.2 "revoke tokens").
  let stale: string[] = [];
  await transition({
    expenseId: id,
    machine: "settlement",
    event: "CANCEL_EXPENSE",
    actor: actorOf(ctx),
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    loadFacts: async (tx, current) => {
      const paths = [`expenses/${id}`, ...(current.approval.currentRequestId ? [`approvals/${current.approval.currentRequestId}`] : [])];
      stale = await findUsableTokensFor(tx, ctx.familyId, paths);
      return {};
    },
    extraWrites: (tx) => revokeTokensInTx(tx, stale),
  });
  return getExpense(ctx, id, meta.requestId);
}

/** Re-evaluates expenses pinned to a rule version after the co-parent changed an acknowledgement (AG-12). */
export async function recomputeForRules(familyId: string, ruleVersionId: string, ruleIds: string[], requestId?: string): Promise<number> {
  if (ruleIds.length === 0) return 0;
  const [familySnap, rv] = await Promise.all([db().collection("families").doc(familyId).get(), loadRuleVersion(ruleVersionId)]);
  if (!familySnap.exists || !rv) return 0;
  const family = familySnap.data() as FamilyDoc;
  const snaps = await expensesCol().where("familyId", "==", familyId).where("ruleVersionId", "==", ruleVersionId).get();
  const affectedRule = new Set(ruleIds);
  let count = 0;
  for (const d of snaps.docs) {
    const e = d.data() as ExpenseDoc;
    if (!RECOMPUTABLE.has(e.settlement.state)) continue;
    // Rules the expense matched, or would match now (category + child).
    const touches = (e.verdict.ruleId && affectedRule.has(e.verdict.ruleId)) || rv.rules.some((r) => affectedRule.has(r.id) && r.category === e.category);
    if (!touches) continue;
    const date = isoFromTs(e.mode === "purchased" ? e.purchaseDate : e.plannedDate);
    const at = now();
    const r = computeVerdict(family, rv, { childId: e.childId, category: e.category, amountCents: e.amountCents, currency: e.currency, mode: e.mode, date }, at);
    if (r.verdict === e.verdict.code && r.inputHash === e.verdict.inputHash) continue;
    try {
      await writeChange(d.id, e, { fields: {}, verdict: verdictDoc(r, at), eventType: "verdict.recomputed", changed: ["coParentAck"], from: e.verdict.code, to: r.verdict }, { kind: "system" }, { requestId });
      count++;
    } catch (err) {
      // One expense failing must not hide the others; it is logged and recomputed on its next edit.
      log.error("expense.recompute_failed", { requestId, familyId, error: err });
    }
  }
  return count;
}

/** GET /api/expenses/:id with the timeline. */
export async function getExpense(ctx: FamilyContext, id: string, requestId?: string) {
  const e = await loadFamilyExpense(ctx, id, requestId);
  const [rv, events, receiptSnap, disputeSnap] = await Promise.all([
    loadRuleVersion(e.ruleVersionId),
    expensesCol().doc(id).collection("events").orderBy("at").limit(200).get(),
    e.receiptId ? db().collection("receipts").doc(e.receiptId).get() : Promise.resolve(null),
    db().collection("disputes").doc(id).get(),
  ]);
  const rule = rv?.rules.find((r) => r.id === e.verdict.ruleId) ?? null;
  const { receiptView } = await import("@/lib/receipts/upload");
  const { disputeView } = await import("@/lib/disputes");
  const { dueTerms } = await import("@/lib/claims");
  const terms = dueTerms(rule, ctx.family);
  return {
    expense: expenseView(id, e, ctx.family, now(), rule),
    events: events.docs.map((d) => eventView(d.id, d.data() as never)),
    agreementId: rv?.agreementId ?? null,
    ruleVersion: rv ? { id: rv.id, version: rv.version, status: rv.status } : null,
    receipt: receiptSnap?.exists ? receiptView(receiptSnap.id, receiptSnap.data() as ReceiptDoc) : null,
    dispute: disputeSnap.exists ? disputeView(disputeSnap.data() as DisputeDoc) : null,
    dueTerms: { days: terms.days, clause: terms.clause, source: terms.source, previewDueAt: new Date(now().getTime() + terms.days * DAY_MS).toISOString() },
    me: actorOf(ctx).kind,
  };
}
export type ExpenseDetail = Awaited<ReturnType<typeof getExpense>>;

/** GET /api/expenses: newest first (index familyId + updatedAt desc). */
export async function listExpenses(ctx: FamilyContext, opts: { limit: number; before?: string }) {
  let q = expensesCol().where("familyId", "==", ctx.familyId).orderBy("updatedAt", "desc").limit(opts.limit);
  if (opts.before) q = q.startAfter(Timestamp.fromDate(new Date(opts.before)));
  const snaps = await q.get();
  const at = now();
  const items = snaps.docs.map((d) => expenseView(d.id, d.data() as ExpenseDoc, ctx.family, at));
  return { items, nextBefore: items.length === opts.limit ? items[items.length - 1].updatedAt : null };
}
