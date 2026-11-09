import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { getExpense } from "@/lib/expenses";
import { route } from "@/lib/route";
import { retryPayout } from "@/lib/settlement";
import { docIdParams } from "@/schemas";

// After a failed payout and a fresh PayPal connection: a new payout attempt (PY-13). Owed parent only.
export const POST = route(
  { name: "POST /api/expenses/:id/payout/retry", auth: "user", params: docIdParams, rateLimit: ({ params }) => ({ key: `payout-retry:${params.id}`, limit: 5, windowMs: 3_600_000 }) },
  async ({ user, params, req, requestId }) => {
    const ctx = await requireFamily(user!);
    const result = await retryPayout(ctx, params.id, { requestId, ...requestMeta(req) });
    return { result, ...(await getExpense(ctx, params.id, requestId)) };
  },
);
