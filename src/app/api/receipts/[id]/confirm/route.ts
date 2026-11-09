import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { confirmReceipt } from "@/lib/receipts/upload";
import { route } from "@/lib/route";
import { docIdParams, receiptConfirmSchema } from "@/schemas";

// The parent confirms merchant, date and total; then the match runs (READY or RECEIPT_ISSUE).
export const POST = route({ name: "POST /api/receipts/:id/confirm", auth: "user", params: docIdParams, body: receiptConfirmSchema }, async ({ user, params, body, req, requestId }) => {
  const ctx = await requireFamily(user!);
  return confirmReceipt(ctx, params.id, body, { requestId, ...requestMeta(req) });
});
