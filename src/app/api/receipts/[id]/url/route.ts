import { receiptViewUrl } from "@/lib/receipts/upload";
import { route } from "@/lib/route";
import { docIdParams } from "@/schemas";

// A 5-minute private download URL (RC-6). Members, or the payer through a payment link session.
export const GET = route({ name: "GET /api/receipts/:id/url", auth: "userOrLink", params: docIdParams }, async ({ user, linkSession, params, requestId }) => {
  return receiptViewUrl(params.id, { user, linkSession }, requestId);
});
