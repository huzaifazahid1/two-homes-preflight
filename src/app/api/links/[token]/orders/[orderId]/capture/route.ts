import { requestMeta } from "@/lib/audit";
import { captureCheckoutOrder } from "@/lib/checkout";
import { route } from "@/lib/route";
import { orderParams } from "@/schemas";

// PayPal Buttons onApprove (Section G.3 step 3): capture, then the payout in the same request.
export const POST = route(
  { name: "POST /api/links/:token/orders/:orderId/capture", auth: "userOrLink", params: orderParams },
  async ({ params, user, linkSession, req, requestId }) => captureCheckoutOrder(params.token, params.orderId, { user, linkSession }, { requestId, ...requestMeta(req) }),
);
