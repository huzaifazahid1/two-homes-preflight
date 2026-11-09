import "server-only";
import { nowMs } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { db, Timestamp } from "@/lib/firebase/admin";

// Fixed-window rate limiter backed by `rateLimits/{key}` (Section P.7).
// Throws RATE_LIMITED (429) with retry-after when the window is full.

export type Limit = { key: string; limit: number; windowMs: number; message?: string };

export async function consumeRateLimit({ key, limit, windowMs, message }: Limit): Promise<void> {
  const ref = db().collection("rateLimits").doc(key.replace(/\//g, "_"));
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowMs();
    const data = snap.data() as { count: number; windowStart: Timestamp } | undefined;
    const start = data?.windowStart.toMillis() ?? 0;
    if (!data || now - start >= windowMs) {
      tx.set(ref, { count: 1, windowStart: Timestamp.fromMillis(now) });
      return;
    }
    if (data.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((start + windowMs - now) / 1000));
      throw new AppError("RATE_LIMITED", message ?? "Too many requests. Please try again later.", { retryAfterSeconds });
    }
    tx.update(ref, { count: data.count + 1 });
  });
}
