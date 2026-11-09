import "server-only";
import { z } from "zod";
import { PayPalError } from "./http";
import { sdkCall, subscriptions } from "./sdk";

// Subscriptions through the Server SDK (Section G.6). The server never trusts a subscription id
// from the browser: it reads the subscription from PayPal and checks custom_id and plan_id.

export type PayPalSubStatus = "APPROVAL_PENDING" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";

/** One shape for the SDK result (camelCase) and webhook resources (snake_case). */
export type SubscriptionInfo = {
  id: string;
  status: PayPalSubStatus;
  planId: string | null;
  customId: string | null;
  nextBillingTime: string | null;
  lastPaymentTime: string | null;
  /** The current cycle is the free trial. */
  inTrial: boolean;
};

const cycle = z.object({ tenureType: z.string().optional(), cyclesRemaining: z.number().optional(), cyclesCompleted: z.number().optional() }).loose();
const sdkSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    planId: z.string().optional(),
    customId: z.string().optional(),
    billingInfo: z
      .object({ nextBillingTime: z.string().optional(), lastPayment: z.object({ time: z.string().optional() }).loose().optional(), cycleExecutions: z.array(cycle).optional() })
      .loose()
      .optional(),
  })
  .loose();

const webhookSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    plan_id: z.string().optional(),
    custom_id: z.string().optional(),
    billing_info: z
      .object({
        next_billing_time: z.string().optional(),
        last_payment: z.object({ time: z.string().optional() }).loose().optional(),
        cycle_executions: z.array(z.object({ tenure_type: z.string().optional(), cycles_remaining: z.number().optional(), cycles_completed: z.number().optional() }).loose()).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

/** PayPal's APPROVED (buyer approved, not active yet) is stored as APPROVAL_PENDING: not entitled. */
export function mapStatus(raw: string): PayPalSubStatus {
  switch (raw.toUpperCase()) {
    case "ACTIVE":
      return "ACTIVE";
    case "SUSPENDED":
      return "SUSPENDED";
    case "CANCELLED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return "APPROVAL_PENDING";
  }
}

function trialOf(cycles: { tenure: string | undefined; remaining: number | undefined; completed: number | undefined }[]): boolean {
  const trial = cycles.find((c) => c.tenure === "TRIAL");
  return Boolean(trial && (trial.remaining ?? 0) > 0 && (trial.completed ?? 0) === 0);
}

export function fromWebhookResource(resource: unknown): SubscriptionInfo | null {
  const p = webhookSchema.safeParse(resource);
  if (!p.success) return null;
  const b = p.data.billing_info;
  return {
    id: p.data.id,
    status: mapStatus(p.data.status),
    planId: p.data.plan_id ?? null,
    customId: p.data.custom_id ?? null,
    nextBillingTime: b?.next_billing_time ?? null,
    lastPaymentTime: b?.last_payment?.time ?? null,
    inTrial: trialOf((b?.cycle_executions ?? []).map((c) => ({ tenure: c.tenure_type, remaining: c.cycles_remaining, completed: c.cycles_completed }))),
  };
}

/** GET /v1/billing/subscriptions/{id}. */
export async function getSubscription(id: string, requestId?: string): Promise<SubscriptionInfo> {
  const { result } = await sdkCall("subscriptions.get", () => subscriptions().getSubscription({ id }), requestId);
  const p = sdkSchema.parse(result);
  const b = p.billingInfo;
  return {
    id: p.id,
    status: mapStatus(p.status),
    planId: p.planId ?? null,
    customId: p.customId ?? null,
    nextBillingTime: b?.nextBillingTime ?? null,
    lastPaymentTime: b?.lastPayment?.time ?? null,
    inTrial: trialOf((b?.cycleExecutions ?? []).map((c) => ({ tenure: c.tenureType, remaining: c.cyclesRemaining, completed: c.cyclesCompleted }))),
  };
}

/** POST /v1/billing/subscriptions/{id}/cancel. Already cancelled counts as done. */
export async function cancelSubscription(id: string, reason: string, requestId?: string): Promise<void> {
  try {
    await sdkCall("subscriptions.cancel", () => subscriptions().cancelSubscription({ id, body: { reason: reason.slice(0, 127) } }), requestId);
  } catch (e) {
    if (e instanceof PayPalError && e.status === 422 && e.has("SUBSCRIPTION_STATUS_INVALID")) return;
    throw e;
  }
}
