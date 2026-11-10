import { requireOwner } from "@/lib/auth/session";
import { cancelFamilyPlan } from "@/lib/billing";
import { route } from "@/lib/route";
import { cancelPlanSchema } from "@/schemas";

// Cancel the Family plan. Entitled until paidThrough (SB-3).
export const POST = route({ name: "POST /api/billing/cancel", auth: "user", body: cancelPlanSchema }, async ({ user, body, requestId }) => {
  const ctx = await requireOwner(user!);
  return { billing: await cancelFamilyPlan(ctx, body.reason ?? "", { requestId }) };
});
