import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { createExpense, listExpenses } from "@/lib/expenses";
import { route } from "@/lib/route";
import { expenseCreateSchema, expenseListQuery } from "@/schemas";

export const POST = route({ name: "POST /api/expenses", auth: "user", body: expenseCreateSchema }, async ({ user, body, req, requestId }) => {
  const ctx = await requireFamily(user!);
  return Response.json({ expense: await createExpense(ctx, body, { requestId, ...requestMeta(req) }) }, { status: 201 });
});

export const GET = route({ name: "GET /api/expenses", auth: "user", query: expenseListQuery }, async ({ user, query }) => {
  const ctx = await requireFamily(user!);
  return listExpenses(ctx, query);
});
