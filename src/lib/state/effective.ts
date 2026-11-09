// Time-derived states (Section E.6.3). UI, API guards, the daily job and tests all call
// these functions. Never compare dates for these concepts anywhere else.
// Pure: `now` is always passed in. Safe for client components.

import type { ApprovalState, SettlementState, Ts } from "@/types/firestore";

export type TimeLike = Ts | Date | number | null | undefined;

export function toMs(t: TimeLike): number | null {
  if (t == null) return null;
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  return t.toMillis();
}

const DAY = 86_400_000;

export const OTP_MAX_ATTEMPTS = 5;
export const DUE_SOON_DAYS = 3;

/** REQUESTED past `expiresAt` is effectively EXPIRED; the next write persists it. */
export function effectiveApprovalState(approval: { state: ApprovalState; expiresAt?: TimeLike }, now: Date): ApprovalState {
  if (approval.state !== "REQUESTED") return approval.state;
  const exp = toMs(approval.expiresAt);
  if (exp != null && now.getTime() > exp) return "EXPIRED";
  return "REQUESTED";
}

export type LinkStatus = "usable" | "expired" | "used" | "revoked";

export function linkStatus(link: { expiresAt: TimeLike; usedAt?: TimeLike; revokedAt?: TimeLike }, now: Date): LinkStatus {
  if (toMs(link.revokedAt) != null) return "revoked";
  if (toMs(link.usedAt) != null) return "used";
  const exp = toMs(link.expiresAt);
  if (exp == null || now.getTime() > exp) return "expired";
  return "usable";
}

export function isLinkUsable(link: { expiresAt: TimeLike; usedAt?: TimeLike; revokedAt?: TimeLike }, now: Date): boolean {
  return linkStatus(link, now) === "usable";
}

const OPEN_CLAIM: ReadonlySet<SettlementState> = new Set(["AWAITING_PAYMENT", "PAYMENT_FAILED"]);

export function isOverdue(settlement: { state: SettlementState; dueAt?: TimeLike }, now: Date): boolean {
  const due = toMs(settlement.dueAt);
  return OPEN_CLAIM.has(settlement.state) && due != null && now.getTime() > due;
}

export function isDueSoon(settlement: { state: SettlementState; dueAt?: TimeLike }, now: Date): boolean {
  const due = toMs(settlement.dueAt);
  if (!OPEN_CLAIM.has(settlement.state) || due == null) return false;
  const t = now.getTime();
  return due - DUE_SOON_DAYS * DAY <= t && t <= due;
}

export type OtpStatus = "none" | "valid" | "expired" | "locked" | "exhausted";

export function otpStatus(
  challenge: { codeHash?: string | null; expiresAt?: TimeLike; attempts: number; lockedUntil?: TimeLike } | null | undefined,
  now: Date,
): OtpStatus {
  if (!challenge) return "none";
  const locked = toMs(challenge.lockedUntil);
  if (locked != null && now.getTime() < locked) return "locked";
  if (!challenge.codeHash) return "none";
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) return "exhausted";
  const exp = toMs(challenge.expiresAt);
  if (exp == null || now.getTime() > exp) return "expired";
  return "valid";
}

export function isOtpValid(challenge: Parameters<typeof otpStatus>[0], now: Date): boolean {
  return otpStatus(challenge, now) === "valid";
}

export type SubscriptionStatus = "APPROVAL_PENDING" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";

/** ACTIVE; or CANCELLED with paidThrough in the future. Nothing else is entitled. */
export function isEntitled(sub: { status: SubscriptionStatus; paidThrough?: TimeLike } | null | undefined, now: Date): boolean {
  if (!sub) return false;
  if (sub.status === "ACTIVE") return true;
  if (sub.status === "CANCELLED") {
    const paid = toMs(sub.paidThrough);
    return paid != null && paid > now.getTime();
  }
  return false;
}

/** Inside a time block (e.g. 7-day decline block, contest window). */
export function isBefore(now: Date, until: TimeLike): boolean {
  const ms = toMs(until);
  return ms != null && now.getTime() < ms;
}
