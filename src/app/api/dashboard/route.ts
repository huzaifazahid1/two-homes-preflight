import { requireFamily } from "@/lib/auth/session";
import { dashboard } from "@/lib/data/dashboard";
import { route } from "@/lib/route";

// Totals by server aggregation on every load (invariant 10) and the "needs your action" list.
export const GET = route({ name: "GET /api/dashboard", auth: "user" }, async ({ user }) => {
  const ctx = await requireFamily(user!);
  return dashboard(ctx);
});
