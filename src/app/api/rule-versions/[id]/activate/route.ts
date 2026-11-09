import { requestMeta } from "@/lib/audit";
import { requireOwner } from "@/lib/auth/session";
import { route } from "@/lib/route";
import { activateRuleVersion } from "@/lib/rule-versions";
import { docIdParams } from "@/schemas";

export const POST = route({ name: "POST /api/rule-versions/:id/activate", auth: "user", params: docIdParams }, async ({ user, params, req, requestId }) => {
  const ctx = await requireOwner(user!);
  return { ruleVersion: await activateRuleVersion(ctx, params.id, { requestId, ...requestMeta(req) }) };
});
