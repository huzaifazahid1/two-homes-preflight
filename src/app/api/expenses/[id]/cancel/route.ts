import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { cancelExpense } from "@/lib/expenses";
import { route } from "@/lib/route";
import { docIdParams } from "@/schemas";

export const POST = route({ name: "POST /api/expenses/:id/cancel", auth: "user", params: docIdParams }, async ({ user, params, req, requestId }) => {
  const ctx = await requireFamily(user!);
  return cancelExpense(ctx, params.id, { requestId, ...requestMeta(req) });
});
