import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { resolveExternalReport } from "@/lib/claims";
import { getExpense } from "@/lib/expenses";
import { route } from "@/lib/route";
import { externalActionParams } from "@/schemas";

// Owed parent confirms (SETTLED_EXTERNALLY) or rejects (back to AWAITING_PAYMENT) the payer's report (CL-7).
export const POST = route({ name: "POST /api/expenses/:id/external-report/:action", auth: "user", params: externalActionParams }, async ({ user, params, req, requestId }) => {
  const ctx = await requireFamily(user!);
  await resolveExternalReport(ctx, params.id, params.action, { requestId, ...requestMeta(req) });
  return getExpense(ctx, params.id, requestId);
});
