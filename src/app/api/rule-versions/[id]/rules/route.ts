import { requestMeta } from "@/lib/audit";
import { requireOwner } from "@/lib/auth/session";
import { route } from "@/lib/route";
import { addManualRule } from "@/lib/rule-versions";
import { docIdParams, manualRuleSchema } from "@/schemas";

// Manual rule entry (AG-8 fallback). The quote must be found in the agreement text.
export const POST = route(
  { name: "POST /api/rule-versions/:id/rules", auth: "user", params: docIdParams, body: manualRuleSchema },
  async ({ user, params, body, req, requestId }) => {
    const ctx = await requireOwner(user!);
    return Response.json({ ruleVersion: await addManualRule(ctx, params.id, body, { requestId, ...requestMeta(req) }) }, { status: 201 });
  },
);
