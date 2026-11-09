import { requireDev, resetDemo } from "@/lib/dev/demo";
import { route } from "@/lib/route";

// Deletes every seeded demo family (DEMO_MODE + DEV_SECRET only; 404 otherwise, SE-7).
export const POST = route({ name: "POST /api/dev/reset", auth: "none" }, async ({ req }) => {
  requireDev(req);
  return { reset: await resetDemo() };
});
