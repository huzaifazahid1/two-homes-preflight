import { getLinkSummary } from "@/lib/links/actions";
import { route } from "@/lib/route";
import { tokenParams } from "@/schemas";

// Read-only summary for invite, approval and payment links. No action is possible without the code (LK-1).
// 410 if unusable (LK-7); a decided approval link stays readable and shows the decision.
export const GET = route({ name: "GET /api/links/:token", auth: "userOrLink", params: tokenParams }, async ({ params, linkSession, user }) => {
  return { summary: await getLinkSummary(params.token, linkSession, user) };
});
