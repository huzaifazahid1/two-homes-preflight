import { requireOwner } from "@/lib/auth/session";
import { removeChild, updateChild } from "@/lib/family";
import { route } from "@/lib/route";
import { childIdParams, childPatchSchema } from "@/schemas";

export const PATCH = route(
  { name: "PATCH /api/family/children/:id", auth: "user", params: childIdParams, body: childPatchSchema },
  async ({ user, params, body }) => {
    const ctx = await requireOwner(user!);
    return { child: await updateChild(ctx, params.id, body) };
  },
);

export const DELETE = route({ name: "DELETE /api/family/children/:id", auth: "user", params: childIdParams }, async ({ user, params }) => {
  const ctx = await requireOwner(user!);
  await removeChild(ctx, params.id);
  return { ok: true };
});
