import { cancelApprovalRequest, requestApproval } from "@/lib/approvals";
import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { getExpense } from "@/lib/expenses";
import { route } from "@/lib/route";
import { docIdParams } from "@/schemas";

// Request approval (REQUIRED -> REQUESTED), or send a fresh link for an open request. Buyer only.
export const POST = route({ name: "POST /api/expenses/:id/approval-request", auth: "user", params: docIdParams }, async ({ user, params, req, requestId }) => {
  const ctx = await requireFamily(user!);
  const sent = await requestApproval(ctx, params.id, { requestId, ...requestMeta(req) });
  return { sent, ...(await getExpense(ctx, params.id, requestId)) };
});

// Cancel the open request (AP-8): the link stops working in the same transaction.
export const DELETE = route({ name: "DELETE /api/expenses/:id/approval-request", auth: "user", params: docIdParams }, async ({ user, params, req, requestId }) => {
  const ctx = await requireFamily(user!);
  await cancelApprovalRequest(ctx, params.id, { requestId, ...requestMeta(req) });
  return getExpense(ctx, params.id, requestId);
});
