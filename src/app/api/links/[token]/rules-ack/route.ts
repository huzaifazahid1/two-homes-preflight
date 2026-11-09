import { requestMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { recomputeForRules } from "@/lib/expenses";
import { ackRules } from "@/lib/links/actions";
import { hashToken, isWellFormedToken } from "@/lib/links/tokens";
import { requireLinkSession, route } from "@/lib/route";
import { rulesAckSchema, tokenParams } from "@/schemas";

// Co-parent agree/disagree per rule (link + OTP). Disagreed rules put affected expenses into NEEDS_REVIEW (AG-12).
export const POST = route(
  { name: "POST /api/links/:token/rules-ack", auth: "link", params: tokenParams, body: rulesAckSchema },
  async (ctx) => {
    if (!isWellFormedToken(ctx.params.token)) throw new AppError("NOT_FOUND", "This link is not valid.");
    const tokenHash = hashToken(ctx.params.token);
    requireLinkSession(ctx, tokenHash);
    const ack = await ackRules(tokenHash, ctx.body.perRule, requestMeta(ctx.req));
    const recomputed = ack.ruleVersionId ? await recomputeForRules(ack.familyId, ack.ruleVersionId, ack.changed, ctx.requestId) : 0;
    return { saved: true, disagreed: ack.disagreed, recomputed };
  },
);
