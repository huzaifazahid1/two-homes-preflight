import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { markReceived } from "@/lib/claims";
import { getExpense } from "@/lib/expenses";
import { route } from "@/lib/route";
import { docIdParams } from "@/schemas";

// SETTLED_EXTERNALLY; the payer may contest for 7 days. Owed parent only (AZ-4).
export const POST = route({ name: "POST /api/expenses/:id/mark-received", auth: "user", params: docIdParams }, async ({ user, params, req, requestId }) => {
  const ctx = await requireFamily(user!);
  await markReceived(ctx, params.id, { requestId, ...requestMeta(req) });
  return getExpense(ctx, params.id, requestId);
});
