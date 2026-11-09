import "server-only";
import type { SessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/firebase/admin";
import { roleOfUid } from "@/lib/parties";
import type { FamilyDoc, LinkTokenDoc, Role } from "@/types/firestore";

// Who may act on a link (Section F.2, F.3): the holder of a link session for this token
// (proved with the email code), or a signed-in family member who is the link's recipient
// (a joined co-parent skips the code).

export type LinkActor = { kind: Role; uid?: string; tokenHash?: string };

export async function requireLinkActor(
  ctx: { linkSession: { tokenHash: string } | null; user: SessionUser | null },
  tokenHash: string,
  link: LinkTokenDoc,
): Promise<LinkActor> {
  if (ctx.linkSession?.tokenHash === tokenHash) return { kind: link.recipientRole, tokenHash };
  if (ctx.user) {
    const snap = await db().collection("families").doc(link.familyId).get();
    const family = snap.data() as FamilyDoc | undefined;
    if (family && roleOfUid(family, ctx.user.uid) === link.recipientRole) return { kind: link.recipientRole, uid: ctx.user.uid };
  }
  throw new AppError("LINK_SESSION_REQUIRED", "Enter the code we emailed you to continue.");
}
