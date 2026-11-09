import { requestMeta } from "@/lib/audit";
import { requireOwner, requireVerified } from "@/lib/auth/session";
import { HOUR_MS } from "@/lib/clock";
import { sendInvite } from "@/lib/invites";
import { route } from "@/lib/route";

// Resend revokes the old token and creates a new one in the same transaction (LK-9).
export const POST = route(
  {
    name: "POST /api/family/invite/resend",
    auth: "user",
    rateLimit: ({ user }) => ({ key: `invite:${user!.uid}`, limit: 10, windowMs: HOUR_MS, message: "Too many invites. Please wait a bit." }),
  },
  async ({ user, req, requestId }) => {
    const ctx = await requireOwner(await requireVerified(user!));
    return sendInvite(ctx, { resend: true, requestId, ...requestMeta(req) });
  },
);
