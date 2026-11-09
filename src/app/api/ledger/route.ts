import { requireFamily } from "@/lib/auth/session";
import { getLedger } from "@/lib/data/ledger";
import { route } from "@/lib/route";
import { ledgerQuerySchema } from "@/schemas";

// Ledger rows + server totals (Section K). Any family member.
export const GET = route({ name: "GET /api/ledger", auth: "user", query: ledgerQuerySchema }, async ({ user, query }) => {
  const ctx = await requireFamily(user!);
  return { ledger: await getLedger(ctx, query.filter) };
});
