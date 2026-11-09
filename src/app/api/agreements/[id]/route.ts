import { getAgreement } from "@/lib/agreements";
import { requireOwner } from "@/lib/auth/session";
import { route } from "@/lib/route";
import { docIdParams } from "@/schemas";

export const GET = route({ name: "GET /api/agreements/:id", auth: "user", params: docIdParams }, async ({ user, params, requestId }) => {
  const ctx = await requireOwner(user!);
  return getAgreement(ctx, params.id, requestId);
});
