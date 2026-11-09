import { getAgreementPage } from "@/lib/agreements";
import { requireFamily } from "@/lib/auth/session";
import { route } from "@/lib/route";
import { pageParams } from "@/schemas";

// Page text for the source sheet: owner or joined co-parent (family members only).
export const GET = route({ name: "GET /api/agreements/:id/pages/:n", auth: "user", params: pageParams }, async ({ user, params, requestId }) => {
  const ctx = await requireFamily(user!);
  return { page: await getAgreementPage(ctx, params.id, params.n, requestId) };
});
