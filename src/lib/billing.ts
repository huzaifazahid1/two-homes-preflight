import "server-only";
import { requireVerified, type FamilyContext } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { applySubscriptionInfo, familyPlanId, freshSubscription } from "@/lib/entitlement";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { usageMonth } from "@/lib/fees";
import { db } from "@/lib/firebase/admin";
import { log } from "@/lib/log";
import { paypalAppError } from "@/lib/paypal/http";
import { cancelSubscription, getSubscription } from "@/lib/paypal/subscriptions";
import { isEntitled, toMs } from "@/lib/state/effective";
import type { SubscriptionDoc, UsageDoc } from "@/types/firestore";

// Billing for the Family plan (Section G.6). Owner only (route + requireOwner). The server
// never trusts the browser: a subscription id is accepted only after PayPal confirms it belongs
// to this family (custom_id) and to our plan (plan_id) (SB-1, SB-2).

type Meta = { requestId?: string };

const iso = (t: unknown) => {
  const ms = toMs(t as never);
  return ms == null ? null : new Date(ms).toISOString();
};

export type BillingView = {
  entitled: boolean;
  planConfigured: boolean;
  planId: string | null;
  subscription: { status: SubscriptionDoc["status"]; paidThrough: string | null; nextBillingTime: string | null; trialEndsAt: string | null; lastSyncedAt: string | null } | null;
  coveredVolume: { usedCents: number; limitCents: number };
};

export async function getBilling(ctx: FamilyContext, meta: Meta = {}): Promise<BillingView> {
  const [sub, usageSnap] = await Promise.all([
    freshSubscription(ctx.familyId, meta.requestId),
    db().collection("usage").doc(`${ctx.familyId}_${usageMonth(now())}`).get(),
  ]);
  const usage = usageSnap.data() as UsageDoc | undefined;
  return {
    entitled: isEntitled(sub, now()),
    planConfigured: familyPlanId() !== null,
    planId: familyPlanId(),
    subscription: sub
      ? { status: sub.status, paidThrough: iso(sub.paidThrough), nextBillingTime: iso(sub.nextBillingTime), trialEndsAt: iso(sub.trialEndsAt), lastSyncedAt: iso(sub.lastSyncedAt) }
      : null,
    coveredVolume: { usedCents: usage?.coveredSettledCents ?? 0, limitCents: env().PLAN_COVERED_VOLUME_CENTS },
  };
}

/** POST /api/billing/subscription { subscriptionId } after the PayPal button approves. */
export async function activateSubscription(ctx: FamilyContext, subscriptionId: string, meta: Meta = {}): Promise<BillingView> {
  await requireVerified(ctx.user);
  const plan = familyPlanId();
  if (!plan) throw new AppError("STATE_CONFLICT", "The Family plan is not set up on this server yet.");
  const current = (await db().collection("subscriptions").doc(ctx.familyId).get()).data() as SubscriptionDoc | undefined;
  if (current && current.paypalSubscriptionId !== subscriptionId && isEntitled(current, now()) && current.status === "ACTIVE") {
    throw new AppError("DUPLICATE", "Your family already has an active Family plan.");
  }
  let info;
  try {
    info = await getSubscription(subscriptionId, meta.requestId);
  } catch (err) {
    const e = paypalAppError(err);
    // An id PayPal does not know (or that is not ours) is the caller's mistake, not an outage.
    if (e.code === "PAYPAL_VALIDATION") throw new AppError("INVALID", "This subscription could not be found.");
    throw e;
  }
  if (info.customId !== ctx.familyId || info.planId !== plan) {
    log.warn("billing.subscription_mismatch", { requestId: meta.requestId, familyId: ctx.familyId, customIdMatches: info.customId === ctx.familyId, planMatches: info.planId === plan });
    throw new AppError("INVALID", "This subscription does not belong to your family.");
  }
  await applySubscriptionInfo(ctx.familyId, info, "activate");
  return getBilling(ctx, meta);
}

/** POST /api/billing/cancel. Entitled until paidThrough (SB-3); captured claims still pay out (SB-6). */
export async function cancelFamilyPlan(ctx: FamilyContext, reason: string, meta: Meta = {}): Promise<BillingView> {
  const current = (await db().collection("subscriptions").doc(ctx.familyId).get()).data() as SubscriptionDoc | undefined;
  if (!current?.paypalSubscriptionId || current.status === "CANCELLED" || current.status === "EXPIRED") {
    throw new AppError("STATE_CONFLICT", "There is no active Family plan to cancel.");
  }
  try {
    await cancelSubscription(current.paypalSubscriptionId, reason || "Cancelled by the family owner", meta.requestId);
    await applySubscriptionInfo(ctx.familyId, await getSubscription(current.paypalSubscriptionId, meta.requestId), "cancel");
  } catch (err) {
    throw paypalAppError(err);
  }
  return getBilling(ctx, meta);
}
