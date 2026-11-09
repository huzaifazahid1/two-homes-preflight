import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { AppError } from "@/lib/errors";
import { db, FieldValue } from "@/lib/firebase/admin";
import { newId } from "@/lib/ids";
import { findActiveTokens, revokeTokensInTx } from "@/lib/links/tokens";
import type { FamilyContext } from "@/lib/auth/session";
import type { FamilyUpsert } from "@/schemas";
import type { Child, FamilyDoc, UserDoc } from "@/types/firestore";

// Family, co-parent details and children (Section E.2 `families`, A.5.1 step 3).

export const MAX_CHILDREN = 10;

export function familiesCol() {
  return db().collection("families");
}

/** Creates the family shell in the same transaction as the user update. Writes only; `updates` is the pending user patch. */
export function ensureFamilyInTx(
  tx: Transaction,
  owner: { uid: string; email: string; displayName: string },
  existingFamilyId: string | null,
  userUpdates: Record<string, unknown>,
): string {
  if (existingFamilyId) return existingFamilyId;
  const ref = familiesCol().doc();
  const doc = {
    ownerUid: owner.uid,
    memberUids: [owner.uid],
    owner: { name: owner.displayName, email: owner.email },
    coParent: { name: "", email: "", mode: "guest", inviteStatus: "not_sent" },
    children: [],
    payout: {},
    settings: { dueDays: 30, currency: "USD" },
    plan: { tier: "free" },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  tx.create(ref, doc);
  userUpdates.familyId = ref.id;
  userUpdates.role = "owner";
  return ref.id;
}

/** POST /api/family: create the family if missing, and set the co-parent's name and email. Verified owner only. */
export async function upsertFamily(user: { uid: string; email: string }, input: FamilyUpsert): Promise<{ familyId: string; family: FamilyDoc }> {
  const userRef = db().collection("users").doc(user.uid);
  const familyId = await db().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new AppError("UNAUTHENTICATED", "Your profile was not found. Please sign in again.");
    const userDoc = userSnap.data() as UserDoc;

    let family: FamilyDoc | null = null;
    if (userDoc.familyId) {
      const fs = await tx.get(familiesCol().doc(userDoc.familyId));
      family = fs.exists ? (fs.data() as FamilyDoc) : null;
      if (family && family.ownerUid !== user.uid) throw new AppError("FORBIDDEN", "Only the family owner can do this.");
    }

    const cp = input.coParent;
    if (cp && cp.email === user.email.toLowerCase()) {
      throw new AppError("INVALID", "The other parent's email must be different from yours.", {
        details: { fields: [{ path: "body.coParent.email", message: "The other parent's email must be different from yours." }] },
      });
    }

    let toRevoke: string[] = [];
    const emailChanged = cp && family && family.coParent.email && family.coParent.email !== cp.email;
    if (emailChanged && family!.coParent.inviteStatus === "accepted") {
      throw new AppError("STATE_CONFLICT", "The other parent already accepted the invite, so their email cannot be changed here.");
    }
    if (emailChanged && userDoc.familyId) toRevoke = await findActiveTokens(tx, userDoc.familyId, "invite");

    // ---- writes ----
    const userUpdates: Record<string, unknown> = {};
    const id = ensureFamilyInTx(tx, { uid: user.uid, email: user.email, displayName: userDoc.displayName }, userDoc.familyId && family ? userDoc.familyId : null, userUpdates);
    if (Object.keys(userUpdates).length > 0) tx.update(userRef, { ...userUpdates, updatedAt: FieldValue.serverTimestamp() });

    if (cp) {
      const patch: Record<string, unknown> = { "coParent.name": cp.name, "coParent.email": cp.email, updatedAt: FieldValue.serverTimestamp() };
      if (emailChanged) {
        patch["coParent.inviteStatus"] = "not_sent";
        revokeTokensInTx(tx, toRevoke);
      }
      // When the family was created above in this same transaction, the update applies after the create.
      tx.update(familiesCol().doc(id), patch);
    }
    return id;
  });
  const snap = await familiesCol().doc(familyId).get();
  return { familyId, family: snap.data() as FamilyDoc };
}

export async function addChild(ctx: FamilyContext, input: { firstName: string; birthYear?: number }): Promise<Child> {
  const child: Child = { id: newId(12), firstName: input.firstName, ...(input.birthYear ? { birthYear: input.birthYear } : {}) };
  await db().runTransaction(async (tx) => {
    const ref = familiesCol().doc(ctx.familyId);
    const snap = await tx.get(ref);
    const family = snap.data() as FamilyDoc;
    if (family.children.length >= MAX_CHILDREN) throw new AppError("INVALID", `A family can have up to ${MAX_CHILDREN} children.`);
    tx.update(ref, { children: [...family.children, child], updatedAt: FieldValue.serverTimestamp() });
  });
  return child;
}

export async function updateChild(ctx: FamilyContext, childId: string, input: { firstName?: string; birthYear?: number }): Promise<Child> {
  let updated: Child | null = null;
  await db().runTransaction(async (tx) => {
    const ref = familiesCol().doc(ctx.familyId);
    const family = (await tx.get(ref)).data() as FamilyDoc;
    const children = family.children.map((c) => {
      if (c.id !== childId) return c;
      updated = { ...c, ...input };
      return updated;
    });
    if (!updated) throw new AppError("NOT_FOUND", "Child not found.");
    tx.update(ref, { children, updatedAt: FieldValue.serverTimestamp() });
  });
  return updated!;
}

export async function removeChild(ctx: FamilyContext, childId: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const ref = familiesCol().doc(ctx.familyId);
    const family = (await tx.get(ref)).data() as FamilyDoc;
    if (!family.children.some((c) => c.id === childId)) throw new AppError("NOT_FOUND", "Child not found.");
    // Expenses reference childId; once expenses exist (Phase 2) a child with expenses cannot be removed.
    const used = await tx.get(db().collection("expenses").where("familyId", "==", ctx.familyId).where("childId", "==", childId).limit(1));
    if (!used.empty) throw new AppError("STATE_CONFLICT", "This child has expenses, so they cannot be removed.");
    tx.update(ref, { children: family.children.filter((c) => c.id !== childId), updatedAt: FieldValue.serverTimestamp() });
  });
}

/** Client-safe view of the family for the owner (no internal fields). */
export function familyView(familyId: string, f: FamilyDoc) {
  const conn = (c: FamilyDoc["payout"]["owner"]) =>
    c ? { method: c.method, email: c.email, verifiedAccount: c.verifiedAccount ?? null, hasPayerId: Boolean(c.payerId), connectedAt: c.connectedAt.toDate().toISOString() } : null;
  return {
    id: familyId,
    owner: f.owner,
    coParent: { name: f.coParent.name, email: f.coParent.email, mode: f.coParent.mode, inviteStatus: f.coParent.inviteStatus, acceptedAt: f.coParent.acceptedAt?.toDate().toISOString() ?? null },
    children: f.children,
    payout: { owner: conn(f.payout.owner), coparent: conn(f.payout.coparent) },
    settings: f.settings,
    plan: f.plan,
    activeRuleVersionId: f.activeRuleVersionId ?? null,
  };
}
export type FamilyView = ReturnType<typeof familyView>;
