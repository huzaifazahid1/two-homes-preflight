import { NextResponse } from "next/server";
import { createSessionFromIdToken, requireUserFromCookie, revokeSession, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/session";
import { cookieOptions } from "@/lib/links/session";
import { route } from "@/lib/route";
import { ensureUserDoc, meView } from "@/lib/users";
import { sessionCreateSchema } from "@/schemas";

// POST: exchange a fresh Firebase ID token for the httpOnly session cookie (Section F.1).
export const POST = route({ name: "POST /api/auth/session", auth: "none", body: sessionCreateSchema }, async ({ body }) => {
  const { cookie, user } = await createSessionFromIdToken(body.idToken);
  const doc = await ensureUserDoc(user, body.timeZone);
  const res = NextResponse.json({ me: await meView(doc) });
  res.cookies.set(SESSION_COOKIE, cookie, cookieOptions(SESSION_TTL_MS / 1000));
  return res;
});

// DELETE: always clears the cookie; revokes refresh tokens when the session is still valid (AU-6).
// Accepts an expired cookie on purpose, so a user with a dead session can always sign out cleanly.
export const DELETE = route({ name: "DELETE /api/auth/session", auth: "none" }, async ({ cookies, log }) => {
  const value = cookies.get(SESSION_COOKIE);
  if (value) {
    const user = await requireUserFromCookie(value).catch(() => null);
    if (user) await revokeSession(user.uid);
    else log.info("auth.signout_with_invalid_session");
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
  return res;
});
