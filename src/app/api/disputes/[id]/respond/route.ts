import { requestMeta } from "@/lib/audit";
import { respondDispute } from "@/lib/disputes";
import { route } from "@/lib/route";
import { disputeRespondSchema, docIdParams } from "@/schemas";

// Answer a dispute (the id is the expense id). Two answers without agreement close it as UNRESOLVED.
export const POST = route({ name: "POST /api/disputes/:id/respond", auth: "userOrLink", params: docIdParams, body: disputeRespondSchema }, async ({ user, linkSession, params, body, req, requestId }) => {
  return respondDispute(params.id, body, { user, linkSession }, { requestId, ...requestMeta(req) });
});
