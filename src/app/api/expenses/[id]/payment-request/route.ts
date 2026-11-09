import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { sendPaymentRequest } from "@/lib/claims";
import { getExpense } from "@/lib/expenses";
import { route } from "@/lib/route";
import { docIdParams } from "@/schemas";

// READY -> AWAITING_PAYMENT with dueAt from the agreement (or the family default). Owed parent only.
export const POST = route({ name: "POST /api/expenses/:id/payment-request", auth: "user", params: docIdParams }, async ({ user, params, req, requestId }) => {
  const ctx = await requireFamily(user!);
  const claim = await sendPaymentRequest(ctx, params.id, { requestId, ...requestMeta(req) });
  return { claim, ...(await getExpense(ctx, params.id, requestId)) };
});
