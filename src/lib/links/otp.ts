import "server-only";
import { HOUR_MS, MINUTE_MS, now } from "@/lib/clock";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { db, Timestamp } from "@/lib/firebase/admin";
import { newOtpCode, safeEqual, sha256Hex } from "@/lib/ids";
import { OTP_MAX_ATTEMPTS, otpStatus, toMs } from "@/lib/state/effective";
import type { OtpChallengeDoc } from "@/types/firestore";

// One-time codes for link actions (Section F.3): 6 digits, sent only to the recipient email on
// file, 10-minute expiry, stored as SHA-256 with a server pepper, 5 wrong attempts then a
// 15-minute lock, at most 3 sends per hour per token.

export const OTP_TTL_MS = 10 * MINUTE_MS;
export const OTP_LOCK_MS = 15 * MINUTE_MS;
export const OTP_MAX_SENDS_PER_HOUR = 3;

export function hashOtp(tokenHash: string, code: string, pepper = env().OTP_PEPPER): string {
  return sha256Hex(`${pepper}:otp:${tokenHash}:${code}`);
}

function ref(tokenHash: string) {
  return db().collection("otpChallenges").doc(tokenHash);
}

function lockedError(lockedUntilMs: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntilMs - now().getTime()) / 1000));
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return new AppError("LOCKED", `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, {
    retryAfterSeconds,
    details: { lockedUntil: new Date(lockedUntilMs).toISOString() },
  });
}

/** Creates a fresh code and returns it so the caller can email it. The code is never stored in plain text. */
export async function issueOtp(tokenHash: string): Promise<{ code: string; expiresAt: Date }> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref(tokenHash));
    const t = now();
    const current = snap.exists ? (snap.data() as OtpChallengeDoc) : null;

    if (current && otpStatus(current, t) === "locked") throw lockedError(toMs(current.lockedUntil)!);

    const windowStartMs = toMs(current?.windowStart) ?? 0;
    const windowFresh = t.getTime() - windowStartMs >= HOUR_MS;
    const sendCount = windowFresh ? 0 : (current?.sendCount ?? 0);
    if (sendCount >= OTP_MAX_SENDS_PER_HOUR) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + HOUR_MS - t.getTime()) / 1000));
      throw new AppError("RATE_LIMITED", "You asked for 3 codes in the last hour. Please wait before asking again.", { retryAfterSeconds });
    }

    const code = newOtpCode();
    const expiresAt = new Date(t.getTime() + OTP_TTL_MS);
    const doc: OtpChallengeDoc = {
      codeHash: hashOtp(tokenHash, code),
      expiresAt: Timestamp.fromDate(expiresAt),
      attempts: 0,
      sendCount: sendCount + 1,
      windowStart: windowFresh ? Timestamp.fromDate(t) : (current!.windowStart as Timestamp),
      lockedUntil: null,
    };
    tx.set(ref(tokenHash), doc);
    return { code, expiresAt };
  });
}

type VerifyOutcome =
  | { kind: "ok" }
  | { kind: "wrong"; remaining: number }
  | { kind: "locked"; until: number }
  | { kind: "expired" }
  | { kind: "none" };

/** Verifies a code. Wrong attempts are persisted before the error is thrown. */
export async function verifyOtp(tokenHash: string, code: string): Promise<void> {
  const outcome = await db().runTransaction<VerifyOutcome>(async (tx) => {
    const snap = await tx.get(ref(tokenHash));
    if (!snap.exists) return { kind: "none" };
    const c = snap.data() as OtpChallengeDoc;
    const t = now();
    const status = otpStatus(c, t);
    if (status === "locked") return { kind: "locked", until: toMs(c.lockedUntil)! };
    if (status === "none" || status === "exhausted") return { kind: "none" };
    if (status === "expired") return { kind: "expired" };

    if (safeEqual(hashOtp(tokenHash, code), c.codeHash!)) {
      // Single use: clear the code so it cannot be replayed.
      tx.update(ref(tokenHash), { codeHash: null, expiresAt: null, attempts: 0 });
      return { kind: "ok" };
    }

    const attempts = c.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      const until = t.getTime() + OTP_LOCK_MS;
      tx.update(ref(tokenHash), { attempts, codeHash: null, lockedUntil: Timestamp.fromMillis(until) });
      return { kind: "locked", until };
    }
    tx.update(ref(tokenHash), { attempts });
    return { kind: "wrong", remaining: OTP_MAX_ATTEMPTS - attempts };
  });

  switch (outcome.kind) {
    case "ok":
      return;
    case "locked":
      throw lockedError(outcome.until);
    case "expired":
      throw new AppError("OTP_EXPIRED", "This code has expired. Ask for a new code.");
    case "none":
      throw new AppError("OTP_INVALID", "There is no active code. Ask for a new code.");
    case "wrong":
      throw new AppError("OTP_INVALID", `That code is not right. ${outcome.remaining} attempt${outcome.remaining === 1 ? "" : "s"} left.`, {
        details: { remaining: outcome.remaining },
      });
  }
}
