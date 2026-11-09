import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { DAY_MS, now } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { newLinkToken, sha256Hex } from "@/lib/ids";
import { linkStatus } from "@/lib/state/effective";
import type { LinkPurpose, LinkTokenDoc, Role } from "@/types/firestore";

// Link tokens (Section F.3). 32 random bytes, base64url. Only the SHA-256 hash is stored,
// as the document id of `linkTokens/{hash}`. The plain token exists only in the email and
// the response to the person who created it.

export const LINK_TTL_DAYS: Record<LinkPurpose, number> = { invite: 7, approval: 14, payment: 14 };

export const INVITE_ACTIONS = ["accept", "ack_rules", "connect_paypal"] as const;

export function hashToken(token: string): string {
  return sha256Hex(token);
}

/** Plain tokens are base64url of 32 bytes: exactly 43 chars. Anything else is not ours. */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function linkTokensCol() {
  return db().collection("linkTokens");
}

export type NewLink = {
  familyId: string;
  purpose: LinkPurpose;
  resourcePath: string;
  recipientEmail: string;
  recipientRole: Role;
  allowedActions: string[];
  createdBy: string;
};

/** Creates the token doc inside the given transaction (create() fails if the hash exists). */
export function createLinkTokenInTx(tx: Transaction, input: NewLink): { token: string; tokenHash: string; expiresAt: Date } {
  const token = newLinkToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now().getTime() + LINK_TTL_DAYS[input.purpose] * DAY_MS);
  tx.create(linkTokensCol().doc(tokenHash), {
    ...input,
    recipientEmail: input.recipientEmail.toLowerCase(),
    expiresAt: Timestamp.fromDate(expiresAt),
    usedAt: null,
    revokedAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { token, tokenHash, expiresAt };
}

export type ResolvedLink = { tokenHash: string; link: LinkTokenDoc };

const GONE_MESSAGE: Record<string, string> = {
  expired: "This link has expired.",
  used: "This link has already been used.",
  revoked: "This link was replaced or cancelled.",
};

/**
 * Resolves a plain token. 404 if unknown, 410 if expired, used or revoked (invariant 8).
 * Pass `allowUsed` only for read-only summaries that may show a "done" state.
 */
export async function resolveLinkToken(token: string, opts: { tx?: Transaction; allowUsed?: boolean } = {}): Promise<ResolvedLink> {
  if (!isWellFormedToken(token)) throw new AppError("NOT_FOUND", "This link is not valid.");
  return resolveLinkHash(hashToken(token), opts);
}

export async function resolveLinkHash(tokenHash: string, opts: { tx?: Transaction; allowUsed?: boolean } = {}): Promise<ResolvedLink> {
  const ref = linkTokensCol().doc(tokenHash);
  const snap = opts.tx ? await opts.tx.get(ref) : await ref.get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "This link is not valid.");
  const link = snap.data() as LinkTokenDoc;
  const status = linkStatus(link, now());
  if (status !== "usable" && !(opts.allowUsed && status === "used")) {
    throw new AppError("LINK_GONE", GONE_MESSAGE[status], { details: { reason: status, purpose: link.purpose } });
  }
  return { tokenHash, link };
}

export function assertAction(link: LinkTokenDoc, action: string) {
  if (!link.allowedActions.includes(action)) throw new AppError("FORBIDDEN", "This link does not allow that action.");
}

/** Revokes every usable token of a purpose for a family (e.g. invite resend). Read phase + write phase in one tx. */
export async function findActiveTokens(tx: Transaction, familyId: string, purpose: LinkPurpose): Promise<string[]> {
  const q = linkTokensCol().where("familyId", "==", familyId).where("purpose", "==", purpose).where("revokedAt", "==", null);
  const snaps = await tx.get(q);
  const t = now();
  return snaps.docs.filter((d) => linkStatus(d.data() as LinkTokenDoc, t) === "usable").map((d) => d.id);
}

export function revokeTokensInTx(tx: Transaction, tokenHashes: string[]) {
  for (const h of tokenHashes) tx.update(linkTokensCol().doc(h), { revokedAt: Timestamp.fromDate(now()) });
}

export function markUsedInTx(tx: Transaction, tokenHash: string) {
  tx.update(linkTokensCol().doc(tokenHash), { usedAt: Timestamp.fromDate(now()) });
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  const first = user.slice(0, 1);
  return `${first}${"*".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}
