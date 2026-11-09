import { decideApproval } from "@/lib/approvals";
import { requestMeta } from "@/lib/audit";
import { route } from "@/lib/route";
import { decisionSchema, tokenParams } from "@/schemas";

// Approve, approve part, or decline (link + code, or the signed-in approver). First answer is final (AP-6).
export const POST = route({ name: "POST /api/links/:token/decision", auth: "userOrLink", params: tokenParams, body: decisionSchema }, async ({ params, body, user, linkSession, req, requestId }) => {
  const result = await decideApproval(params.token, body, { user, linkSession }, { requestId, ...requestMeta(req) });
  return { result };
});
