import "server-only";
import { env } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { footerFor } from "@/lib/email/templates/layout";
import type { FamilyDoc, Role, UserDoc } from "@/types/firestore";

// Who is who in a family: names, emails and accounts per role. Used by approvals and claims.
// The buyer (paidByRole) is the parent who is owed money; owedByRole is the paying parent.

export type Party = { role: Role; name: string; firstName: string; email: string; uid?: string };

export function otherRole(role: Role): Role {
  return role === "owner" ? "coparent" : "owner";
}

export function party(family: FamilyDoc, role: Role): Party {
  if (role === "owner") {
    return { role, name: family.owner.name, firstName: first(family.owner.name), email: family.owner.email.toLowerCase(), uid: family.ownerUid };
  }
  const uid = family.coParent.uid && family.memberUids.includes(family.coParent.uid) ? family.coParent.uid : undefined;
  return { role, name: family.coParent.name || "The other parent", firstName: first(family.coParent.name) || "the other parent", email: (family.coParent.email ?? "").toLowerCase(), uid };
}

/** Role of a signed-in member, or null when the uid is not a member. */
export function roleOfUid(family: FamilyDoc, uid: string): Role | null {
  if (family.ownerUid === uid) return "owner";
  if (family.coParent.uid === uid && family.memberUids.includes(uid)) return "coparent";
  return null;
}

function first(name: string | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Email footer (Section H.3) for the person receiving it. */
export function footerForRole(family: FamilyDoc, recipient: Role): string {
  return recipient === "coparent" ? footerFor(family.owner.name) : `You received this because you share child expenses with ${family.coParent.name || "the other parent"} on Two Homes Preflight.`;
}

export function appUrl(path: string): string {
  return `${env().APP_URL}${path}`;
}

/** Dates in emails use the owner's time zone (guests have none on file). */
export async function familyTimeZone(family: FamilyDoc): Promise<string> {
  const snap = await db().collection("users").doc(family.ownerUid).get();
  return (snap.data() as UserDoc | undefined)?.timeZone || "UTC";
}

export function formatDayIn(timeZone: string, d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(d);
  }
}
