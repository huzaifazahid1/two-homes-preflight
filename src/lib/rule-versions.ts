import "server-only";
import { audit, auditInTx } from "@/lib/audit";
import { actorOf, type FamilyContext } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { familyEntitled } from "@/lib/entitlement";
import { AppError } from "@/lib/errors";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { newId } from "@/lib/ids";
import { verifyQuote } from "@/lib/quote-verify";
import { applyReview, draftProblems, isBlocking, ownIssues } from "@/lib/rules-review";
import type { ManualRule, RuleEdit, RulePatch } from "@/schemas";
import type { FamilyDoc, Rule, RuleVersionDoc } from "@/types/firestore";
import { agreementsCol, loadPages, ruleVersionsCol } from "./agreements";
import { ruleVersionView } from "./rule-version-view";

// Rule review on DRAFT versions and activation (Section A.5.1 step 2, E.2 ruleVersions).
// ACTIVE versions are immutable (AG-10: 409). Activation supersedes the previous version and
// moves the family pointer in one transaction (AG-9).

type Meta = { requestId?: string; ip?: string | null; userAgent?: string | null };

async function readFamilyVersion(ctx: FamilyContext, id: string): Promise<RuleVersionDoc> {
  const snap = await ruleVersionsCol().doc(id).get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "Rule version not found.");
  const rv = snap.data() as RuleVersionDoc;
  if (rv.familyId !== ctx.familyId) {
    await audit({ familyId: ctx.familyId, actor: actorOf(ctx), action: "forbidden.ruleVersion", target: `ruleVersions/${id}` });
    throw new AppError("FORBIDDEN", "You do not have access to these rules.");
  }
  return rv;
}

function assertDraft(rv: RuleVersionDoc) {
  if (rv.status !== "DRAFT") {
    throw new AppError("STATE_CONFLICT", "Confirmed rules cannot be changed. Upload an amendment to create a new version.", { details: { status: rv.status } });
  }
}

const EDITABLE = ["label", "owedPct", "approval", "receiptDeadlineDays", "reimburseWithinDays", "childNames", "quote", "page", "sharesNonNumeric"] as const;

function applyEdit(rule: Rule, changes: RuleEdit, pages: { page: number; text: string }[] | null): Rule {
  const editedFrom = rule.editedFrom ?? Object.fromEntries(EDITABLE.filter((k) => rule[k] !== undefined).map((k) => [k, rule[k]]));
  const next: Rule = { ...rule, editedFrom };
  if (changes.label !== undefined) next.label = changes.label;
  if (changes.owedPct !== undefined) {
    next.owedPct = changes.owedPct;
    // Entering percentages resolves a "proportional to income" clause.
    if (changes.sharesNonNumeric === undefined) delete next.sharesNonNumeric;
  }
  if (changes.sharesNonNumeric !== undefined) {
    if (changes.sharesNonNumeric) next.sharesNonNumeric = true;
    else delete next.sharesNonNumeric;
  }
  if (changes.approval !== undefined) {
    if (changes.approval && changes.approval.required) next.approval = changes.approval;
    else delete next.approval;
  }
  for (const k of ["receiptDeadlineDays", "reimburseWithinDays"] as const) {
    const v = changes[k];
    if (v === null) delete next[k];
    else if (v !== undefined) next[k] = v;
  }
  if (changes.childNames !== undefined) {
    if (changes.childNames.length) next.childNames = changes.childNames;
    else delete next.childNames;
  }
  if (changes.quote !== undefined || changes.page !== undefined) {
    next.quote = changes.quote ?? rule.quote;
    const v = verifyQuote(next.quote, pages ?? [], changes.page ?? rule.page);
    next.page = v.page;
    next.quoteMatch = v.match;
  }
  next.issues = ownIssues(next, { humanEdited: true });
  next.reviewState = "EDITED";
  return next;
}

/** PATCH /api/rule-versions/:id/rules/:ruleId. Owner only, DRAFT only. */
export async function patchRule(ctx: FamilyContext, rvId: string, ruleId: string, patch: RulePatch, meta: Meta = {}) {
  const pre = await readFamilyVersion(ctx, rvId);
  assertDraft(pre);
  const needsPages = patch.action === "edit" && (patch.changes.quote !== undefined || patch.changes.page !== undefined);
  const pages = needsPages ? await loadPages(pre.agreementId) : null;
  const ref = ruleVersionsCol().doc(rvId);

  const rv = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.data() as RuleVersionDoc;
    assertDraft(current);
    const i = current.rules.findIndex((r) => r.id === ruleId);
    if (i < 0) throw new AppError("NOT_FOUND", "Rule not found.");
    const rule = current.rules[i];
    let next: Rule;
    switch (patch.action) {
      case "confirm":
        if (isBlocking(rule)) {
          throw new AppError("STATE_CONFLICT", rule.quoteMatch === "none" ? "This quote is not in the agreement, so the rule cannot be confirmed. Edit the quote or reject the rule." : "Fix the problems on this rule before confirming it.", {
            details: { issues: rule.issues ?? [] },
          });
        }
        next = { ...rule, reviewState: "CONFIRMED" };
        break;
      case "reject":
        next = { ...rule, reviewState: "REJECTED" };
        break;
      case "undo":
        next = { ...rule, reviewState: "PENDING" };
        break;
      case "edit":
        next = applyEdit(rule, patch.changes, pages);
        if (next.quoteMatch === "none") throw new AppError("INVALID", "That quote is not in the agreement text. Copy the exact sentence from the source page.");
        break;
    }
    const rules = applyReview(current.rules.map((r, j) => (j === i ? next : r)));
    const t = Timestamp.fromDate(now());
    tx.update(ref, { rules, updatedAt: t });
    auditInTx(tx, { familyId: ctx.familyId, actor: actorOf(ctx), action: `rule.${patch.action}`, target: `ruleVersions/${rvId}#${ruleId}`, ip: meta.ip, userAgent: meta.userAgent });
    return { ...current, rules };
  });
  return ruleVersionView(rvId, rv);
}

/** POST /api/rule-versions/:id/rules: manual entry. The quote must be found in the agreement. */
export async function addManualRule(ctx: FamilyContext, rvId: string, input: ManualRule, meta: Meta = {}) {
  const pre = await readFamilyVersion(ctx, rvId);
  assertDraft(pre);
  const pages = await loadPages(pre.agreementId);
  const v = verifyQuote(input.quote, pages, input.page);
  if (v.match === "none") throw new AppError("INVALID", "That quote is not in the agreement text. Copy the exact sentence from the source page.", { details: { fields: [{ path: "body.quote", message: "Not found in the agreement" }] } });
  const rule: Rule = {
    id: newId(12),
    category: input.category,
    label: input.label,
    owedPct: input.owedPct,
    ...(input.approval?.required ? { approval: input.approval } : {}),
    ...(input.receiptDeadlineDays ? { receiptDeadlineDays: input.receiptDeadlineDays } : {}),
    ...(input.reimburseWithinDays ? { reimburseWithinDays: input.reimburseWithinDays } : {}),
    ...(input.childNames?.length ? { childNames: input.childNames } : {}),
    quote: input.quote,
    page: v.page,
    quoteMatch: v.match,
    source: "manual",
    reviewState: "PENDING",
  };
  rule.issues = ownIssues(rule, { humanEdited: true });
  const ref = ruleVersionsCol().doc(rvId);
  const rv = await db().runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data() as RuleVersionDoc;
    assertDraft(current);
    if (current.rules.length >= 60) throw new AppError("INVALID", "A rule version can have up to 60 rules.");
    const rules = applyReview([...current.rules, rule]);
    tx.update(ref, { rules, updatedAt: Timestamp.fromDate(now()) });
    auditInTx(tx, { familyId: ctx.familyId, actor: actorOf(ctx), action: "rule.manual_add", target: `ruleVersions/${rvId}#${rule.id}`, ip: meta.ip, userAgent: meta.userAgent });
    return { ...current, rules };
  });
  return ruleVersionView(rvId, rv);
}

/** POST /api/rule-versions/:id/activate. All rules decided; old ACTIVE -> SUPERSEDED; pointer moved. */
export async function activateRuleVersion(ctx: FamilyContext, rvId: string, meta: Meta = {}) {
  await readFamilyVersion(ctx, rvId);
  const entitled = await familyEntitled(ctx.familyId);
  const ref = ruleVersionsCol().doc(rvId);
  const familyRef = db().collection("families").doc(ctx.familyId);
  await db().runTransaction(async (tx) => {
    const rv = (await tx.get(ref)).data() as RuleVersionDoc;
    const family = (await tx.get(familyRef)).data() as FamilyDoc;
    assertDraft(rv);
    const rules = applyReview(rv.rules);
    const problem = draftProblems(rules);
    if (problem) throw new AppError("STATE_CONFLICT", problem);
    const prevId = family.activeRuleVersionId;
    if (prevId && !entitled) {
      throw new AppError("PLAN_REQUIRED", "Amendments are part of the Family plan.", { details: { upgrade: true } });
    }
    const t = Timestamp.fromDate(now());
    tx.update(ref, { status: "ACTIVE", rules, confirmedBy: ctx.user.uid, confirmedAt: t, updatedAt: t });
    if (prevId && prevId !== rvId) tx.update(ruleVersionsCol().doc(prevId), { status: "SUPERSEDED", supersededAt: t, updatedAt: t });
    tx.update(familyRef, { activeRuleVersionId: rvId, updatedAt: FieldValue.serverTimestamp() });
    tx.update(agreementsCol().doc(rv.agreementId), { draftRuleVersionId: FieldValue.delete(), updatedAt: t });
    auditInTx(tx, { familyId: ctx.familyId, actor: actorOf(ctx), action: "ruleVersion.activate", target: `ruleVersions/${rvId}`, ip: meta.ip, userAgent: meta.userAgent });
  });
  const snap = await ref.get();
  return ruleVersionView(rvId, snap.data() as RuleVersionDoc);
}

/** Rules the co-parent is asked about: the confirmed ones. */
export function acknowledgeableRuleIds(rv: RuleVersionDoc | undefined): string[] {
  return (rv?.rules ?? []).filter((r) => r.reviewState === "CONFIRMED" || r.reviewState === "EDITED").map((r) => r.id);
}

/**
 * Merges the co-parent's answers into the stored acknowledgement. Unanswered rules keep their
 * previous answer, or "agree" when `defaultAgree` (accepting the invite). Returns changed rule ids.
 */
export function mergeAck(rv: RuleVersionDoc, input: Record<string, "agree" | "disagree"> | undefined, defaultAgree: boolean) {
  const prev = rv.coParentAck?.perRule ?? {};
  const perRule: Record<string, "agree" | "disagree"> = {};
  const changed: string[] = [];
  for (const id of acknowledgeableRuleIds(rv)) {
    const value = input?.[id] ?? prev[id] ?? (defaultAgree ? "agree" : undefined);
    if (!value) continue;
    perRule[id] = value;
    if ((prev[id] ?? "agree") !== value) changed.push(id);
  }
  return { perRule, changed, disagreed: Object.values(perRule).filter((v) => v === "disagree").length };
}
