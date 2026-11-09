import { requestMeta } from "@/lib/audit";
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
    return acceptInvite(tokenHash, ctx.body, requestMeta(ctx.req));
  },
);
