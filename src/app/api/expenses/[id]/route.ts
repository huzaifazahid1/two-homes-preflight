import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { getExpense, patchExpense } from "@/lib/expenses";
import { route } from "@/lib/route";
import { docIdParams, expensePatchSchema } from "@/schemas";

export const GET = route({ name: "GET /api/expenses/:id", auth: "user", params: docIdParams }, async ({ user, params, requestId }) => {
  const ctx = await requireFamily(user!);
  return getExpense(ctx, params.id, requestId);
});

export const PATCH = route({ name: "PATCH /api/expenses/:id", auth: "user", params: docIdParams, body: expensePatchSchema }, async ({ user, params, body, req, requestId }) => {
  const ctx = await requireFamily(user!);
  return patchExpense(ctx, params.id, body, { requestId, ...requestMeta(req) });
});
