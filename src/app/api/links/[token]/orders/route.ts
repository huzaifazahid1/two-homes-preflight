import { requestMeta } from "@/lib/audit";
import { createCheckoutOrder } from "@/lib/checkout";
import { HOUR_MS } from "@/lib/clock";
import { route } from "@/lib/route";
import { createOrderSchema, tokenParams } from "@/schemas";

// PayPal Buttons createOrder (Section G.3 step 2). Link + code (or the joined payer). The body is
// ignored: the amount is owed share + fee line, computed here (PY-2).
export const POST = route(
  {
    name: "POST /api/links/:token/orders",
    auth: "userOrLink",
    params: tokenParams,
    body: createOrderSchema,
    rateLimit: ({ params }) => ({ key: `orders:${params.token.slice(0, 16)}`, limit: 20, windowMs: HOUR_MS }),
  },
  async ({ params, user, linkSession, req, requestId }) => createCheckoutOrder(params.token, { user, linkSession }, { requestId, ...requestMeta(req) }),
);
