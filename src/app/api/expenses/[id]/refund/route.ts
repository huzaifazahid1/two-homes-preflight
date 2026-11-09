import { requestMeta } from "@/lib/audit";
import { requireOwner } from "@/lib/auth/session";
import { getExpense } from "@/lib/expenses";
import { route } from "@/lib/route";
import { refundPayer } from "@/lib/settlement";
import { docIdParams } from "@/schemas";

// Refund the payer after a failed payout [Should] (Section G.5, PY-16). Owner only.
export const POST = route({ name: "POST /api/expenses/:id/refund", auth: "user", params: docIdParams }, async ({ user, params, req, requestId }) => {
  const ctx = await requireOwner(user!);
  const result = await refundPayer(ctx, params.id, { requestId, ...requestMeta(req) });
  return { result, ...(await getExpense(ctx, params.id, requestId)) };
});
