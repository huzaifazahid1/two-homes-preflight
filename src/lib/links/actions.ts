import "server-only";
import { auditInTx } from "@/lib/audit";
import { now } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { sendEmail } from "@/lib/email/send";
import { otpEmail } from "@/lib/email/templates/otp";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { log } from "@/lib/log";
import { dedupeKey, filterNewNotifications, writeNotifications } from "@/lib/notifications";
import type { FamilyDoc, LinkPurpose, LinkTokenDoc, RuleVersionDoc } from "@/types/firestore";
import { issueOtp, verifyOtp } from "./otp";
import { createLinkSession } from "./session";
import { assertAction, maskEmail, resolveLinkHash, resolveLinkToken } from "./tokens";

// Link endpoints (Section F.3): read-only summary, OTP send/verify, invite accept.
// The OTP always goes to the recipient email stored with the token, never to a typed email (LK-8).

const PURPOSE_LABEL: Record<LinkPurpose, string> = {
  invite: "accept the invitation",
  approval: "decide on the expense",
  payment: "pay your share",
};

async function loadFamily(familyId: string): Promise<FamilyDoc> {
  const snap = await db().collection("families").doc(familyId).get();
  if (!snap.exists) throw new AppError("LINK_GONE", "This link is no longer available.");
  return snap.data() as FamilyDoc;
}

async function loadActiveRules(family: FamilyDoc): Promise<RuleVersionDoc | null> {
  if (!family.activeRuleVersionId) return null;
  const snap = await db().collection("ruleVersions").doc(family.activeRuleVersionId).get();
  return snap.exists ? (snap.data() as RuleVersionDoc) : null;
}

export type InviteSummary = {
  purpose: "invite";
  ownerName: string;
  coParentName: string;
  childNames: string[];
  rules: { id: string; category: string; label: string; owedPct: number; approval: RuleVersionDoc["rules"][number]["approval"] | null; quote: string; page: number }[];
  sentTo: string;
  expiresAt: string;
  session: { active: boolean; expiresAt: string | null };
  paypal: { connected: boolean; method: string | null; email: string | null; verifiedAccount: boolean | null } | null;
};

/** GET /api/links/:token. 410 if the link is expired, used or revoked. */
export async function getLinkSummary(token: string, linkSession: { tokenHash: string; expiresAt: number } | null): Promise<InviteSummary> {
  const { tokenHash, link } = await resolveLinkToken(token);
  if (link.purpose !== "invite") throw new AppError("NOT_FOUND", "This link type is not available yet.");
  const family = await loadFamily(link.familyId);
  const rv = await loadActiveRules(family);
  const hasSession = linkSession?.tokenHash === tokenHash;
  const pp = family.payout.coparent;
  return {
    purpose: "invite",
    ownerName: family.owner.name,
    coParentName: family.coParent.name,
    childNames: family.children.map((c) => c.firstName),
    rules: (rv?.rules ?? [])
      .filter((r) => r.reviewState === "CONFIRMED" || r.reviewState === "EDITED")
      .map((r) => ({ id: r.id, category: r.category, label: r.label, owedPct: r.owedPct, approval: r.approval ?? null, quote: r.quote, page: r.page })),
    sentTo: maskEmail(link.recipientEmail),
    expiresAt: link.expiresAt.toDate().toISOString(),
    session: { active: hasSession, expiresAt: hasSession ? new Date(linkSession!.expiresAt).toISOString() : null },
    // PayPal details are personal data: only shown after the code is entered.
    paypal: hasSession
      ? { connected: Boolean(pp), method: pp?.method ?? null, email: pp?.email ?? null, verifiedAccount: pp?.verifiedAccount ?? null }
      : null,
  };
}

/** POST /api/links/:token/otp */
export async function sendLinkOtp(token: string, requestId: string): Promise<{ sentTo: string; expiresAt: string }> {
  const { tokenHash, link } = await resolveLinkToken(token);
  const family = await loadFamily(link.familyId);
  const { code, expiresAt } = await issueOtp(tokenHash);
  const result = await sendEmail({
    to: link.recipientEmail,
    email: otpEmail({ code, ownerName: family.owner.name, purposeLabel: PURPOSE_LABEL[link.purpose] }),
    requestId,
  });
  if (!result.ok) {
    log.error("otp.email_failed", { requestId, familyId: link.familyId });
    throw new AppError("UPSTREAM_FAILED", "We could not send the code right now. Please try again in a minute.");
  }
  return { sentTo: maskEmail(link.recipientEmail), expiresAt: expiresAt.toISOString() };
}

/** POST /api/links/:token/otp/verify. Returns the link session cookie value. */
export async function verifyLinkOtp(token: string, code: string): Promise<{ cookie: string; expiresAt: number }> {
  const { tokenHash } = await resolveLinkToken(token);
  await verifyOtp(tokenHash, code);
  const s = createLinkSession(tokenHash);
  return { cookie: s.value, expiresAt: s.expiresAt };
}

/** POST /api/links/:token/accept. Requires the link session for this token (checked by the caller). */
export async function acceptInvite(
  tokenHash: string,
  input: { perRule?: Record<string, "agree" | "disagree"> },
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<{ accepted: true; disagreed: number }> {
  return db().runTransaction(async (tx) => {
    const { link } = await resolveLinkHash(tokenHash, { tx });
    if (link.purpose !== "invite") throw new AppError("FORBIDDEN", "This link does not allow that action.");
    assertAction(link, "accept");

    const familyRef = db().collection("families").doc(link.familyId);
    const family = (await tx.get(familyRef)).data() as FamilyDoc | undefined;
    if (!family) throw new AppError("LINK_GONE", "This link is no longer available.");
    if (family.coParent.inviteStatus === "accepted") throw new AppError("STATE_CONFLICT", "This invitation was already accepted.");
    if (family.coParent.email !== link.recipientEmail) throw new AppError("LINK_GONE", "This invitation was replaced.");

    const rvRef = family.activeRuleVersionId ? db().collection("ruleVersions").doc(family.activeRuleVersionId) : null;
    const rv = rvRef ? ((await tx.get(rvRef)).data() as RuleVersionDoc | undefined) : undefined;
    const ruleIds = (rv?.rules ?? []).filter((r) => r.reviewState === "CONFIRMED" || r.reviewState === "EDITED").map((r) => r.id);
    const perRule: Record<string, "agree" | "disagree"> = {};
    for (const id of ruleIds) perRule[id] = input.perRule?.[id] ?? "agree";
    const disagreed = Object.values(perRule).filter((v) => v === "disagree").length;

    const notif = {
      dedupeKey: dedupeKey("invite_accepted", link.familyId, tokenHash.slice(0, 16)),
      familyId: link.familyId,
      toUid: family.ownerUid,
      toEmail: family.owner.email,
      type: "invite_accepted" as const,
      title: `${family.coParent.name} accepted your invite`,
      body: disagreed > 0 ? `They disagreed with ${disagreed} rule${disagreed === 1 ? "" : "s"}. Affected expenses will need review.` : "They agreed to all the expense rules.",
      link: "/app/settings",
      sendEmail: false,
    };
    const fresh = await filterNewNotifications(tx, [notif]);

    // ---- writes ----
    const t = Timestamp.fromDate(now());
    tx.update(familyRef, { "coParent.inviteStatus": "accepted", "coParent.acceptedAt": t, updatedAt: FieldValue.serverTimestamp() });
    if (rvRef && rv) tx.update(rvRef, { coParentAck: { at: t, perRule } });
    tx.update(db().collection("linkTokens").doc(tokenHash), { usedAt: t });
    auditInTx(tx, { familyId: link.familyId, actor: { kind: "coparent", tokenHash }, action: "invite.accept", target: `families/${link.familyId}`, ...meta });
    writeNotifications(tx, fresh);
    return { accepted: true as const, disagreed };
  });
}

/** For PayPal connect through a link session: the token must be usable and allow connect_paypal. */
export async function requireLinkForConnect(tokenHash: string): Promise<LinkTokenDoc> {
  const { link } = await resolveLinkHash(tokenHash);
  assertAction(link, "connect_paypal");
  return link;
}
