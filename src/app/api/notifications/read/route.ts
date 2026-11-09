import { z } from "zod";
import { db } from "@/lib/firebase/admin";
import { route } from "@/lib/route";

// Marks the caller's own notifications as read (clients cannot write Firestore).
const body = z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(20) }).strict();

export const POST = route({ name: "POST /api/notifications/read", auth: "user", body }, async ({ user, body }) => {
  const refs = body.ids.map((id) => db().collection("notifications").doc(id));
  const snaps = await db().getAll(...refs);
  const batch = db().batch();
  let count = 0;
  snaps.forEach((s) => {
    // Only the recipient's own documents; anything else is silently out of scope, not an error to leak.
    if (s.exists && s.data()?.toUid === user!.uid && s.data()?.read === false) {
      batch.update(s.ref, { read: true });
      count++;
    }
  });
  if (count > 0) await batch.commit();
  return { updated: count };
});
