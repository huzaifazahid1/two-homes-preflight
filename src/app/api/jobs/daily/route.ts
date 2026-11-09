import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { safeEqual, sha256Hex } from "@/lib/ids";
import { runDailyJob } from "@/lib/jobs/daily";
import { route } from "@/lib/route";

// Scheduled by .github/workflows/daily-job.yml with Authorization: Bearer JOB_SECRET.
export const POST = route({ name: "POST /api/jobs/daily", auth: "none" }, async ({ req, requestId }) => {
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Compare hashes so the comparison time does not depend on the secret's length.
  if (!given || !safeEqual(sha256Hex(given), sha256Hex(env().JOB_SECRET))) throw new AppError("UNAUTHENTICATED", "Missing or wrong job secret.");
  return { summary: await runDailyJob({ requestId }) };
});
