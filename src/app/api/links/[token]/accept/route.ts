import { requestMeta } from "@/lib/audit";
import { recomputeForRules } from "@/lib/expenses";
import { acceptInvite } from "@/lib/links/actions";
import { hashToken, isWellFormedToken } from "@/lib/links/tokens";
import { AppError } from "@/lib/errors";
import { requireLinkSession, route } from "@/lib/route";
import { acceptInviteSchema, tokenParams } from "@/schemas";

export const POST = route(
  { name: "POST /api/links/:token/accept", auth: "link", params: tokenParams, body: acceptInviteSchema },
  async (ctx) => {
    if (!isWellFormedToken(ctx.params.token)) throw new AppError("NOT_FOUND", "This link is not valid.");
    const tokenHash = hashToken(ctx.params.token);
    requireLinkSession(ctx, tokenHash);
    const { ack, ...result } = await acceptInvite(tokenHash, ctx.body, requestMeta(ctx.req));
    if (ack.ruleVersionId) await recomputeForRules(ack.familyId, ack.ruleVersionId, ack.changed, ctx.requestId);
    return result;
  },
);
