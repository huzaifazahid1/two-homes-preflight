import { requestMeta } from "@/lib/audit";
import { openDispute } from "@/lib/disputes";
import { route } from "@/lib/route";
import { disputeOpenSchema, docIdParams } from "@/schemas";

// The paying parent disputes the claim (signed in, or through the payment link + code).
export const POST = route({ name: "POST /api/expenses/:id/dispute", auth: "userOrLink", params: docIdParams, body: disputeOpenSchema }, async ({ user, linkSession, params, body, req, requestId }) => {
  return openDispute(params.id, body, { user, linkSession }, { requestId, ...requestMeta(req) });
});
