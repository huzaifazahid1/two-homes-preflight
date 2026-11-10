import { z } from "zod";
import { requireDev, seedDemo } from "@/lib/dev/demo";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/route";
import { emailSchema } from "@/schemas";

const nameSchema = z.string().trim().min(1).max(60);
const seedSchema = z
  .object({ coParentEmail: emailSchema, ownerPayPalEmail: emailSchema.optional(), ownerName: nameSchema.optional(), coParentName: nameSchema.optional() })
  .strict();

// Seeds one synthetic family (DEMO_MODE + DEV_SECRET only; 404 otherwise, SE-7). The body is
// parsed after the guard so a production server answers 404 before saying anything else.
export const POST = route({ name: "POST /api/dev/seed", auth: "none" }, async ({ req }) => {
  requireDev(req);
  const body = seedSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw new AppError("INVALID", "coParentEmail is required.");
  return { seeded: await seedDemo(body.data) };
});
