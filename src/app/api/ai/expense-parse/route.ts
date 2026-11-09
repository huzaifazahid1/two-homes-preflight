import { quickAdd } from "@/lib/ai/quick-add";
import { requireFamily } from "@/lib/auth/session";
import { HOUR_MS } from "@/lib/clock";
import { route } from "@/lib/route";
import { quickAddSchema } from "@/schemas";

// AI quick add: fills the form only, never decides a verdict (A.6.2). 30/hour/family.
export const POST = route(
  {
    name: "POST /api/ai/expense-parse",
    auth: "user",
    body: quickAddSchema,
    rateLimit: ({ user }) => ({ key: `quick-add:${user!.uid}`, limit: 30, windowMs: HOUR_MS, message: "Quick add is limited to 30 a hour. Fill in the form instead." }),
  },
  async ({ user, body, requestId }) => {
    const ctx = await requireFamily(user!);
    return { fields: await quickAdd(ctx, body.text, requestId) };
  },
);
