import { requireFamily } from "@/lib/auth/session";
import { preflight } from "@/lib/expenses";
import { route } from "@/lib/route";
import { preflightSchema } from "@/schemas";

// Dry run: the verdict for a planned purchase. Writes nothing.
export const POST = route({ name: "POST /api/expenses/preflight", auth: "user", body: preflightSchema }, async ({ user, body }) => {
  const ctx = await requireFamily(user!);
  return { preflight: await preflight(ctx, body) };
});
