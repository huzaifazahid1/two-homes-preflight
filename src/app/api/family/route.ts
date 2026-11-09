import { requireVerified } from "@/lib/auth/session";
import { familyView, upsertFamily } from "@/lib/family";
import { route } from "@/lib/route";
import { familyUpsertSchema } from "@/schemas";

// Creates the family if missing and sets the co-parent's name and email. Verified owner only.
export const POST = route({ name: "POST /api/family", auth: "user", body: familyUpsertSchema }, async ({ user, body }) => {
  const verified = await requireVerified(user!);
  const { familyId, family } = await upsertFamily(verified, body);
  return { family: familyView(familyId, family) };
});
