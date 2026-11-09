import { NextResponse } from "next/server";
import { cookieOptions } from "@/lib/links/session";
import { PP_STATE_COOKIE, startConnect } from "@/lib/paypal/connect";
import { resolveConnector } from "@/lib/paypal/connector";
import { route } from "@/lib/route";
import { connectStartQuery } from "@/schemas";

// Starts Log in with PayPal. Returns the authorize URL as JSON (the page navigates to it) and sets
// the signed, httpOnly `state` cookie bound to the caller, role and family.
export const GET = route({ name: "GET /api/paypal/connect/start", auth: "userOrLink", query: connectStartQuery }, async (ctx) => {
  const who = await resolveConnector({ for: ctx.query.for, token: ctx.query.token }, ctx);
  const { url, cookie, maxAgeSeconds } = startConnect({ ...who, returnTo: ctx.query.returnTo });
  const res = NextResponse.json({ url });
  res.cookies.set(PP_STATE_COOKIE, cookie, cookieOptions(maxAgeSeconds));
  return res;
});
