import { requireOwner } from "@/lib/auth/session";
import { getBilling } from "@/lib/billing";
import { route } from "@/lib/route";

// Family plan status and covered volume (Section G.6). Owner only (AZ-3). Re-syncs after 1 h (SB-5).
export const GET = route({ name: "GET /api/billing", auth: "user" }, async ({ user, requestId }) => {
  const ctx = await requireOwner(user!);
  return { billing: await getBilling(ctx, { requestId }) };
});
