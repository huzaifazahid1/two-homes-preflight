import "server-only";
import { DAY_MS, MINUTE_MS, nowMs } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { adminAuth, db } from "@/lib/firebase/admin";
import type { FamilyDoc, UserDoc } from "@/types/firestore";

// App authentication (Section F.1): Firebase ID token -> httpOnly session cookie (5 days),
// verified with checkRevoked on every request.

export const SESSION_COOKIE = "thp_session";
export const SESSION_TTL_MS = 5 * DAY_MS;
const RECENT_SIGN_IN_MS = 5 * MINUTE_MS;

export type SessionUser = { uid: string; email: string; emailVerified: boolean };

export async function createSessionFromIdToken(idToken: string): Promise<{ cookie: string; user: SessionUser }> {
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(idToken, true);
  } catch (err) {
    throw new AppError("UNAUTHENTICATED", "Your sign-in could not be verified. Please sign in again.", { cause: err });
  }
  // Only mint a session from a fresh sign-in (Firebase recommendation for session cookies).
  if (nowMs() - decoded.auth_time * 1000 > RECENT_SIGN_IN_MS) {
    throw new AppError("UNAUTHENTICATED", "Please sign in again.");
  }
  if (!decoded.email) throw new AppError("INVALID", "Your account has no email address.");
  const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn: SESSION_TTL_MS });
  return { cookie, user: { uid: decoded.uid, email: decoded.email.toLowerCase(), emailVerified: decoded.email_verified === true } };
}

/** Verifies the session cookie (checkRevoked). Throws 401 UNAUTHENTICATED. */
export async function requireUserFromCookie(cookieValue: string | undefined | null): Promise<SessionUser> {
  if (!cookieValue) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  try {
    const d = await adminAuth().verifySessionCookie(cookieValue, true);
    return { uid: d.uid, email: (d.email ?? "").toLowerCase(), emailVerified: d.email_verified === true };
  } catch (err) {
    throw new AppError("UNAUTHENTICATED", "Your session has ended. Please sign in again.", { cause: err });
  }
}

/** Reads verification live from Firebase Auth: the session cookie's claim can be stale right after verifying. */
export async function requireVerified(user: SessionUser): Promise<SessionUser> {
  if (user.emailVerified) return user;
  const record = await adminAuth().getUser(user.uid);
  if (!record.emailVerified) throw new AppError("EMAIL_NOT_VERIFIED", "Please verify your email address first.");
  return { ...user, emailVerified: true };
}

export async function revokeSession(uid: string) {
  await adminAuth().revokeRefreshTokens(uid);
}

export async function loadUser(uid: string): Promise<UserDoc | null> {
  const snap = await db().collection("users").doc(uid).get();
  return snap.exists ? (snap.data() as UserDoc) : null;
}

export async function requireUserDoc(user: SessionUser): Promise<UserDoc> {
  const doc = await loadUser(user.uid);
  if (!doc) throw new AppError("UNAUTHENTICATED", "Your profile was not found. Please sign in again.");
  return doc;
}

export type FamilyContext = { user: SessionUser; userDoc: UserDoc; familyId: string; family: FamilyDoc };

/** Loads the user's family and checks membership (Section F.1, F.2). */
export async function requireFamily(user: SessionUser): Promise<FamilyContext> {
  const userDoc = await requireUserDoc(user);
  if (!userDoc.familyId) throw new AppError("NOT_FOUND", "You have not created a family yet.");
  const snap = await db().collection("families").doc(userDoc.familyId).get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "Family not found.");
  const family = snap.data() as FamilyDoc;
  if (!family.memberUids.includes(user.uid)) throw new AppError("FORBIDDEN", "You are not a member of this family.");
  return { user, userDoc, familyId: userDoc.familyId, family };
}

export async function requireOwner(user: SessionUser): Promise<FamilyContext> {
  const ctx = await requireFamily(user);
  if (ctx.family.ownerUid !== user.uid) throw new AppError("FORBIDDEN", "Only the family owner can do this.");
  return ctx;
}
