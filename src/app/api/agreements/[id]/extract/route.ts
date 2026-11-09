import { extractAgreement } from "@/lib/agreements";
import { requireOwner } from "@/lib/auth/session";
import { HOUR_MS } from "@/lib/clock";
import { route } from "@/lib/route";
import { docIdParams, extractSchema } from "@/schemas";

export const POST = route(
  {
    name: "POST /api/agreements/:id/extract",
    auth: "user",
    params: docIdParams,
    body: extractSchema,
    rateLimit: ({ user, body }) => (body.mode === "ai" ? { key: `ai-extract:${user!.uid}`, limit: 10, windowMs: HOUR_MS, message: "Too many extraction runs. Try again in an hour." } : null),
  },
  async ({ user, params, body, requestId }) => {
    const ctx = await requireOwner(user!);
    return { draft: await extractAgreement(ctx, params.id, body.mode, requestId) };
  },
);
