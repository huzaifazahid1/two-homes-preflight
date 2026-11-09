import "server-only";
import { requireUserDoc, type SessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { requireLinkForConnect } from "@/lib/links/actions";
import { hashToken, isWellFormedToken } from "@/lib/links/tokens";
import type { Role } from "@/types/firestore";

// Who is connecting PayPal (Section F.2 "Connect PayPal: own only").
// A signed-in user connects their own role; a guest co-parent connects through a link session.

export type Connector = { familyId: string; role: Role; uid?: string; tokenHash?: string };

export async function resolveConnector(
  input: { for: Role; token?: string },
  ctx: { user: SessionUser | null; linkSession: { tokenHash: string } | null },
): Promise<Connector> {
  if (input.token) {
    if (!isWellFormedToken(input.token)) throw new AppError("NOT_FOUND", "This link is not valid.");
    const tokenHash = hashToken(input.token);
    if (ctx.linkSession?.tokenHash !== tokenHash) throw new AppError("LINK_SESSION_REQUIRED", "Enter the code we emailed you to continue.");
    const link = await requireLinkForConnect(tokenHash);
    if (link.recipientRole !== input.for) throw new AppError("FORBIDDEN", "You can only connect your own PayPal account.");
    return { familyId: link.familyId, role: link.recipientRole, tokenHash };
  }
  if (!ctx.user) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  const doc = await requireUserDoc(ctx.user);
  if (!doc.familyId) throw new AppError("STATE_CONFLICT", "Create your family first.");
  if (doc.role !== input.for) throw new AppError("FORBIDDEN", "You can only connect your own PayPal account.");
  return { familyId: doc.familyId, role: doc.role, uid: ctx.user.uid };
}
