import { NextResponse, type NextRequest } from "next/server";

// Section F.1: only redirects by cookie presence. It never authorizes; every page and
// Route Handler verifies the session itself. Also forwards the pathname for server redirects.

const SESSION_COOKIE = "thp_session";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!hasSession && (pathname.startsWith("/app") || pathname.startsWith("/onboarding"))) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  // A signed-in user on /login or /signup goes to the app, unless the server said the session
  // has expired (then the stale cookie must not bounce them back).
  // RSC prefetches of /login and /signup pass through: redirecting a prefetch produced 404s for /app?_rsc.
  const isRsc = request.headers.has("rsc") || request.headers.has("next-router-prefetch");
  if (hasSession && !isRsc && (pathname === "/login" || pathname === "/signup") && !request.nextUrl.searchParams.has("reason")) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname + search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/login", "/signup"],
};
