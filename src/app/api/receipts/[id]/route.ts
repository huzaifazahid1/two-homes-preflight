import { requireFamily } from "@/lib/auth/session";
import { getReceipt } from "@/lib/receipts/upload";
import { route } from "@/lib/route";
import { docIdParams } from "@/schemas";

export const GET = route({ name: "GET /api/receipts/:id", auth: "user", params: docIdParams }, async ({ user, params, requestId }) => {
  const ctx = await requireFamily(user!);
  return getReceipt(ctx, params.id, requestId);
});
