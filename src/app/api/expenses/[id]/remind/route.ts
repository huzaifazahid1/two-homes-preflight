import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { remindPayer } from "@/lib/claims";
import { getExpense } from "@/lib/expenses";
import { route } from "@/lib/route";
import { docIdParams } from "@/schemas";

// Manual reminder, at most once every 72 hours (CL-5). Owed parent only.
export const POST = route({ name: "POST /api/expenses/:id/remind", auth: "user", params: docIdParams }, async ({ user, params, req, requestId }) => {
  const ctx = await requireFamily(user!);
  const reminder = await remindPayer(ctx, params.id, { requestId, ...requestMeta(req) });
  return { reminder, ...(await getExpense(ctx, params.id, requestId)) };
});
