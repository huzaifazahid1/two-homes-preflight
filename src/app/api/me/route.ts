import { requireUserDoc } from "@/lib/auth/session";
import { route } from "@/lib/route";
import { meView, patchMe } from "@/lib/users";
import { mePatchSchema } from "@/schemas";

export const GET = route({ name: "GET /api/me", auth: "user" }, async ({ user }) => {
  return { me: await meView(await requireUserDoc(user!)) };
});

export const PATCH = route({ name: "PATCH /api/me", auth: "user", body: mePatchSchema }, async ({ user, body }) => {
  return { me: await meView(await patchMe(user!, body)) };
});
