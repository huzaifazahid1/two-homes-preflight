import { requestMeta } from "@/lib/audit";
import { requireOwner } from "@/lib/auth/session";
import { route } from "@/lib/route";
import { patchRule } from "@/lib/rule-versions";
import { ruleParams, rulePatchSchema } from "@/schemas";

// Confirm / edit (original kept) / reject / undo. DRAFT only, else 409 (AG-10).
export const PATCH = route(
  { name: "PATCH /api/rule-versions/:id/rules/:ruleId", auth: "user", params: ruleParams, body: rulePatchSchema },
  async ({ user, params, body, req, requestId }) => {
    const ctx = await requireOwner(user!);
    return { ruleVersion: await patchRule(ctx, params.id, params.ruleId, body, { requestId, ...requestMeta(req) }) };
  },
);
