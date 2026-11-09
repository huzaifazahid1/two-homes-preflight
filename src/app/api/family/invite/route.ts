import { requestMeta } from "@/lib/audit";
import { requireOwner, requireVerified } from "@/lib/auth/session";
import { HOUR_MS } from "@/lib/clock";
import { revokeInvite, sendInvite } from "@/lib/invites";
import { route } from "@/lib/route";

export const POST = route(
  {
    name: "POST /api/family/invite",
    auth: "user",
    rateLimit: ({ user }) => ({ key: `invite:${user!.uid}`, limit: 10, windowMs: HOUR_MS, message: "Too many invites. Please wait a bit." }),
  },
  async ({ user, req, requestId }) => {
    const ctx = await requireOwner(await requireVerified(user!));
    return sendInvite(ctx, { resend: false, requestId, ...requestMeta(req) });
  },
);

export const DELETE = route({ name: "DELETE /api/family/invite", auth: "user" }, async ({ user, req }) => {
  const ctx = await requireOwner(user!);
  return revokeInvite(ctx, requestMeta(req));
});
