import "server-only";
import { audit, auditInTx } from "@/lib/audit";
import { actorOf, requireFamily, type SessionUser } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { disputeUpdateEmail } from "@/lib/email/templates/payment";
import { AppError } from "@/lib/errors";
import { db, Timestamp } from "@/lib/firebase/admin";
import { PAYMENT_ACTIONS } from "@/lib/claims";
import { assertAction, createLinkTokenInTx, resolveLinkHash } from "@/lib/links/tokens";
import { dedupeKey, deliverNotificationEmail, filterNewNotifications, writeNotifications } from "@/lib/notifications";
import { appUrl, footerForRole, party } from "@/lib/parties";
import { transition } from "@/lib/state/transition";
import type { Actor, DisputeDoc, DisputeRound, ExpenseDoc, FamilyDoc, Role } from "@/types/firestore";

// Disputes [Should] (Section A.5.4, E.6.2): the paying parent disputes a claim; the parents answer
// each other at most twice; without agreement the claim closes as UNRESOLVED with the full record.
// Settlement state changes go through transition(); the thread lives in disputes/{expenseId}.

export const MAX_RESPONSES = 2;
type Meta = { requestId?: string; ip?: string | null; userAgent?: string | null };
type Auth = { user: SessionUser | null; linkSession: { tokenHash: string } | null };

function disputeRef(expenseId: string) {
  return db().collection("disputes").doc(expenseId);
}

/** Who is acting on this claim: a signed-in member, or the payer through the payment link session. */
async function claimActor(expenseId: string, auth: Auth, requestId?: string): Promise<{ actor: Actor; role: Role; e: ExpenseDoc; family: FamilyDoc }> {
  const eSnap = await db().collection("expenses").doc(expenseId).get();
  if (!eSnap.exists) throw new AppError("NOT_FOUND", "Expense not found.");
  const e = eSnap.data() as ExpenseDoc;
  const family = (await db().collection("families").doc(e.familyId).get()).data() as FamilyDoc;
  if (auth.user) {
    const ctx = await requireFamily(auth.user).catch(() => null);
    if (ctx && ctx.familyId === e.familyId) {
      const actor = actorOf(ctx);
      return { actor, role: actor.kind, e, family };
    }
    if (ctx) {
      await audit({ familyId: ctx.familyId, actor: actorOf(ctx), action: "forbidden.dispute", target: `expenses/${expenseId}` }, requestId);
      throw new AppError("FORBIDDEN", "You do not have access to this expense.");
    }
  }
  if (auth.linkSession) {
    const { link } = await resolveLinkHash(auth.linkSession.tokenHash);
    if (link.purpose === "payment" && link.resourcePath === `expenses/${expenseId}`) {
      assertAction(link, "dispute");
      return { actor: { kind: link.recipientRole, tokenHash: auth.linkSession.tokenHash }, role: link.recipientRole, e, family };
    }
  }
  if (!auth.user && !auth.linkSession) throw new AppError("UNAUTHENTICATED", "Please sign in, or open the link from the email.");
  throw new AppError("FORBIDDEN", "You cannot act on this claim.");
}

async function notifyOther(family: FamilyDoc, e: ExpenseDoc, expenseId: string, from: Role, event: "opened" | "reply" | "agreed" | "unresolved", version: number, round?: { reason?: string; proposedCents?: number }, requestId?: string) {
  const to = party(family, from === "owner" ? "coparent" : "owner");
  const sender = party(family, from);
  const key = dedupeKey("dispute_update", expenseId, version);
  // Created on its own (after the state change); the dedupe key makes a retry harmless.
  const input = {
    dedupeKey: key, familyId: e.familyId, toUid: to.uid, toEmail: to.email, type: "dispute_update" as const, expenseId,
    title: event === "opened" ? `${sender.firstName} disputes ${e.description}` : event === "reply" ? `${sender.firstName} replied about ${e.description}` : event === "agreed" ? `Agreed: ${e.description}` : `No agreement: ${e.description}`,
    body: round?.reason?.slice(0, 140) ?? "", link: to.uid ? `/app/expenses/${expenseId}` : undefined, sendEmail: true,
  };
  // A guest paying parent has no account: the email carries a fresh payment link.
  const guestPayer = to.role === e.owedByRole && !to.uid;
  const out = await db().runTransaction(async (tx) => {
    const f = await filterNewNotifications(tx, [input]);
    if (f.length === 0) return { fresh: f, token: undefined };
    writeNotifications(tx, f);
    if (!guestPayer) return { fresh: f, token: undefined };
    const link = createLinkTokenInTx(tx, { familyId: e.familyId, purpose: "payment", resourcePath: `expenses/${expenseId}`, recipientEmail: to.email, recipientRole: to.role, allowedActions: [...PAYMENT_ACTIONS], createdBy: family.ownerUid });
    return { fresh: f, token: link.token };
  });
  if (out.fresh.length === 0) return;
  await deliverNotificationEmail({
    dedupeKey: key, to: to.email, replyTo: sender.email,
    email: disputeUpdateEmail({ fromName: sender.name, description: e.description, event, reason: round?.reason, proposedCents: round?.proposedCents ?? null, url: out.token ? appUrl(`/p/${out.token}`) : appUrl(`/app/expenses/${expenseId}`), footer: footerForRole(family, to.role) }),
    requestId,
  });
}

/** POST /api/expenses/:id/dispute (paying parent: signed in, or via the payment link + code). */
export async function openDispute(expenseId: string, input: { reason: string; proposedCents?: number }, auth: Auth, meta: Meta = {}) {
  const { actor, role, e, family } = await claimActor(expenseId, auth, meta.requestId);
  if (role !== e.owedByRole) throw new AppError("FORBIDDEN", "Only the parent who was asked to pay can dispute the claim.");
  if (input.proposedCents !== undefined && input.proposedCents >= (e.settlement.owedCents ?? e.verdict.owedShareCents)) {
    throw new AppError("INVALID", "A proposed amount must be less than the claim.", { details: { fields: [{ path: "body.proposedCents", message: "Must be less than the claim" }] } });
  }
  const res = await transition({
    expenseId, machine: "settlement", event: "DISPUTE", actor, payload: { reason: input.reason }, requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent,
    extraWrites: (tx, { expense }) => {
      const t = Timestamp.fromDate(now());
      const round: DisputeRound = { by: role, reason: input.reason.trim().slice(0, 1000), ...(input.proposedCents !== undefined ? { proposedCents: input.proposedCents } : {}), at: t };
      const doc: DisputeDoc = { familyId: expense.familyId, memberUids: expense.memberUids, expenseId, openedBy: role, openedFrom: expense.settlement.state, rounds: [round], status: "OPEN", createdAt: t, updatedAt: t };
      tx.set(disputeRef(expenseId), doc);
    },
  });
  if (res.outcome === "applied") await notifyOther(family, e, expenseId, role, "opened", res.version, input, meta.requestId);
  return { state: res.to };
}

/**
 * POST /api/disputes/:id/respond. The parents take turns. "agree" accepts the other parent's latest
 * proposal (or the original amount) and reopens the claim; "counter" answers. After two answers
 * without agreement the claim is UNRESOLVED (CL-11).
 */
export async function respondDispute(expenseId: string, input: { action: "agree" | "counter"; reason?: string; proposedCents?: number }, auth: Auth, meta: Meta = {}) {
  const { actor, role, e, family } = await claimActor(expenseId, auth, meta.requestId);
  const snap = await disputeRef(expenseId).get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "There is no dispute on this claim.");
  const d = snap.data() as DisputeDoc;
  if (d.status !== "OPEN" || e.settlement.state !== "DISPUTED") throw new AppError("STATE_CONFLICT", "This dispute is already closed.");
  const last = d.rounds[d.rounds.length - 1];
  if (last.by === role) throw new AppError("STATE_CONFLICT", "Wait for the other parent to answer.");

  if (input.action === "agree") {
    const revised = last.proposedCents;
    const res = await transition({
      expenseId, machine: "settlement", event: "DISPUTE_AGREED", actor, payload: revised !== undefined ? { revisedOwedCents: revised } : {}, requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent,
      loadFacts: async (tx) => {
        const cur = (await tx.get(disputeRef(expenseId))).data() as DisputeDoc;
        if (cur.rounds.length !== d.rounds.length) throw new AppError("STATE_CONFLICT", "The dispute changed. Refresh and try again.");
        return { disputeRounds: cur.rounds.length - 1 };
      },
      extraWrites: (tx) => tx.update(disputeRef(expenseId), { status: "AGREED", ...(revised !== undefined ? { agreedCents: revised } : {}), updatedAt: Timestamp.fromDate(now()) }),
    });
    if (res.outcome === "applied") await notifyOther(family, e, expenseId, role, "agreed", res.version, undefined, meta.requestId);
    return { state: res.to };
  }

  if (!input.reason?.trim()) throw new AppError("INVALID", "Write a short answer.", { details: { fields: [{ path: "body.reason", message: "Write a short answer" }] } });
  const owed = e.settlement.owedCents ?? e.verdict.owedShareCents;
  if (input.proposedCents !== undefined && input.proposedCents > owed) throw new AppError("INVALID", "A proposed amount cannot be above the claim.");
  const responses = d.rounds.length; // after this answer: rounds.length answers to the opening message
  const t = Timestamp.fromDate(now());
  const round: DisputeRound = { by: role, reason: input.reason.trim().slice(0, 1000), ...(input.proposedCents !== undefined ? { proposedCents: input.proposedCents } : {}), at: t };

  if (responses >= MAX_RESPONSES) {
    const res = await transition({
      expenseId, machine: "settlement", event: "DISPUTE_UNRESOLVED", actor, payload: { reason: round.reason }, requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent,
      loadFacts: async (tx) => {
        const cur = (await tx.get(disputeRef(expenseId))).data() as DisputeDoc;
        if (cur.rounds.length !== d.rounds.length) throw new AppError("STATE_CONFLICT", "The dispute changed. Refresh and try again.");
        return { disputeRounds: cur.rounds.length };
      },
      extraWrites: (tx) => tx.update(disputeRef(expenseId), { rounds: [...d.rounds, round], status: "UNRESOLVED", updatedAt: t }),
    });
    if (res.outcome === "applied") await notifyOther(family, e, expenseId, role, "unresolved", res.version, round, meta.requestId);
    return { state: res.to };
  }

  // A reply that is not the last one: no state change, one timeline note.
  const expenseRef = db().collection("expenses").doc(expenseId);
  const version = await db().runTransaction(async (tx) => {
    const cur = (await tx.get(disputeRef(expenseId))).data() as DisputeDoc;
    const ex = (await tx.get(expenseRef)).data() as ExpenseDoc;
    if (cur.rounds.length !== d.rounds.length || ex.settlement.state !== "DISPUTED") throw new AppError("STATE_CONFLICT", "The dispute changed. Refresh and try again.");
    tx.update(disputeRef(expenseId), { rounds: [...cur.rounds, round], updatedAt: t });
    tx.update(expenseRef, { version: ex.version + 1, updatedAt: t });
    tx.create(expenseRef.collection("events").doc(), { type: "dispute.reply", machine: "note", actor: { kind: actor.kind, uid: actor.uid }, data: { event: "DISPUTE_REPLY", ...(input.proposedCents !== undefined ? { revisedOwedCents: input.proposedCents } : {}) }, at: t });
    auditInTx(tx, { familyId: e.familyId, actor, action: "dispute.reply", target: `disputes/${expenseId}`, ip: meta.ip, userAgent: meta.userAgent });
    return ex.version + 1;
  });
  await notifyOther(family, e, expenseId, role, "reply", version, round, meta.requestId);
  return { state: "DISPUTED" as const };
}

export function disputeView(d: DisputeDoc | null) {
  if (!d) return null;
  return {
    status: d.status,
    openedBy: d.openedBy,
    agreedCents: d.agreedCents ?? null,
    rounds: d.rounds.map((r) => ({ by: r.by, reason: r.reason, proposedCents: r.proposedCents ?? null, at: r.at.toDate().toISOString() })),
  };
}
export type DisputeView = NonNullable<ReturnType<typeof disputeView>>;
