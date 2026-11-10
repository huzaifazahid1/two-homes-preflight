import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { HOUR_MS, now } from "@/lib/clock";
import { env } from "@/lib/env";
import { db, Timestamp } from "@/lib/firebase/admin";
import { log } from "@/lib/log";
import { getSubscription, type SubscriptionInfo } from "@/lib/paypal/subscriptions";
import { isEntitled, toMs } from "@/lib/state/effective";
import type { FamilyDoc, SubscriptionDoc } from "@/types/firestore";

// Entitlement to Family features is derived from subscriptions/{familyId} (Section E.6.3):
// ACTIVE, or CANCELLED with paidThrough in the future. The doc is written only from PayPal data
// (server GET or a verified webhook), never from what the browser says (SB-2).

export const FREE_EXTRACTION_RUNS = 3;
export const RESYNC_AFTER_MS = HOUR_MS;

const subRef = (familyId: string) => db().collection("subscriptions").doc(familyId);

export async function loadSubscription(familyId: string, tx?: Transaction): Promise<SubscriptionDoc | null> {
  const snap = tx ? await tx.get(subRef(familyId)) : await subRef(familyId).get();
  return snap.exists ? (snap.data() as SubscriptionDoc) : null;
}

export async function familyEntitled(familyId: string, tx?: Transaction): Promise<boolean> {
  return isEntitled(await loadSubscription(familyId, tx), now());
}

function ts(iso: string | null): Timestamp | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

/**
 * Writes what PayPal says about the subscription. paidThrough = the next billing time (paid up to
 * then) and never moves backwards: PayPal drops next_billing_time on cancel, and the family stays
 * entitled until the date already paid for (SB-3).
 */
export async function applySubscriptionInfo(familyId: string, info: SubscriptionInfo, source: string): Promise<SubscriptionDoc> {
  return db().runTransaction(async (tx) => {
    const [famSnap, current] = await Promise.all([tx.get(db().collection("families").doc(familyId)), loadSubscription(familyId, tx)]);
    const family = famSnap.data() as FamilyDoc | undefined;
    if (!family) throw new Error(`family ${familyId} missing`);
    const at = Timestamp.fromDate(now());
    const next = ts(info.nextBillingTime);
    const storedPaid = current && current.paypalSubscriptionId === info.id ? current.paidThrough : undefined;
    const paidThrough = next && (!storedPaid || next.toMillis() > storedPaid.toMillis()) ? next : storedPaid;
    const doc: SubscriptionDoc = {
      familyId,
      memberUids: family.memberUids,
      paypalSubscriptionId: info.id,
      planId: info.planId ?? current?.planId ?? "",
      status: info.status,
      ...(paidThrough ? { paidThrough } : {}),
      ...(next ? { nextBillingTime: next } : {}),
      ...(info.inTrial && next ? { trialEndsAt: next } : current?.trialEndsAt && current.paypalSubscriptionId === info.id ? { trialEndsAt: current.trialEndsAt } : {}),
      lastSyncedAt: at,
      updatedAt: at,
    };
    tx.set(subRef(familyId), doc);
    tx.update(db().collection("families").doc(familyId), { "plan.tier": isEntitled(doc, now()) ? "family" : "free" });
    log.info("subscription.synced", { familyId, status: info.status, source });
    return doc;
  });
}

/** SB-5: if the stored state is older than an hour, read it again from PayPal. Never throws. */
export async function freshSubscription(familyId: string, requestId?: string): Promise<SubscriptionDoc | null> {
  const current = await loadSubscription(familyId);
  if (!current?.paypalSubscriptionId) return current;
  const age = now().getTime() - (toMs(current.lastSyncedAt) ?? 0);
  if (age < RESYNC_AFTER_MS) return current;
  try {
    const info = await getSubscription(current.paypalSubscriptionId, requestId);
    if (info.customId && info.customId !== familyId) {
      log.error("subscription.custom_id_mismatch", { requestId, familyId });
      return current;
    }
    return await applySubscriptionInfo(familyId, info, "resync");
  } catch (err) {
    // Keep the stored state; the next gated action or the billing page tries again.
    log.warn("subscription.resync_failed", { requestId, familyId, error: err });
    return current;
  }
}

/** Entitlement for gated money actions, with the 1-hour re-sync. */
export async function familyEntitledFresh(familyId: string, requestId?: string): Promise<boolean> {
  return isEntitled(await freshSubscription(familyId, requestId), now());
}

export function familyPlanId(): string | null {
  const id = env().PAYPAL_FAMILY_PLAN_ID;
  return id && !id.startsWith("replace") ? id : null;
}
