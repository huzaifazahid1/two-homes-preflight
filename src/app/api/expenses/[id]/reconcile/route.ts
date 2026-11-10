import { requireFamily } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getExpense, loadFamilyExpense } from "@/lib/expenses";
import { safeEqual, sha256Hex } from "@/lib/ids";
import { route } from "@/lib/route";
import { reconcileExpense } from "@/lib/settlement";
import { docIdParams } from "@/schemas";

// Re-sync with PayPal (Section G.9). A family member (owner or joined co-parent), or a job with
// Authorization: Bearer JOB_SECRET.
export const POST = route(
  { name: "POST /api/expenses/:id/reconcile", auth: "none", params: docIdParams, rateLimit: ({ params }) => ({ key: `reconcile:${params.id}`, limit: 30, windowMs: 3_600_000 }) },
  async ({ req, user, params, requestId }) => {
    const header = req.headers.get("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (given) {
      if (!safeEqual(sha256Hex(given), sha256Hex(env().JOB_SECRET))) throw new AppError("UNAUTHENTICATED", "Missing or wrong job secret.");
      return { result: await reconcileExpense(params.id, { requestId }) };
    }
    if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const ctx = await requireFamily(user);
    await loadFamilyExpense(ctx, params.id, requestId); // 403/404 for another family (AZ-2)
    const result = await reconcileExpense(params.id, { requestId });
    return { result, ...(await getExpense(ctx, params.id, requestId)) };
  },
);
