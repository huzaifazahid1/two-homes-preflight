import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { now } from "@/lib/clock";
import { db } from "@/lib/firebase/admin";
import { isEntitled } from "@/lib/state/effective";
import type { SubscriptionDoc } from "@/types/firestore";

// Entitlement to Family features is derived from subscriptions/{familyId} (Section E.6.3).
// Subscriptions are wired in Phase 4; until then every family is on Free.

export const FREE_EXTRACTION_RUNS = 3;

export async function familyEntitled(familyId: string, tx?: Transaction): Promise<boolean> {
  const ref = db().collection("subscriptions").doc(familyId);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return isEntitled(snap.exists ? (snap.data() as SubscriptionDoc) : null, now());
}
