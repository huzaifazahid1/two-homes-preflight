import "server-only";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { loadUser, requireUserFromCookie, SESSION_COOKIE } from "@/lib/auth/session";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { meView, syncEmailVerified, type MeView } from "@/lib/users";

// Server-only reads for Server Components (always called inside a <Suspense> boundary,
// because reading cookies is request-time data under Cache Components).

/** The signed-in user's profile, or null when signed out / session invalid. */
export async function getMe(): Promise<MeView | null> {
  // Session verification checks token times (Date.now) inside firebase-admin, so this read must
  // never run in a runtime prerender: opt into request time first.
  await connection();
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    const user = await requireUserFromCookie(value);
    const doc = await loadUser(user.uid);
    if (!doc) return null;
    return meView(await syncEmailVerified(doc));
  } catch (err) {
    if (isAppError(err) && err.code === "UNAUTHENTICATED") return null;
    log.error("data.getMe_failed", { error: err });
    throw err;
  }
}

/** Requires a session; otherwise sends to login and back to the current path (AU-4). */
export async function requireMe(currentPath: string): Promise<MeView> {
  const me = await getMe();
  if (!me) {
    const hasCookie = Boolean((await cookies()).get(SESSION_COOKIE)?.value);
    redirect(`/login?${hasCookie ? "reason=expired&" : ""}next=${encodeURIComponent(currentPath)}`);
  }
  return me;
}

export type OnboardedMe = MeView & { family: NonNullable<MeView["family"]> };

/**
 * For every /app page and the /app layout. Layouts and pages render in parallel, so a page cannot
 * rely on the layout's redirect: each one checks verification and onboarding itself (AU-8).
 */
export async function requireOnboarded(currentPath: string): Promise<OnboardedMe> {
  const me = await requireMe(currentPath);
  if (!me.emailVerified) redirect("/verify-email");
  if (me.onboardingStep !== "done" || !me.family) redirect(`/onboarding/${me.onboardingStep === "done" ? "profile" : me.onboardingStep}`);
  return me as OnboardedMe;
}

export async function currentPathname(fallback: string): Promise<string> {
  return (await headers()).get("x-pathname") ?? fallback;
}
