import "server-only";
import { auditInTx } from "@/lib/audit";
import { actorOf, type FamilyContext, type SessionUser } from "@/lib/auth/session";
import { DAY_MS, now } from "@/lib/clock";
import { approvalDecisionEmail, approvalReminderEmail, approvalRequestEmail } from "@/lib/email/templates/approval";
import { AppError, isAppError } from "@/lib/errors";
import { loadFamilyExpense, loadRuleVersion } from "@/lib/expenses";
import { db, Timestamp } from "@/lib/firebase/admin";
import { requireLinkActor } from "@/lib/links/actor";
import { createLinkTokenInTx, hashToken, isWellFormedToken, linkTokensCol, markUsedInTx, maskEmail } from "@/lib/links/tokens";
import { log } from "@/lib/log";
import { formatCents } from "@/lib/money";
import { dedupeKey, deliverNotificationEmail, filterNewNotifications, writeNotifications } from "@/lib/notifications";
import { appUrl, familyTimeZone, footerForRole, formatDayIn, party } from "@/lib/parties";
import { consumeRateLimit } from "@/lib/rate-limit";
import { effectiveApprovalState, isBefore, linkStatus } from "@/lib/state/effective";
import { transition } from "@/lib/state/transition";
import type { ApprovalDecision, ApprovalDoc, ExpenseDoc, FamilyDoc, LinkTokenDoc } from "@/types/firestore";

// Approvals (Section A.6.3, E.6.1, F.3). The request is a link with an email code; the decision
// is final; nothing is ever approved on silence. approval.state changes only through transition().

export const APPROVAL_TTL_MS = 14 * DAY_MS;
export const APPROVAL_REMINDER_AFTER_MS = 3 * DAY_MS;
const LINK_RESENDS_PER_DAY = 3;

type Meta = { requestId?: string; ip?: string | null; userAgent?: string | null };

export function approvalsCol() {
  return db().collection("approvals");
}

/** approvals/{expenseId}_{n}: n counts the requests for one expense. */
export function nextApprovalId(expenseId: string, currentRequestId?: string): { id: string; n: number } {
  const last = currentRequestId ? Number(currentRequestId.slice(currentRequestId.lastIndexOf("_") + 1)) : 0;
  const n = (Number.isSafeInteger(last) ? last : 0) + 1;
  return { id: `${expenseId}_${n}`, n };
}

function approvalIdFromLink(link: LinkTokenDoc): string {
  if (link.purpose !== "approval" || !link.resourcePath.startsWith("approvals/")) throw new AppError("NOT_FOUND", "This link is not an approval link.");
  return link.resourcePath.slice("approvals/".length);
}

type Sent = { link: string; expiresAt: string; email: { status: "sent" | "failed" } };

async function sendRequestEmail(input: { family: FamilyDoc; expense: ExpenseDoc; expenseId: string; key: string; token: string; expiresAt: Date; purchased: boolean; requestId?: string }): Promise<Sent> {
  const { family, expense } = input;
  const requester = party(family, expense.paidByRole);
  const approver = party(family, expense.owedByRole);
  const [rv, tz] = await Promise.all([loadRuleVersion(expense.ruleVersionId), familyTimeZone(family)]);
  const rule = rv?.rules.find((r) => r.id === expense.verdict.ruleId);
  const child = family.children.find((c) => c.id === expense.childId)?.firstName ?? "your child";
  const url = appUrl(`/a/${input.token}`);
  const delivery = await deliverNotificationEmail({
    dedupeKey: input.key,
    to: approver.email,
    replyTo: requester.email,
    email: approvalRequestEmail({
      requesterName: requester.name,
      childName: child,
      description: expense.description,
      amountCents: expense.amountCents,
      owedShareCents: expense.verdict.owedShareCents,
      clauseLabel: rule?.label ?? null,
      page: rule?.page ?? null,
      purchasedBeforeApproval: input.purchased,
      url,
      expiresOn: formatDayIn(tz, input.expiresAt),
      footer: footerForRole(family, approver.role),
    }),
    requestId: input.requestId,
  });
  return { link: url, expiresAt: input.expiresAt.toISOString(), email: { status: delivery.ok ? "sent" : "failed" } };
}

/**
 * POST /api/expenses/:id/approval-request. REQUIRED -> REQUESTED, EXPIRED/DECLINED -> REQUESTED
 * (decline only after 7 days). While a request is open it sends a fresh link instead (old one revoked).
 */
export async function requestApproval(ctx: FamilyContext, expenseId: string, meta: Meta = {}): Promise<Sent> {
  const e = await loadFamilyExpense(ctx, expenseId, meta.requestId);
  const actor = actorOf(ctx);
  if (actor.kind !== e.paidByRole) throw new AppError("FORBIDDEN", "Only the parent who is buying can ask for approval.");
  const approver = party(ctx.family, e.owedByRole);
  if (!approver.email) throw new AppError("STATE_CONFLICT", "Add the other parent's email in Settings first.");
  if (e.settlement.state === "CANCELLED") throw new AppError("STATE_CONFLICT", "This expense was cancelled.");

  const at = now();
  const effective = effectiveApprovalState(e.approval, at);
  if (effective === "REQUESTED") return resendApprovalLink(ctx, expenseId, meta);

  if (effective === "DECLINED" && isBefore(at, e.approval.blockedUntil)) {
    const until = e.approval.blockedUntil!.toDate();
    const tz = await familyTimeZone(ctx.family);
    throw new AppError("STATE_CONFLICT", `This expense was declined. You can ask again from ${formatDayIn(tz, until)}.`, { details: { blockedUntil: until.toISOString() } });
  }
  const event = effective === "EXPIRED" || effective === "DECLINED" ? ("RESEND" as const) : ("SEND_REQUEST" as const);
  const { id: approvalId, n } = nextApprovalId(expenseId, e.approval.currentRequestId);
  const expiresAt = new Date(at.getTime() + APPROVAL_TTL_MS);
  const requester = party(ctx.family, e.paidByRole);
  const key = dedupeKey("approval_request", approvalId, 1);
  const created: { token?: string; purchased?: boolean } = {};

  const result = await transition({
    expenseId,
    machine: "approval",
    event,
    actor,
    payload: { requestId: approvalId, expiresAt },
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    loadFacts: async (tx, current) => {
      if ((current.approval.currentRequestId ?? null) !== (e.approval.currentRequestId ?? null)) {
        throw new AppError("STATE_CONFLICT", "This expense changed. Refresh and try again.");
      }
      // Daily cap (A.6.3): requests created by this family in the last 24 hours.
      const recent = await tx.get(approvalsCol().where("familyId", "==", ctx.familyId).where("requestedAt", ">", Timestamp.fromMillis(at.getTime() - DAY_MS)).orderBy("requestedAt", "desc"));
      return { dailyRequestCount: recent.size };
    },
    notify: () => [
      {
        dedupeKey: key,
        familyId: ctx.familyId,
        toUid: approver.uid,
        toEmail: approver.email,
        type: "approval_request",
        expenseId,
        title: `${requester.firstName} asks for your approval`,
        body: `${e.description}, ${formatCents(e.amountCents)}`,
        link: approver.uid ? `/app/expenses/${expenseId}` : undefined,
        sendEmail: true,
      },
    ],
    extraWrites: (tx, { expense, expenseRef }) => {
      const purchased = expense.mode === "purchased" || Boolean(expense.receiptId);
      const link = createLinkTokenInTx(
        tx,
        {
          familyId: ctx.familyId,
          purpose: "approval",
          resourcePath: `approvals/${approvalId}`,
          recipientEmail: approver.email,
          recipientRole: approver.role,
          allowedActions: ["decide"],
          createdBy: ctx.user.uid,
        },
        { expiresAt },
      );
      const doc: Omit<ApprovalDoc, "requestedAt" | "expiresAt"> & { requestedAt: Timestamp; expiresAt: Timestamp } = {
        familyId: ctx.familyId,
        expenseId,
        n,
        tokenHash: link.tokenHash,
        requestedBy: ctx.user.uid,
        requestedByRole: requester.role,
        approverRole: approver.role,
        requestedAt: Timestamp.fromDate(at),
        expiresAt: Timestamp.fromDate(expiresAt),
        purchasedBeforeApproval: purchased,
      };
      tx.create(approvalsCol().doc(approvalId), doc);
      if (purchased !== expense.purchasedBeforeApproval) tx.update(expenseRef, { purchasedBeforeApproval: purchased });
      created.token = link.token;
      created.purchased = purchased;
    },
  });
  if (result.outcome === "noop" || !created.token) throw new AppError("STATE_CONFLICT", "An approval request was already sent for this expense.");
  const fresh = await loadFamilyExpense(ctx, expenseId, meta.requestId);
  return sendRequestEmail({ family: ctx.family, expense: fresh, expenseId, key, token: created.token, expiresAt, purchased: Boolean(created.purchased), requestId: meta.requestId });
}

/** A new link for the open request (the old one is revoked). 3 per expense per day. */
async function resendApprovalLink(ctx: FamilyContext, expenseId: string, meta: Meta): Promise<Sent> {
  await consumeRateLimit({ key: `approval-link:${expenseId}`, limit: LINK_RESENDS_PER_DAY, windowMs: DAY_MS, message: "You already sent this link 3 times today. Try again tomorrow." });
  const expenseRef = db().collection("expenses").doc(expenseId);
  const out = await db().runTransaction(async (tx) => {
    const expense = (await tx.get(expenseRef)).data() as ExpenseDoc;
    if (effectiveApprovalState(expense.approval, now()) !== "REQUESTED" || !expense.approval.currentRequestId) {
      throw new AppError("STATE_CONFLICT", "There is no open approval request to send again.");
    }
    const approvalRef = approvalsCol().doc(expense.approval.currentRequestId);
    const approval = (await tx.get(approvalRef)).data() as ApprovalDoc;
    const approver = party(ctx.family, approval.approverRole);
    // ---- writes ----
    const oldRef = linkTokensCol().doc(approval.tokenHash);
    tx.update(oldRef, { revokedAt: Timestamp.fromDate(now()) });
    const link = createLinkTokenInTx(
      tx,
      { familyId: ctx.familyId, purpose: "approval", resourcePath: `approvals/${approvalRef.id}`, recipientEmail: approver.email, recipientRole: approver.role, allowedActions: ["decide"], createdBy: ctx.user.uid },
      { expiresAt: approval.expiresAt.toDate() },
    );
    tx.update(approvalRef, { tokenHash: link.tokenHash });
    const key = dedupeKey("approval_request", approvalRef.id, link.tokenHash.slice(0, 12));
    writeNotifications(tx, [
      { dedupeKey: key, familyId: ctx.familyId, toUid: approver.uid, toEmail: approver.email, type: "approval_request", expenseId, title: `${party(ctx.family, approval.requestedByRole).firstName} sent the approval link again`, body: `${expense.description}, ${formatCents(expense.amountCents)}`, sendEmail: true },
    ]);
    auditInTx(tx, { familyId: ctx.familyId, actor: actorOf(ctx), action: "approval.link_resent", target: `approvals/${approvalRef.id}`, ip: meta.ip, userAgent: meta.userAgent });
    return { expense, key, token: link.token, expiresAt: approval.expiresAt.toDate(), purchased: approval.purchasedBeforeApproval };
  });
  return sendRequestEmail({ family: ctx.family, expenseId, requestId: meta.requestId, ...out });
}

/** DELETE /api/expenses/:id/approval-request (AP-8): REQUESTED -> CANCELLED, token revoked in the same transaction. */
export async function cancelApprovalRequest(ctx: FamilyContext, expenseId: string, meta: Meta = {}) {
  const e = await loadFamilyExpense(ctx, expenseId, meta.requestId);
  const actor = actorOf(ctx);
  if (actor.kind !== e.paidByRole) throw new AppError("FORBIDDEN", "Only the parent who asked can cancel the request.");
  let tokenHash: string | null = null;
  await transition({
    expenseId,
    machine: "approval",
    event: "CANCEL",
    actor,
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    loadFacts: async (tx, current) => {
      if (current.approval.currentRequestId) {
        const a = (await tx.get(approvalsCol().doc(current.approval.currentRequestId))).data() as ApprovalDoc | undefined;
        tokenHash = a?.tokenHash ?? null;
      }
      return {};
    },
    extraWrites: (tx, { expense }) => {
      const t = Timestamp.fromDate(now());
      if (tokenHash) tx.update(linkTokensCol().doc(tokenHash), { revokedAt: t });
      if (expense.approval.currentRequestId) tx.update(approvalsCol().doc(expense.approval.currentRequestId), { cancelledAt: t });
    },
  });
}

export type DecisionInput = { decision: ApprovalDecision; approvedCents?: number; reason?: string };

const EVENT_FOR = { APPROVED: "APPROVE", PARTIALLY_APPROVED: "PARTIAL_APPROVE", DECLINED: "DECLINE" } as const;

/** POST /api/links/:token/decision. Link + code (or the signed-in approver). First decision is final (AP-6). */
export async function decideApproval(
  token: string,
  input: DecisionInput,
  ctx: { linkSession: { tokenHash: string } | null; user: SessionUser | null },
  meta: Meta = {},
) {
  if (!isWellFormedToken(token)) throw new AppError("NOT_FOUND", "This link is not valid.");
  const tokenHash = hashToken(token);
  const linkRef = linkTokensCol().doc(tokenHash);
  const linkSnap = await linkRef.get();
  if (!linkSnap.exists) throw new AppError("NOT_FOUND", "This link is not valid.");
  const link = linkSnap.data() as LinkTokenDoc;
  const approvalId = approvalIdFromLink(link);
  const status = linkStatus(link, now());
  if (status === "expired" || status === "revoked") throw new AppError("LINK_GONE", status === "expired" ? "This link has expired." : "This link was replaced or cancelled.", { details: { reason: status, purpose: link.purpose } });
  const actor = await requireLinkActor(ctx, tokenHash, link);

  const approvalRef = approvalsCol().doc(approvalId);
  const approval = (await approvalRef.get()).data() as ApprovalDoc | undefined;
  if (!approval) throw new AppError("NOT_FOUND", "This request no longer exists.");
  const family = (await db().collection("families").doc(link.familyId).get()).data() as FamilyDoc;
  const requester = party(family, approval.requestedByRole);
  const approver = party(family, approval.approverRole);
  const key = dedupeKey("approval_decision", approvalId, 1);
  const decided: { approvedCents: number | null } = { approvedCents: null };

  const result = await transition({
    expenseId: approval.expenseId,
    machine: "approval",
    event: EVENT_FOR[input.decision],
    actor,
    payload: { approvedCents: input.decision === "PARTIALLY_APPROVED" ? input.approvedCents : undefined, reason: input.reason },
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    loadFacts: async (tx, current) => {
      const l = (await tx.get(linkRef)).data() as LinkTokenDoc;
      const s = linkStatus(l, now());
      if (s === "used") throw new AppError("STATE_CONFLICT", "This request was already answered. The first answer is final.", { details: { alreadyDecided: true } });
      if (s !== "usable") throw new AppError("LINK_GONE", s === "expired" ? "This link has expired." : "This link was replaced or cancelled.", { details: { reason: s, purpose: "approval" } });
      if (current.approval.currentRequestId !== approvalId) throw new AppError("LINK_GONE", "This request was replaced by a newer one.", { details: { reason: "revoked", purpose: "approval" } });
      return {};
    },
    notify: ({ expense }) => [
      {
        dedupeKey: key,
        familyId: link.familyId,
        toUid: requester.uid,
        toEmail: requester.email,
        type: "approval_decision",
        expenseId: approval.expenseId,
        title: input.decision === "DECLINED" ? `${approver.firstName} declined ${expense.description}` : `${approver.firstName} approved ${input.decision === "PARTIALLY_APPROVED" ? "part of " : ""}${expense.description}`,
        body:
          input.decision === "PARTIALLY_APPROVED" && input.approvedCents
            ? `${formatCents(input.approvedCents)} of ${formatCents(expense.amountCents)} approved.`
            : input.decision === "DECLINED"
              ? input.reason ? `"${input.reason.slice(0, 140)}"` : "No reason given."
              : `${formatCents(expense.amountCents)} approved.`,
        link: `/app/expenses/${approval.expenseId}`,
        sendEmail: true,
      },
    ],
    extraWrites: (tx, { expense }) => {
      markUsedInTx(tx, tokenHash);
      const approvedCents = input.decision === "APPROVED" ? expense.amountCents : input.decision === "PARTIALLY_APPROVED" ? (input.approvedCents ?? null) : null;
      tx.update(approvalRef, {
        decision: input.decision,
        ...(approvedCents !== null ? { approvedCents } : {}),
        ...(input.reason ? { reason: input.reason.slice(0, 500) } : {}),
        decidedAt: Timestamp.fromDate(now()),
      });
      decided.approvedCents = approvedCents;
    },
  });
  if (result.outcome === "noop") throw new AppError("STATE_CONFLICT", "This request was already answered. The first answer is final.", { details: { alreadyDecided: true } });

  const expense = (await db().collection("expenses").doc(approval.expenseId).get()).data() as ExpenseDoc;
  await deliverNotificationEmail({
    dedupeKey: key,
    to: requester.email,
    replyTo: approver.email,
    email: approvalDecisionEmail({
      approverName: approver.name,
      description: expense.description,
      decision: input.decision,
      approvedCents: decided.approvedCents,
      amountCents: expense.amountCents,
      reason: input.reason ?? null,
      url: appUrl(`/app/expenses/${approval.expenseId}`),
      footer: footerForRole(family, requester.role),
    }),
    requestId: meta.requestId,
  });

  // A receipt that waited for this approval is matched again (RECEIPT_ISSUE -> READY when resolved).
  if (input.decision !== "DECLINED" && expense.settlement.state === "RECEIPT_ISSUE") {
    try {
      const { rematchReceipt } = await import("@/lib/receipts/upload");
      await rematchReceipt(approval.expenseId, { kind: "system" }, meta);
    } catch (err) {
      // The decision is saved; the parent can confirm the receipt again from the expense page.
      if (!isAppError(err) || err.status >= 500) log.error("approval.rematch_failed", { requestId: meta.requestId, familyId: link.familyId, error: err });
    }
  }
  return { decision: input.decision, approvedCents: decided.approvedCents };
}

export type ApprovalLinkSummary = {
  purpose: "approval";
  requesterName: string;
  approverName: string;
  childName: string;
  description: string;
  vendor: string | null;
  category: string;
  amountCents: number;
  owedShareCents: number;
  owedPct: number | null;
  clause: { label: string; quote: string; page: number } | null;
  threshold: { operator: "gt" | "gte"; thresholdCents: number } | null;
  purchasedBeforeApproval: boolean;
  expiresAt: string;
  sentTo: string;
  canAct: boolean;
  decision: { decision: ApprovalDecision; approvedCents: number | null; reason: string | null; decidedAt: string } | null;
};

/** GET /api/links/:token for an approval link. Read-only; shows the result after a decision. */
export async function approvalLinkSummary(
  tokenHash: string,
  link: LinkTokenDoc,
  ctx: { linkSession: { tokenHash: string } | null; user: SessionUser | null },
): Promise<ApprovalLinkSummary> {
  const approvalId = approvalIdFromLink(link);
  const approval = (await approvalsCol().doc(approvalId).get()).data() as ApprovalDoc | undefined;
  if (!approval) throw new AppError("NOT_FOUND", "This request no longer exists.");
  const [expenseSnap, familySnap] = await Promise.all([db().collection("expenses").doc(approval.expenseId).get(), db().collection("families").doc(link.familyId).get()]);
  const e = expenseSnap.data() as ExpenseDoc;
  const family = familySnap.data() as FamilyDoc;
  const rv = await loadRuleVersion(e.ruleVersionId);
  const rule = rv?.rules.find((r) => r.id === e.verdict.ruleId) ?? null;
  const canAct = await requireLinkActor(ctx, tokenHash, link).then(
    () => true,
    () => false,
  );
  return {
    purpose: "approval",
    requesterName: party(family, approval.requestedByRole).name,
    approverName: party(family, approval.approverRole).firstName,
    childName: family.children.find((c) => c.id === e.childId)?.firstName ?? "your child",
    description: e.description,
    vendor: e.vendor ?? null,
    category: e.category,
    amountCents: e.amountCents,
    owedShareCents: e.verdict.owedShareCents,
    owedPct: rule && !rule.sharesNonNumeric ? rule.owedPct : null,
    clause: rule ? { label: rule.label, quote: rule.quote, page: rule.page } : null,
    threshold: rule?.approval?.required ? { operator: rule.approval.operator, thresholdCents: rule.approval.thresholdCents } : null,
    purchasedBeforeApproval: approval.purchasedBeforeApproval || e.purchasedBeforeApproval,
    expiresAt: approval.expiresAt.toDate().toISOString(),
    sentTo: maskEmail(link.recipientEmail),
    canAct,
    decision: approval.decision
      ? { decision: approval.decision, approvedCents: approval.approvedCents ?? null, reason: approval.reason ?? null, decidedAt: approval.decidedAt!.toDate().toISOString() }
      : null,
  };
}

/**
 * Daily job: one reminder 3 days after the request if there is no decision (AP-4). The reminder
 * carries a new link (the plain token is never stored, so the old one is revoked). Returns false
 * when it was already sent or the request is no longer open (CL-10: a second run sends nothing).
 */
export async function sendApprovalReminder(approvalId: string, meta: Meta = {}): Promise<boolean> {
  const approvalRef = approvalsCol().doc(approvalId);
  const key = dedupeKey("approval_reminder", approvalId, 1);
  const out = await db().runTransaction(async (tx) => {
    const approval = (await tx.get(approvalRef)).data() as (ApprovalDoc & { cancelledAt?: unknown }) | undefined;
    if (!approval || approval.decision || approval.reminderSentAt || approval.cancelledAt) return null;
    const expenseRef = db().collection("expenses").doc(approval.expenseId);
    const expense = (await tx.get(expenseRef)).data() as ExpenseDoc;
    const at = now();
    if (expense.approval.currentRequestId !== approvalId || effectiveApprovalState(expense.approval, at) !== "REQUESTED") return null;
    if (at.getTime() - approval.requestedAt.toMillis() < APPROVAL_REMINDER_AFTER_MS) return null;
    const family = (await tx.get(db().collection("families").doc(approval.familyId))).data() as FamilyDoc;
    const approver = party(family, approval.approverRole);
    const requester = party(family, approval.requestedByRole);
    const notif = {
      dedupeKey: key, familyId: approval.familyId, toUid: approver.uid, toEmail: approver.email, type: "approval_reminder" as const, expenseId: approval.expenseId,
      title: `${requester.firstName} is waiting for your answer`, body: `${expense.description}, ${formatCents(expense.amountCents)}`,
      link: approver.uid ? `/app/expenses/${approval.expenseId}` : undefined, sendEmail: true,
    };
    const fresh = await filterNewNotifications(tx, [notif]);
    if (fresh.length === 0) return null;
    // ---- writes ----
    const t = Timestamp.fromDate(at);
    tx.update(linkTokensCol().doc(approval.tokenHash), { revokedAt: t });
    const link = createLinkTokenInTx(
      tx,
      { familyId: approval.familyId, purpose: "approval", resourcePath: `approvals/${approvalId}`, recipientEmail: approver.email, recipientRole: approver.role, allowedActions: ["decide"], createdBy: approval.requestedBy },
      { expiresAt: approval.expiresAt.toDate() },
    );
    tx.update(approvalRef, { reminderSentAt: t, tokenHash: link.tokenHash });
    tx.create(expenseRef.collection("events").doc(), { type: "reminder.approval", machine: "note", actor: { kind: "system" }, data: { event: "REMIND", kind: "approval" }, at: t });
    writeNotifications(tx, fresh);
    return { approval, expense, family, approver, requester, token: link.token };
  });
  if (!out) return false;
  const tz = await familyTimeZone(out.family);
  await deliverNotificationEmail({
    dedupeKey: key,
    to: out.approver.email,
    replyTo: out.requester.email,
    email: approvalReminderEmail({
      requesterName: out.requester.name,
      childName: out.family.children.find((c) => c.id === out.expense.childId)?.firstName ?? "your child",
      description: out.expense.description,
      amountCents: out.expense.amountCents,
      url: appUrl(`/a/${out.token}`),
      expiresOn: formatDayIn(tz, out.approval.expiresAt.toDate()),
      footer: footerForRole(out.family, out.approver.role),
    }),
    requestId: meta.requestId,
  });
  return true;
}
