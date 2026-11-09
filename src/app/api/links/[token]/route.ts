import { getLinkSummary } from "@/lib/links/actions";
import { route } from "@/lib/route";
import { tokenParams } from "@/schemas";

// Read-only summary. No action is possible without the OTP (LK-1). 410 if unusable (LK-7).
export const GET = route({ name: "GET /api/links/:token", auth: "link", params: tokenParams }, async ({ params, linkSession }) => {
  return { summary: await getLinkSummary(params.token, linkSession) };
});
