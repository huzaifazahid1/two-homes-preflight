import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { disconnect } from "@/lib/paypal/connect";
import { route } from "@/lib/route";

// Disconnect your own PayPal account. Blocked while a payout is processing.
export const DELETE = route({ name: "DELETE /api/paypal/connect", auth: "user" }, async ({ user, req }) => {
  const ctx = await requireFamily(user!);
  await disconnect(ctx.familyId, ctx.userDoc.role, { uid: user!.uid }, requestMeta(req));
  return { ok: true };
});
