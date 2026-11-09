import { requestMeta } from "@/lib/audit";
import { reportExternalPayment } from "@/lib/claims";
import { HOUR_MS } from "@/lib/clock";
import { route } from "@/lib/route";
import { externalReportSchema, tokenParams } from "@/schemas";

// The payer says they paid outside the app. Still outstanding until the owed parent confirms (CL-6).
export const POST = route(
  {
    name: "POST /api/links/:token/report-external",
    auth: "userOrLink",
    params: tokenParams,
    body: externalReportSchema,
    rateLimit: ({ params }) => ({ key: `report-external:${params.token.slice(0, 16)}`, limit: 10, windowMs: HOUR_MS }),
  },
  async ({ params, body, user, linkSession, req, requestId }) => {
    return reportExternalPayment(params.token, body, { user, linkSession }, { requestId, ...requestMeta(req) });
  },
);
