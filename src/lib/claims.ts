import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { auditInTx } from "@/lib/audit";
import { actorOf, requireVerified, type FamilyContext, type SessionUser } from "@/lib/auth/session";
import { DAY_MS, HOUR_MS, now } from "@/lib/clock";
import { externalReportedEmail, externalResolvedEmail, paymentReminderEmail, paymentRequestEmail } from "@/lib/email/templates/payment";
import { AppError } from "@/lib/errors";
import { dateFromIso, isoFromTs } from "@/lib/expense-view";
import { loadFamilyExpense, loadRuleVersion } from "@/lib/expenses";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { requireLinkActor } from "@/lib/links/actor";
import { assertAction, createLinkTokenInTx, findUsableTokensFor, hashToken, isWellFormedToken, maskEmail, resolveLinkHash, revokeTokensInTx } from "@/lib/links/tokens";
import { formatCents } from "@/lib/money";
import { dedupeKey, deliverNotificationEmail, filterNewNotifications, writeNotifications, type NotificationInput } from "@/lib/notifications";
import { appUrl, familyTimeZone, footerForRole, formatDayIn, party, type Party } from "@/lib/parties";
import { isDueSoon, isOverdue, toMs } from "@/lib/state/effective";
import { SETTLEMENT_TERMINAL } from "@/lib/state/machines";
import { transition } from "@/lib/state/transition";
import { breakdownFor } from "@/lib/checkout";
import { familyEntitled } from "@/lib/entitlement";
import type { FeeBreakdown } from "@/lib/fees";
import type { Actor, DisputeDoc, ExpenseDoc, FamilyDoc, LinkTokenDoc, PaymentDoc, ReceiptDoc, ReminderKind, Role, Rule, SettlementState } from "@/types/firestore";

// Claims (Section A.6.4, E.6.2). The buyer (paidByRole) is owed; owedByRole pays. Overdue is
// derived from dueAt, never stored. Every email to the paying parent carries a fresh payment
// link (docs/decisions.md 3.x).

export const MANUAL_REMINDER_GAP_MS = 72 * HOUR_MS;
export const DEFAULT_DUE_DAYS = 30;
export const PAYMENT_ACTIONS = ["view_receipt", "report_external", "dispute", "pay", "connect_paypal"] as const;
const OPEN_FOR_REMINDER: ReadonlySet<SettlementState> = new Set(["AWAITING_PAYMENT", "PAYMENT_FAILED"]);

type Meta = { requestId?: string; ip?: string | null; userAgent?: string | null };

function requireReceiver(ctx: FamilyContext, e: ExpenseDoc) {
  if (actorOf(ctx).kind !== e.paidByRole) throw new AppError("FORBIDDEN", "Only the parent who is owed can do this.");
}

export function paymentPath(expenseId: string) {
  return `expenses/${expenseId}`;
}

/** Reimbursement deadline from the matched rule (clause cited, CL-2) or the family default. */
export function dueTerms(rule: Rule | null | undefined, family: FamilyDoc): { days: number; clause: { quote: string; page: number } | null; source: "rule" | "default" } {
  if (rule?.reimburseWithinDays) {
    const q = rule.supportingQuotes?.find((s) => s.field === "reimburseWithinDays");
    return { days: rule.reimburseWithinDays, clause: q ? { quote: q.quote, page: q.page } : { quote: rule.quote, page: rule.page }, source: "rule" };
  }
  return { days: family.settings?.dueDays || DEFAULT_DUE_DAYS, clause: null, source: "default" };
}

type LinkOut = { token?: string };

/**
 * Every email to the paying parent carries a new payment link (the plain token is never stored).
 * Earlier links stay valid until they expire, so a link the payer is using keeps working; all of
 * them are revoked when the claim is waived or the expense is cancelled.
 */
function paymentLinkWriter(familyId: string, expenseId: string, createdBy: string, out: LinkOut) {
  return {
    // Nothing to read: earlier links stay valid (kept so every caller has the same read/write shape).
    read: async () => undefined,
    write: (tx: Transaction, payer: Party) => {
      const link = createLinkTokenInTx(tx, {
        familyId,
        purpose: "payment",
        resourcePath: paymentPath(expenseId),
        recipientEmail: payer.email,
        recipientRole: payer.role,
        allowedActions: [...PAYMENT_ACTIONS],
        createdBy,
      });
      out.token = link.token;
    },
  };
}

function payerUrl(expenseId: string, token: string | undefined) {
  // A signed-in co-parent can use the app; a guest uses the link.
  return token ? appUrl(`/p/${token}`) : appUrl(`/app/expenses/${expenseId}`);
}

export type ClaimSent = { link: string; dueAt: string; owedCents: number; dueClause: { quote: string; page: number } | null; email: { status: "sent" | "failed" } };

/** POST /api/expenses/:id/payment-request: READY -> AWAITING_PAYMENT with dueAt and owedCents. */
export async function sendPaymentRequest(ctx: FamilyContext, expenseId: string, meta: Meta = {}): Promise<ClaimSent> {
  const e = await loadFamilyExpense(ctx, expenseId, meta.requestId);
  requireReceiver(ctx, e);
  await requireVerified(ctx.user);
  const payer = party(ctx.family, e.owedByRole);
  const receiver = party(ctx.family, e.paidByRole);
  if (!payer.email) throw new AppError("STATE_CONFLICT", "Add the other parent's email in Settings first.");
  const rv = await loadRuleVersion(e.ruleVersionId);
  const rule = rv?.rules.find((r) => r.id === e.verdict.ruleId) ?? null;
  const terms = dueTerms(rule, ctx.family);
  const at = now();
  const dueAt = new Date(at.getTime() + terms.days * DAY_MS);
  const owedCents = e.verdict.owedShareCents;
  const out: LinkOut = {};
  const links = paymentLinkWriter(ctx.familyId, expenseId, ctx.user.uid, out);
  let key = "";

  await transition({
    expenseId,
    machine: "settlement",
    event: "SEND_PAYMENT_REQUEST",
    actor: actorOf(ctx),
    payload: { owedCents, dueAt, extra: { dueDay: dueAt.toISOString().slice(0, 10) } },
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
    loadFacts: async (tx, current) => {
      if (current.receiptId) {
        const r = (await tx.get(db().collection("receipts").doc(current.receiptId))).data() as ReceiptDoc | undefined;
        if (!r?.confirmed) throw new AppError("STATE_CONFLICT", "Confirm the receipt before sending the payment request.");
      }
      await links.read();
      return {};
    },
    notify: ({ version }) => {
      key = dedupeKey("payment_request", expenseId, version);
      return [
        {
          dedupeKey: key, familyId: ctx.familyId, toUid: payer.uid, toEmail: payer.email, type: "payment_request", expenseId,
          title: `${receiver.firstName} asks for ${formatCents(owedCents)}`, body: `${e.description}. Due ${dueAt.toISOString().slice(0, 10)}.`,
          link: payer.uid ? `/app/expenses/${expenseId}` : undefined, sendEmail: true,
        },
      ];
    },
    extraWrites: (tx) => links.write(tx, payer),
  });

  const tz = await familyTimeZone(ctx.family);
  const url = payerUrl(expenseId, out.token);
  const child = ctx.family.children.find((c) => c.id === e.childId)?.firstName ?? "your child";
  const delivery = await deliverNotificationEmail({
    dedupeKey: key,
    to: payer.email,
    replyTo: receiver.email,
    email: paymentRequestEmail({
      receiverName: receiver.name, childName: child, description: e.description, owedCents, dueOn: formatDayIn(tz, dueAt),
      dueClause: terms.clause ? `Your agreement gives ${terms.days} days to reimburse (p. ${terms.clause.page}).` : null,
      url, footer: footerForRole(ctx.family, payer.role),
    }),
    requestId: meta.requestId,
  });
  return { link: url, dueAt: dueAt.toISOString(), owedCents, dueClause: terms.clause, email: { status: delivery.ok ? "sent" : "failed" } };
}

type ReminderSpec = { kind: ReminderKind; actor: Actor; createdBy: string; requestId?: string; ip?: string | null; userAgent?: string | null };

/**
 * Records one reminder and emails it with a fresh payment link. Used by the manual reminder
 * (72-hour gap, CL-5) and the daily job (due soon, overdue day 1/8/15; dedupe per kind, CL-10).
 * Returns null when this reminder was already sent.
 */
export async function issueReminder(expenseId: string, spec: ReminderSpec): Promise<{ email: { status: "sent" | "failed" }; link: string } | null> {
  const expenseRef = db().collection("expenses").doc(expenseId);
  const out: LinkOut = {};
  const key = dedupeKey(spec.kind === "manual" ? "payment_reminder_manual" : spec.kind === "due_soon" ? "payment_due_soon" : "payment_overdue", expenseId, spec.kind);
  const res = await db().runTransaction(async (tx) => {
    const e = (await tx.get(expenseRef)).data() as ExpenseDoc;
    const family = (await tx.get(db().collection("families").doc(e.familyId))).data() as FamilyDoc;
    const at = now();
    if (!OPEN_FOR_REMINDER.has(e.settlement.state)) throw new AppError("STATE_CONFLICT", "There is no open payment request to remind about.");
    const reminders = e.settlement.reminders ?? [];
    if (spec.kind === "manual") {
      const last = reminders.filter((r) => r.kind === "manual").reduce((m, r) => Math.max(m, r.at.toMillis()), 0);
      if (last && at.getTime() - last < MANUAL_REMINDER_GAP_MS) {
        throw new AppError("RATE_LIMITED", "You can send a reminder once every 72 hours.", { retryAfterSeconds: Math.ceil((last + MANUAL_REMINDER_GAP_MS - at.getTime()) / 1000) });
      }
    } else if (reminders.some((r) => r.kind === spec.kind)) {
      return null;
    }
    const payer = party(family, e.owedByRole);
    const receiver = party(family, e.paidByRole);
    const links = paymentLinkWriter(e.familyId, expenseId, spec.createdBy, out);
    await links.read();
    const notifKey = spec.kind === "manual" ? dedupeKey("payment_reminder_manual", expenseId, e.version + 1) : key;
    const notif: NotificationInput = {
      dedupeKey: notifKey, familyId: e.familyId, toUid: payer.uid, toEmail: payer.email,
      type: spec.kind === "manual" ? "payment_reminder_manual" : spec.kind === "due_soon" ? "payment_due_soon" : "payment_overdue",
      expenseId, title: spec.kind === "manual" ? `Reminder from ${receiver.firstName}` : spec.kind === "due_soon" ? "Payment due soon" : "Payment overdue",
      body: `${e.description}: ${formatCents(e.settlement.owedCents ?? 0)}.`, link: payer.uid ? `/app/expenses/${expenseId}` : undefined, sendEmail: true,
    };
    const fresh = await filterNewNotifications(tx, [notif]);
    if (fresh.length === 0) return null; // already sent by an earlier run (CL-10)
    // ---- writes ----
    const t = Timestamp.fromDate(at);
    links.write(tx, payer);
    tx.update(expenseRef, { "settlement.reminders": FieldValue.arrayUnion({ kind: spec.kind, at: t }), version: e.version + 1, updatedAt: t });
    tx.create(expenseRef.collection("events").doc(), { type: `reminder.${spec.kind}`, machine: "note", actor: { kind: spec.actor.kind, uid: spec.actor.uid }, data: { event: "REMIND", kind: spec.kind }, at: t });
    auditInTx(tx, { familyId: e.familyId, actor: spec.actor, action: `claim.remind.${spec.kind}`, target: `expenses/${expenseId}`, ip: spec.ip, userAgent: spec.userAgent });
    writeNotifications(tx, fresh);
    return { e, family, payer, receiver, notifKey };
  });
  if (!res) return null;
  const tz = await familyTimeZone(res.family);
  const due = res.e.settlement.dueAt ? res.e.settlement.dueAt.toDate() : now();
  const overdueDays = Math.max(1, Math.floor((now().getTime() - due.getTime()) / DAY_MS) + 1);
  const url = payerUrl(expenseId, out.token);
  const delivery = await deliverNotificationEmail({
    dedupeKey: res.notifKey,
    to: res.payer.email,
    replyTo: res.receiver.email,
    email: paymentReminderEmail({
      kind: spec.kind === "manual" ? "manual" : spec.kind === "due_soon" ? "due_soon" : "overdue",
      receiverName: res.receiver.name, description: res.e.description, owedCents: res.e.settlement.owedCents ?? 0, dueOn: formatDayIn(tz, due),
      overdueDays: spec.kind.startsWith("overdue") ? overdueDays : undefined, url, footer: footerForRole(res.family, res.payer.role),
    }),
    requestId: spec.requestId,
  });
  return { email: { status: delivery.ok ? "sent" : "failed" }, link: url };
}

/** POST /api/expenses/:id/remind (owed parent, once per 72 hours). */
export async function remindPayer(ctx: FamilyContext, expenseId: string, meta: Meta = {}) {
  const e = await loadFamilyExpense(ctx, expenseId, meta.requestId);
  requireReceiver(ctx, e);
  const r = await issueReminder(expenseId, { kind: "manual", actor: actorOf(ctx), createdBy: ctx.user.uid, ...meta });
  if (!r) throw new AppError("RATE_LIMITED", "A reminder was just sent.", { retryAfterSeconds: 3600 });
  return r;
}

/** Notifies the paying parent with a fresh link after a manual resolution. Writes happen in the transition. */
function payerNotice(familyId: string, expenseId: string, createdBy: string, type: "marked_received" | "external_payment_confirmed" | "external_payment_rejected", out: LinkOut) {
  const links = paymentLinkWriter(familyId, expenseId, createdBy, out);
  let key = "";
  return {
    key: () => key,
    loadFacts: async () => {
      await links.read();
      return {};
    },
    notify: (payer: Party, receiver: Party, e: ExpenseDoc, version: number): NotificationInput[] => {
      key = dedupeKey(type, expenseId, version);
      const title =
        type === "external_payment_rejected" ? `${receiver.firstName} did not confirm your payment` : type === "marked_received" ? `${receiver.firstName} marked your share as received` : `${receiver.firstName} confirmed your payment`;
      return [{ dedupeKey: key, familyId, toUid: payer.uid, toEmail: payer.email, type, expenseId, title, body: `${e.description}: ${formatCents(e.settlement.owedCents ?? 0)}.`, link: payer.uid ? `/app/expenses/${expenseId}` : undefined, sendEmail: true }];
    },
    writeLink: (tx: Transaction, payer: Party) => links.write(tx, payer),
  };
}

async function emailPayerOutcome(family: FamilyDoc, e: ExpenseDoc, expenseId: string, key: string, token: string | undefined, outcome: "confirmed" | "rejected" | "marked_received", requestId?: string) {
  const payer = party(family, e.owedByRole);
  const receiver = party(family, e.paidByRole);
  const tz = await familyTimeZone(family);
  const fresh = (await db().collection("expenses").doc(expenseId).get()).data() as ExpenseDoc;
  await deliverNotificationEmail({
    dedupeKey: key,
    to: payer.email,
    replyTo: receiver.email,
    email: externalResolvedEmail({
      receiverName: receiver.name, description: e.description, owedCents: e.settlement.owedCents ?? 0, outcome,
      contestUntilOn: fresh.settlement.contestUntil ? formatDayIn(tz, fresh.settlement.contestUntil.toDate()) : undefined,
      url: payerUrl(expenseId, token), footer: footerForRole(family, payer.role),
    }),
    requestId,
  });
}

/**
 * POST /api/expenses/:id/mark-received: SETTLED_EXTERNALLY, payer may contest for 7 days.
 * While the payer's own report is pending this confirms it instead (one event, not two).
 */
export async function markReceived(ctx: FamilyContext, expenseId: string, meta: Meta = {}) {
  const e = await loadFamilyExpense(ctx, expenseId, meta.requestId);
  requireReceiver(ctx, e);
  const event = e.settlement.state === "EXTERNAL_PAYMENT_REPORTED" ? ("CONFIRM_EXTERNAL" as const) : ("MARK_RECEIVED" as const);
  const type = event === "CONFIRM_EXTERNAL" ? "external_payment_confirmed" : "marked_received";
  const out: LinkOut = {};
  const notice = payerNotice(ctx.familyId, expenseId, ctx.user.uid, type, out);
  const payer = party(ctx.family, e.owedByRole);
  const receiver = party(ctx.family, e.paidByRole);
  const res = await transition({
    expenseId, machine: "settlement", event, actor: actorOf(ctx), requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent,
    loadFacts: () => notice.loadFacts(),
    notify: ({ expense, version }) => notice.notify(payer, receiver, expense, version),
    extraWrites: (tx) => notice.writeLink(tx, payer),
  });
  if (res.outcome === "applied") await emailPayerOutcome(ctx.family, e, expenseId, notice.key(), out.token, event === "CONFIRM_EXTERNAL" ? "confirmed" : "marked_received", meta.requestId);
  return { state: res.to };
}

/** POST /api/expenses/:id/external-report/:action (owed parent): confirm or reject the payer's report. */
export async function resolveExternalReport(ctx: FamilyContext, expenseId: string, action: "confirm" | "reject", meta: Meta = {}) {
  const e = await loadFamilyExpense(ctx, expenseId, meta.requestId);
  requireReceiver(ctx, e);
  const event = action === "confirm" ? ("CONFIRM_EXTERNAL" as const) : ("REJECT_EXTERNAL" as const);
  const type = action === "confirm" ? "external_payment_confirmed" : "external_payment_rejected";
  const out: LinkOut = {};
  const notice = payerNotice(ctx.familyId, expenseId, ctx.user.uid, type, out);
  const payer = party(ctx.family, e.owedByRole);
  const receiver = party(ctx.family, e.paidByRole);
  const res = await transition({
    expenseId, machine: "settlement", event, actor: actorOf(ctx), requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent,
    loadFacts: () => notice.loadFacts(),
    notify: ({ expense, version }) => notice.notify(payer, receiver, expense, version),
    extraWrites: (tx) => notice.writeLink(tx, payer),
  });
  if (res.outcome === "applied") await emailPayerOutcome(ctx.family, e, expenseId, notice.key(), out.token, action === "confirm" ? "confirmed" : "rejected", meta.requestId);
  return { state: res.to };
}

/** POST /api/expenses/:id/waive (owed parent): WAIVED, reason required (CL-9). Payment links are revoked. */
export async function waiveClaim(ctx: FamilyContext, expenseId: string, reason: string, meta: Meta = {}) {
  const e = await loadFamilyExpense(ctx, expenseId, meta.requestId);
  requireReceiver(ctx, e);
  let stale: string[] = [];
  const res = await transition({
    expenseId, machine: "settlement", event: "WAIVE", actor: actorOf(ctx), payload: { reason }, requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent,
    loadFacts: async (tx) => {
      stale = await findUsableTokensFor(tx, ctx.familyId, [paymentPath(expenseId)]);
      return {};
    },
    extraWrites: (tx) => revokeTokensInTx(tx, stale),
  });
  return { state: res.to };
}

export type ExternalReportInput = { method: string; date: string; note?: string };

async function paymentLinkContext(token: string) {
  if (!isWellFormedToken(token)) throw new AppError("NOT_FOUND", "This link is not valid.");
  const tokenHash = hashToken(token);
  const { link } = await resolveLinkHash(tokenHash);
  if (link.purpose !== "payment" || !link.resourcePath.startsWith("expenses/")) throw new AppError("NOT_FOUND", "This link is not a payment link.");
  return { tokenHash, link, expenseId: link.resourcePath.slice("expenses/".length) };
}

/** POST /api/links/:token/report-external (payer via link + code): still outstanding until confirmed (CL-6). */
export async function reportExternalPayment(token: string, input: ExternalReportInput, auth: { linkSession: { tokenHash: string } | null; user: SessionUser | null }, meta: Meta = {}) {
  const { tokenHash, link, expenseId } = await paymentLinkContext(token);
  assertAction(link, "report_external");
  const actor = await requireLinkActor(auth, tokenHash, link);
  if (dateFromIso(input.date).getTime() > now().getTime() + DAY_MS) {
    throw new AppError("INVALID", "The payment date cannot be in the future.", { details: { fields: [{ path: "body.date", message: "Cannot be in the future" }] } });
  }
  const family = (await db().collection("families").doc(link.familyId).get()).data() as FamilyDoc;
  let key = "";
  const res = await transition({
    expenseId, machine: "settlement", event: "REPORT_EXTERNAL_PAYMENT", actor,
    payload: { externalReport: { by: actor.kind, method: input.method, date: dateFromIso(input.date), ...(input.note ? { note: input.note } : {}) }, extra: { method: input.method } },
    requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent,
    loadFacts: async (tx) => {
      const l = (await tx.get(db().collection("linkTokens").doc(tokenHash))).data() as LinkTokenDoc;
      if (l.revokedAt || l.usedAt) throw new AppError("LINK_GONE", "This link was replaced by a newer email.", { details: { reason: "revoked", purpose: "payment" } });
      return {};
    },
    notify: ({ expense, version }) => {
      const receiver = party(family, expense.paidByRole);
      key = dedupeKey("external_payment_reported", expenseId, version);
      return [{ dedupeKey: key, familyId: link.familyId, toUid: receiver.uid, toEmail: receiver.email, type: "external_payment_reported", expenseId, title: `${party(family, expense.owedByRole).firstName} says they paid you`, body: `${expense.description}: ${formatCents(expense.settlement.owedCents ?? 0)} by ${input.method}. Confirm when you see it.`, link: `/app/expenses/${expenseId}`, sendEmail: true }];
    },
  });
  if (res.outcome === "applied") {
    const e = (await db().collection("expenses").doc(expenseId).get()).data() as ExpenseDoc;
    const tz = await familyTimeZone(family);
    const receiver = party(family, e.paidByRole);
    await deliverNotificationEmail({
      dedupeKey: key, to: receiver.email, replyTo: party(family, e.owedByRole).email,
      email: externalReportedEmail({ payerName: party(family, e.owedByRole).name, description: e.description, owedCents: e.settlement.owedCents ?? 0, method: input.method, dateOn: formatDayIn(tz, dateFromIso(input.date)), url: appUrl(`/app/expenses/${expenseId}`), footer: footerForRole(family, receiver.role) }),
      requestId: meta.requestId,
    });
  }
  return { state: res.to };
}

export type PaymentLinkSummary = {
  purpose: "payment";
  expenseId: string;
  receiverName: string;
  payerName: string;
  childName: string;
  description: string;
  vendor: string | null;
  owedCents: number;
  receiptTotalCents: number | null;
  approvedCents: number | null;
  owedPct: number | null;
  clause: { label: string; quote: string; page: number } | null;
  dueAt: string | null;
  dueClause: { quote: string; page: number } | null;
  overdue: boolean;
  dueSoon: boolean;
  state: SettlementState;
  externalReport: { method: string; date: string | null; note: string | null } | null;
  contestUntil: string | null;
  canReport: boolean;
  canDispute: boolean;
  receipt: { id: string; mimeType: string } | null;
  dispute: { status: DisputeDoc["status"]; rounds: { by: Role; reason: string; proposedCents: number | null; at: string }[]; yourTurn: boolean } | null;
  sentTo: string;
  canAct: boolean;
  /** In-app PayPal payment (Family plan, Section G.3). */
  inApp: {
    available: boolean;
    breakdown: FeeBreakdown | null;
    /** A capture is waiting at PayPal (PY-8). */
    pending: boolean;
    /** After payment: what is happening with the money. */
    payout: "waiting_connection" | "sending" | "unclaimed" | "failed" | "refunded" | "sent" | null;
  };
};

/** GET /api/links/:token for a payment link: the claim, the clause and what the payer can do. */
export async function paymentLinkSummary(tokenHash: string, link: LinkTokenDoc, auth: { linkSession: { tokenHash: string } | null; user: SessionUser | null }): Promise<PaymentLinkSummary> {
  const expenseId = link.resourcePath.slice("expenses/".length);
  const [eSnap, fSnap, dSnap] = await Promise.all([
    db().collection("expenses").doc(expenseId).get(),
    db().collection("families").doc(link.familyId).get(),
    db().collection("disputes").doc(expenseId).get(),
  ]);
  const e = eSnap.data() as ExpenseDoc;
  const family = fSnap.data() as FamilyDoc;
  const rv = await loadRuleVersion(e.ruleVersionId);
  const rule = rv?.rules.find((r) => r.id === e.verdict.ruleId) ?? null;
  const receipt = e.receiptId ? ((await db().collection("receipts").doc(e.receiptId).get()).data() as ReceiptDoc | undefined) : undefined;
  const at = now();
  const canAct = await requireLinkActor(auth, tokenHash, link).then(() => true, () => false);
  const [entitled, paySnap] = await Promise.all([familyEntitled(link.familyId), db().collection("payments").doc(expenseId).get()]);
  const pay = paySnap.data() as PaymentDoc | undefined;
  const payable = e.settlement.state === "AWAITING_PAYMENT" || e.settlement.state === "PAYMENT_FAILED";
  const owedNow = e.settlement.owedCents ?? e.verdict.owedShareCents;
  const dispute = dSnap.exists ? (dSnap.data() as DisputeDoc) : null;
  const terms = dueTerms(rule, family);
  const st = e.settlement;
  const lastBy = dispute?.rounds[dispute.rounds.length - 1]?.by;
  return {
    purpose: "payment",
    expenseId,
    receiverName: party(family, e.paidByRole).name,
    payerName: party(family, e.owedByRole).firstName,
    childName: family.children.find((c) => c.id === e.childId)?.firstName ?? "your child",
    description: e.description,
    vendor: e.vendor ?? null,
    owedCents: st.owedCents ?? e.verdict.owedShareCents,
    receiptTotalCents: receipt?.confirmed?.totalCents ?? null,
    approvedCents: e.approval.approvedCents ?? null,
    owedPct: rule && !rule.sharesNonNumeric ? rule.owedPct : null,
    clause: rule ? { label: rule.label, quote: rule.quote, page: rule.page } : null,
    dueAt: st.dueAt ? st.dueAt.toDate().toISOString() : null,
    dueClause: terms.clause,
    overdue: isOverdue(st, at),
    dueSoon: isDueSoon(st, at),
    state: st.state,
    externalReport: st.externalReport ? { method: st.externalReport.method, date: isoFromTs(st.externalReport.date), note: st.externalReport.note ?? null } : null,
    contestUntil: st.contestUntil ? st.contestUntil.toDate().toISOString() : null,
    canReport: st.state === "AWAITING_PAYMENT",
    canDispute: st.state === "AWAITING_PAYMENT" || (st.state === "SETTLED_EXTERNALLY" && (toMs(st.contestUntil) ?? 0) > at.getTime()),
    receipt: e.receiptId && receipt ? { id: e.receiptId, mimeType: receipt.mimeType } : null,
    dispute: dispute
      ? {
          status: dispute.status,
          rounds: dispute.rounds.map((r) => ({ by: r.by, reason: r.reason, proposedCents: r.proposedCents ?? null, at: r.at.toDate().toISOString() })),
          yourTurn: dispute.status === "OPEN" && st.state === "DISPUTED" && lastBy !== link.recipientRole,
        }
      : null,
    sentTo: maskEmail(link.recipientEmail),
    canAct,
    inApp: {
      available: entitled && payable,
      breakdown: entitled && payable && owedNow > 0 ? await breakdownFor(link.familyId, owedNow) : null,
      pending: pay?.captureStatus === "PENDING",
      payout: payoutPhase(e, family),
    },
  };
}

function payoutPhase(e: ExpenseDoc, family: FamilyDoc): PaymentLinkSummary["inApp"]["payout"] {
  switch (e.settlement.state) {
    case "PAID":
      return family.payout?.[e.paidByRole] ? "sending" : "waiting_connection";
    case "PAYOUT_PROCESSING":
      return "sending";
    case "PAYOUT_UNCLAIMED":
      return "unclaimed";
    case "PAYOUT_FAILED":
      return "failed";
    case "REFUNDED":
      return "refunded";
    case "SETTLED":
      return "sent";
    default:
      return null;
  }
}

export function isClosedClaim(state: SettlementState) {
  return SETTLEMENT_TERMINAL.has(state) || state === "SETTLED_EXTERNALLY";
}
