import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { waiveClaim } from "@/lib/claims";
import { getExpense } from "@/lib/expenses";
import { route } from "@/lib/route";
import { docIdParams, waiveSchema } from "@/schemas";

// WAIVED with a reason (CL-9). Owed parent only (AZ-4).
export const POST = route({ name: "POST /api/expenses/:id/waive", auth: "user", params: docIdParams, body: waiveSchema }, async ({ user, params, body, req, requestId }) => {
  const ctx = await requireFamily(user!);
  await waiveClaim(ctx, params.id, body.reason, { requestId, ...requestMeta(req) });
  return getExpense(ctx, params.id, requestId);
});
