import "server-only";
import { auditInTx } from "@/lib/audit";
import type { FamilyContext } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { inviteEmail } from "@/lib/email/templates/invite";
import { db, FieldValue } from "@/lib/firebase/admin";
import { createLinkTokenInTx, findActiveTokens, INVITE_ACTIONS, revokeTokensInTx } from "@/lib/links/tokens";
import { dedupeKey, deliverNotificationEmail, writeNotifications } from "@/lib/notifications";
import type { FamilyDoc } from "@/types/firestore";

// Co-parent invite (Section A.5.2). Sending is required to finish onboarding; acceptance is not.
// Resend revokes the old token atomically (LK-9). An email failure never blocks the step (ON-7):
// the owner always gets the copyable link in the response.

export type InviteResult = { link: string; expiresAt: string; email: { status: "sent" | "failed" } };

export async function sendInvite(
  ctx: FamilyContext,
  opts: { resend: boolean; requestId: string; ip?: string | null; userAgent?: string | null },
): Promise<InviteResult> {
  const familyRef = db().collection("families").doc(ctx.familyId);

  const out = await db().runTransaction(async (tx) => {
    const family = (await tx.get(familyRef)).data() as FamilyDoc;
    if (!family.coParent.email || !family.coParent.name) throw new AppError("STATE_CONFLICT", "Add the other parent's name and email first.");
    if (family.coParent.email === family.owner.email.toLowerCase()) throw new AppError("INVALID", "The other parent's email must be different from yours.");
    if (family.coParent.inviteStatus === "accepted") throw new AppError("STATE_CONFLICT", "The other parent already accepted the invite.");

    const active = await findActiveTokens(tx, ctx.familyId, "invite");
    if (active.length > 0 && !opts.resend) {
      throw new AppError("STATE_CONFLICT", "An invite is already active. Use resend to send a new link.");
    }

    // Dedupe key per token, so a resend is a new notification and a retried request is not.
    const notif = {
      familyId: ctx.familyId,
      toEmail: family.coParent.email,
      type: "invite" as const,
      title: `${family.owner.name} invited you`,
      body: "Review the expense rules and accept the invitation.",
      sendEmail: true,
    };

    // ---- writes ----
    revokeTokensInTx(tx, active);
    const created = createLinkTokenInTx(tx, {
      familyId: ctx.familyId,
      purpose: "invite",
      resourcePath: `families/${ctx.familyId}`,
      recipientEmail: family.coParent.email,
      recipientRole: "coparent",
      allowedActions: [...INVITE_ACTIONS],
      createdBy: ctx.user.uid,
    });
    // The key contains the new token's hash prefix, so it is always new (no dedupe read needed).
    const key = dedupeKey("invite", ctx.familyId, created.tokenHash.slice(0, 16));
    writeNotifications(tx, [{ ...notif, dedupeKey: key }]);
    tx.update(familyRef, { "coParent.inviteStatus": "sent", updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, {
      familyId: ctx.familyId,
      actor: { kind: "owner", uid: ctx.user.uid },
      action: opts.resend ? "invite.resend" : "invite.send",
      target: `linkTokens/${created.tokenHash}`,
      ip: opts.ip,
      userAgent: opts.userAgent,
    });
    return { ...created, key, family };
  });

  const url = `${env().APP_URL}/r/${out.token}`;
  const delivery = await deliverNotificationEmail({
    dedupeKey: out.key,
    to: out.family.coParent.email,
    replyTo: out.family.owner.email,
    email: inviteEmail({
      ownerName: out.family.owner.name,
      coParentName: out.family.coParent.name,
      childNames: out.family.children.map((c) => c.firstName),
      url,
    }),
    requestId: opts.requestId,
  });

  return { link: url, expiresAt: out.expiresAt.toISOString(), email: { status: delivery.ok ? "sent" : "failed" } };
}

/** DELETE /api/family/invite: revoke the active invite. */
export async function revokeInvite(ctx: FamilyContext, opts: { ip?: string | null; userAgent?: string | null }): Promise<{ revoked: number }> {
  const familyRef = db().collection("families").doc(ctx.familyId);
  return db().runTransaction(async (tx) => {
    const family = (await tx.get(familyRef)).data() as FamilyDoc;
    if (family.coParent.inviteStatus === "accepted") throw new AppError("STATE_CONFLICT", "The invite was already accepted.");
    const active = await findActiveTokens(tx, ctx.familyId, "invite");
    revokeTokensInTx(tx, active);
    tx.update(familyRef, { "coParent.inviteStatus": "not_sent", updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, { familyId: ctx.familyId, actor: { kind: "owner", uid: ctx.user.uid }, action: "invite.revoke", target: `families/${ctx.familyId}`, ...opts });
    return { revoked: active.length };
  });
}
