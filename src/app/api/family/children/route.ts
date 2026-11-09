import { requireOwner } from "@/lib/auth/session";
import { addChild } from "@/lib/family";
import { route } from "@/lib/route";
import { childCreateSchema } from "@/schemas";

export const POST = route({ name: "POST /api/family/children", auth: "user", body: childCreateSchema }, async ({ user, body }) => {
  const ctx = await requireOwner(user!);
  return Response.json({ child: await addChild(ctx, body) }, { status: 201 });
});
