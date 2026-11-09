import { requireOwner } from "@/lib/auth/session";
import { activateSubscription } from "@/lib/billing";
import { route } from "@/lib/route";
import { subscriptionActivateSchema } from "@/schemas";

// After PayPal Buttons approve a subscription. Verified with PayPal before anything is stored (SB-1, SB-2).
export const POST = route(
  { name: "POST /api/billing/subscription", auth: "user", body: subscriptionActivateSchema, rateLimit: ({ user }) => ({ key: `billing-sub:${user?.uid}`, limit: 10, windowMs: 3_600_000 }) },
  async ({ user, body, requestId }) => {
    const ctx = await requireOwner(user!);
    return { billing: await activateSubscription(ctx, body.subscriptionId, { requestId }) };
  },
);
